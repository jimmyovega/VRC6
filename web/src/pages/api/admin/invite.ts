import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../db";
import { getAuth } from "../../../lib/auth";
import { internalHeaders } from "../../../lib/internal";
import { log } from "../../../lib/log";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A long random password the invitee never sees — they set their own on activation.
function tempPassword(): string {
  return crypto.randomUUID().replace(/-/g, "") + "Aa1!";
}

// Admin invites a user: creates a pending_activation account and emails an
// activation link (the password-reset flow, re-skinned for invites).
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || actor.role !== "admin") {
    return json({ error: "Forbidden" }, 403);
  }

  let body: { email?: string; name?: string; role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim() || email;
  const role = body.role === "admin" ? "admin" : "editor";
  if (!email) return json({ error: "Email is required" }, 400);

  const auth = getAuth();
  const db = getDb(env.DB);

  // Internal marker so these in-process calls skip the public Turnstile /
  // rate-limit before-hook.
  const trusted = internalHeaders(request.headers);

  try {
    await auth.api.signUpEmail({
      body: { email, password: tempPassword(), name },
      headers: trusted,
    });
  } catch {
    return json({ error: "That email is already invited or registered." }, 409);
  }

  // New sign-ups default to active; an invited user must activate first.
  await db
    .update(schema.user)
    .set({ role, status: "pending_activation" })
    .where(eq(schema.user.email, email));

  // Send the activation (set-password) email. baseURL (BETTER_AUTH_URL) makes
  // the link absolute.
  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/reset-password" },
      headers: trusted,
    });
  } catch (err) {
    log.error("invite activation email failed", {
      email,
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: "User created, but the activation email failed to send." }, 502);
  }

  return json({ ok: true });
};
