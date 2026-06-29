// better-auth configured for Cloudflare Workers + D1 (Drizzle adapter).
// The D1 binding is request-scoped, so the instance is created lazily and
// memoized per isolate.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { account, session, user, verification } from "../db/schema";
import { sendEmail } from "./email";

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
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your VRC6 password",
          html: `<p>A password reset was requested for your VRC6 account.</p><p><a href="${url}">Reset your password</a></p><p>If this wasn't you, you can ignore this email.</p>`,
          text: `Reset your VRC6 password: ${url}`,
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Bootstrap: the configured owner email becomes an active admin on sign-up.
          before: async (newUser) => {
            if (authEnv.ADMIN_EMAIL && newUser.email === authEnv.ADMIN_EMAIL) {
              return { data: { ...newUser, role: "admin", status: "active" } };
            }
            return { data: newUser };
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
          defaultValue: "pending_activation",
          input: false,
        },
        username: { type: "string", required: false },
        bio: { type: "string", required: false },
      },
    },
  });
  return cached;
}
