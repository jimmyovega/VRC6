import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { setMaintenanceMode } from "../../../lib/maintenance";
import { logAudit } from "../../../lib/audit";
import { isAdmin } from "../../../lib/permissions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MAX_MESSAGE = 300;

// POST /api/admin/maintenance — admin-only toggle for the site-wide
// maintenance gate. Signed-in users always bypass the gate regardless of this
// setting; it only affects anonymous visitors (see src/middleware.ts).
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!isAdmin(actor)) return json({ error: "Forbidden" }, 403);

  let body: { enabled?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const enabled = body.enabled === true;
  const message =
    (typeof body.message === "string" ? body.message.trim() : "").slice(0, MAX_MESSAGE) || null;

  const db = getDb(env.DB);
  await setMaintenanceMode(db, enabled, message);
  await logAudit(db, {
    actorId: actor.id,
    action: enabled ? "site.maintenance_on" : "site.maintenance_off",
    details: message ? { message } : null,
  });

  return json({ ok: true, enabled, message });
};
