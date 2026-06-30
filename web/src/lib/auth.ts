// better-auth configured for Cloudflare Workers + D1 (Drizzle adapter).
// The D1 binding is request-scoped, so the instance is created lazily and
// memoized per isolate.
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { account, session, user, verification } from "../db/schema";
import { sendEmail } from "./email";
import { verifyTurnstile } from "./turnstile";

// Public auth endpoints (paths relative to /api/auth) gated by Turnstile.
const TURNSTILE_GUARDED_PATHS = new Set(["/sign-in/email", "/request-password-reset"]);

// BETTER_AUTH_SECRET comes from .dev.vars locally / `wrangler secret put` in prod.
const authEnv = env as typeof env & {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  ADMIN_EMAIL?: string;
};

let cached: ReturnType<typeof betterAuth> | null = null;

export function getAuth() {
  if (cached) return cached;
  const db = getDb(env.DB);
  cached = betterAuth({
    secret: authEnv.BETTER_AUTH_SECRET,
    baseURL: authEnv.BETTER_AUTH_URL,
    hooks: {
      // Gate the public auth forms with Cloudflare Turnstile. The token is
      // sent in the `x-turnstile-token` header so it doesn't collide with the
      // better-auth request body schema.
      before: createAuthMiddleware(async (ctx) => {
        if (!TURNSTILE_GUARDED_PATHS.has(ctx.path)) return;
        const token = ctx.headers?.get("x-turnstile-token");
        const ip = ctx.headers?.get("cf-connecting-ip") ?? undefined;
        if (!(await verifyTurnstile(token, ip))) {
          throw new APIError("FORBIDDEN", {
            message: "Verification failed. Please try again.",
          });
        }
      }),
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user: u, url }) => {
        const inviting = (u as { status?: string }).status === "pending_activation";
        await sendEmail({
          to: u.email,
          subject: inviting ? "Activate your VRC6 account" : "Reset your VRC6 password",
          html: inviting
            ? `<p>You've been invited to VRC6. Set your password to activate your account:</p><p><a href="${url}">Activate account</a></p>`
            : `<p>A password reset was requested for your VRC6 account.</p><p><a href="${url}">Reset your password</a></p><p>If this wasn't you, you can ignore this email.</p>`,
          text: inviting
            ? `Activate your VRC6 account: ${url}`
            : `Reset your VRC6 password: ${url}`,
        });
      },
      onPasswordReset: async ({ user: u }) => {
        // Activation: a pending user who has just set a password becomes active.
        if ((u as { status?: string }).status === "pending_activation") {
          const db = getDb(env.DB);
          await db
            .update(user)
            .set({ status: "active", activatedAt: new Date() })
            .where(eq(user.id, u.id));
        }
      },
    },
    databaseHooks: {
      user: {
        create: {
          // New sign-ups are active (so they can log in); the invite endpoint
          // overrides invited users back to pending_activation afterward. Any
          // email in ADMIN_EMAIL (comma-separated) is also made an admin.
          before: async (newUser) => {
            const admins = (authEnv.ADMIN_EMAIL ?? "")
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean);
            const isAdmin = admins.includes(newUser.email.toLowerCase());
            return {
              data: { ...newUser, status: "active", ...(isAdmin ? { role: "admin" } : {}) },
            };
          },
        },
      },
      session: {
        create: {
          // Only active accounts may hold a session (blocks pending / suspended /
          // expired / deleted from logging in).
          before: async (newSession) => {
            const db = getDb(env.DB);
            const [u] = await db
              .select({ status: user.status })
              .from(user)
              .where(eq(user.id, newSession.userId))
              .limit(1);
            if (u && u.status !== "active") {
              throw new APIError("FORBIDDEN", {
                message: "This account is not active.",
              });
            }
            return { data: newSession };
          },
        },
      },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "editor", input: false },
        status: {
          type: "string",
          required: false,
          defaultValue: "active",
          input: false,
        },
        username: { type: "string", required: false },
        bio: { type: "string", required: false },
      },
    },
  });
  return cached;
}
