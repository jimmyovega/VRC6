import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../db";
import { logAudit } from "../../../lib/audit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ACTIONS = ["suspend", "reactivate", "delete", "setRole"] as const;
type Action = (typeof ACTIONS)[number];

// Admin user-management: suspend / reactivate / soft-delete / change role.
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor || actor.role !== "admin") return json({ error: "Forbidden" }, 403);

  let body: { userId?: string; action?: string; role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const userId = body.userId;
  const action = body.action as Action | undefined;
  const newRole = body.role === "admin" ? "admin" : "editor";
  if (!userId || !action || !ACTIONS.includes(action)) {
    return json({ error: "userId and a valid action are required" }, 400);
  }

  const db = getDb(env.DB);
  const [target] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!target) return json({ error: "User not found" }, 404);

  // Self-protection.
  if (target.id === actor.id && (action === "suspend" || action === "delete")) {
    return json({ error: "You can't suspend or delete your own account." }, 400);
  }
  if (target.id === actor.id && action === "setRole" && newRole !== "admin") {
    return json({ error: "You can't demote your own account." }, 400);
  }

  // Keep at least one active admin.
  const removesActiveAdmin =
    target.role === "admin" &&
    target.status === "active" &&
    (action === "suspend" ||
      action === "delete" ||
      (action === "setRole" && newRole !== "admin"));
  if (removesActiveAdmin) {
    const admins = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.role, "admin"), eq(schema.user.status, "active")));
    if (admins.length <= 1) {
      return json({ error: "At least one active admin must remain." }, 400);
    }
  }

  const now = new Date();
  const revokeSessions = () =>
    db.delete(schema.session).where(eq(schema.session.userId, userId));

  if (action === "suspend") {
    await db
      .update(schema.user)
      .set({ status: "suspended", suspendedAt: now })
      .where(eq(schema.user.id, userId));
    await revokeSessions();
  } else if (action === "reactivate") {
    await db
      .update(schema.user)
      .set({ status: "active", suspendedAt: null })
      .where(eq(schema.user.id, userId));
  } else if (action === "delete") {
    await db
      .update(schema.user)
      .set({ status: "deleted", deletedAt: now })
      .where(eq(schema.user.id, userId));
    await revokeSessions();
  } else if (action === "setRole") {
    await db.update(schema.user).set({ role: newRole }).where(eq(schema.user.id, userId));
  }

  await logAudit(db, {
    actorId: actor.id,
    action: `user.${action}`,
    targetUserId: userId,
    details: action === "setRole" ? { role: newRole } : null,
  });

  return json({ ok: true });
};
