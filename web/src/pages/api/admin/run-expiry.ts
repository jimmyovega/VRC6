import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { expirePendingActivations } from "../../../lib/cron";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Run the activation-expiry sweep on demand (same logic the daily Cron Trigger
// runs). Admin-only — enforced here in addition to middleware.
export const POST: APIRoute = async ({ locals }) => {
  const actor = locals.user;
  if (!actor || actor.role !== "admin") return json({ error: "Forbidden" }, 403);

  const db = getDb(env.DB);
  const expired = await expirePendingActivations(db);
  return json({ ok: true, expired });
};
