import type { APIRoute } from "astro";

// TEMPORARY diagnostic — verifies Sentry error reporting end-to-end. Admin-only
// (random visitors get 403, so it can't be used to spam errors). Visiting it as
// an admin throws, producing a 500 + a Sentry issue tagged with the requestId.
// Remove once verified. (No leading underscore — Astro excludes those from routing.)
export const GET: APIRoute = async ({ locals }) => {
  const actor = locals.user;
  if (!actor || actor.role !== "admin") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error("Sentry verification test error (admin-triggered)");
};
