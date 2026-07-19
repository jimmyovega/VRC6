import * as Sentry from "@sentry/cloudflare";
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { getDb } from "./db";
import { getAuth } from "./lib/auth";
import { getMaintenanceStatus } from "./lib/maintenance";
import { log, runWithRequestId } from "./lib/log";

// Paths anonymous visitors can still reach while maintenance mode is on — the
// full sign-in flow (so staff can log in) plus the maintenance page itself.
const MAINTENANCE_ALLOWLIST = new Set(["/login", "/forgot-password", "/reset-password", "/maintenance"]);

// Resolves the better-auth session on every request and exposes it on
// Astro.locals (user / session), plus a request-scoped trace id used for
// structured logging and surfaced to clients via the `x-trace-id` header.
export const onRequest = defineMiddleware((context, next) => {
  // Cloudflare's Ray ID is a ready-made per-request trace id; fall back to a UUID.
  const requestId = context.request.headers.get("cf-ray") ?? crypto.randomUUID();
  context.locals.requestId = requestId;

  return runWithRequestId(requestId, async () => {
    const path = new URL(context.request.url).pathname;
    try {
      const result = await getAuth().api.getSession({ headers: context.request.headers });
      const user = (result?.user ?? null) as App.Locals["user"];
      context.locals.user = user;
      context.locals.session = (result?.session ?? null) as App.Locals["session"];

      // Maintenance gate: while enabled, anonymous visitors see a themed
      // "back soon" page instead of the real site. Any signed-in user (editor
      // or admin) bypasses it — the point is to hide in-progress/public
      // content from the public, not to block staff from testing.
      if (
        !user &&
        !MAINTENANCE_ALLOWLIST.has(path) &&
        !path.startsWith("/api/auth/")
      ) {
        const { enabled } = await getMaintenanceStatus(getDb(env.DB));
        if (enabled) {
          const rendered = await context.rewrite("/maintenance");
          const gated = new Response(rendered.body, { status: 503, headers: rendered.headers });
          gated.headers.set("x-trace-id", requestId);
          return gated;
        }
      }

      // Route protection.
      if (path === "/admin" || path.startsWith("/admin/")) {
        if (!user) return context.redirect("/login");
        if (user.role !== "admin") return context.redirect("/dashboard");
      } else if (path === "/dashboard" || path.startsWith("/dashboard/")) {
        if (!user) return context.redirect("/login");
      }

      const response = await next();
      response.headers.set("x-trace-id", requestId);
      return response;
    } catch (err) {
      // Unhandled errors are logged with the trace id so they can be found in
      // Workers Logs by the reference shown on the 500 page. Also report to
      // Sentry (no-op without a DSN) — Astro renders 500.astro and swallows the
      // exception, so withSentry at the worker level wouldn't otherwise see it.
      Sentry.captureException(err, { tags: { requestId, path } });
      log.error("unhandled request error", {
        path,
        method: context.request.method,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  });
});
