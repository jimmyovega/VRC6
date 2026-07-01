import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../db";
import { getAuth } from "../../../lib/auth";
import { internalHeaders } from "../../../lib/internal";
import { logAudit } from "../../../lib/audit";
import { log } from "../../../lib/log";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Re-issues a fresh activation link for a pending (or expired) invitee. The
// public invite form can't do this — signUpEmail 409s on the existing account —
// so admins need this to recover a stale/expired activation link.
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || actor.role !== "admin") {
    log.warn("resend-invite forbidden", { actorId: actor?.id ?? null });
    return json({ error: "Forbidden" }, 403);
  }

  let body: { userId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const userId = body.userId;
  if (!userId) return json({ error: "userId is required" }, 400);

  const db = getDb(env.DB);
  const [target] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!target) return json({ error: "User not found" }, 404);
  if (target.status !== "pending_activation" && target.status !== "expired") {
    return json({ error: "Only pending or expired invitations can be re-sent." }, 400);
  }

  // Re-open a fully-expired invite before re-sending.
  if (target.status === "expired") {
    await db
      .update(schema.user)
      .set({ status: "pending_activation", expiredAt: null })
      .where(eq(schema.user.id, userId));
  }

  const auth = getAuth();
  try {
    await auth.api.requestPasswordReset({
      body: { email: target.email, redirectTo: "/reset-password" },
      headers: internalHeaders(request.headers),
    });
  } catch (err) {
    log.error("resend-invite email failed", {
      userId,
      email: target.email,
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: "Could not send the activation email." }, 502);
  }

  await logAudit(db, {
    actorId: actor.id,
    action: "user.invite_resent",
    targetUserId: userId,
  });
  log.info("invite resent", { actorId: actor.id, userId, email: target.email });
  return json({ ok: true });
};
