import * as Sentry from "@sentry/cloudflare";
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { getDb } from "./db";
import { getAuth } from "./lib/auth";
import { getMaintenanceStatus } from "./lib/maintenance";
import { log, runWithRequestId } from "./lib/log";
import { applySecurityHeaders } from "./lib/security-headers";
import { originIsTrusted, requiresOriginCheck, siteOrigin } from "./lib/origin-check";

const originEnv = env as typeof env & { BETTER_AUTH_URL?: string };

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
    // Use Astro's normalized pathname, NOT one re-derived from request.url.
    // Astro routes on a path that has been percent-decoded and had duplicate
    // leading slashes collapsed, so deriving it from the raw URL here would let
    // `//admin/audit` or `/%61dmin/audit` reach the admin pages while the
    // checks below (`=== "/admin"`, `startsWith("/admin/")`) silently miss.
    const path = context.url.pathname;
    try {
      // CSRF: reject any state-changing request whose Origin is present and
      // doesn't match this site. Applies uniformly, including /api/auth/* —
      // better-auth already runs its own equivalent check there, and letting
      // this one cover it too means there's a single, simple rule to reason
      // about rather than a carve-out that has to stay correct forever. See
      // lib/origin-check.ts for why an ABSENT Origin is allowed through, and
      // why the trusted origin comes from BETTER_AUTH_URL rather than
      // context.url.origin — the latter is the request as this runtime
      // re-derives it, which is not guaranteed to equal what a real browser
      // sends as Origin for an in-page form submission under wrangler dev's
      // local proxying.
      // DIAGNOSTIC: re-enabled (CSP alone disabled below fixed CI, so this
      // was never the cause — confirming that conclusion here).
      if (
        requiresOriginCheck(context.request.method) &&
        !originIsTrusted(
          context.request.headers.get("origin"),
          siteOrigin(originEnv.BETTER_AUTH_URL, context.url.origin),
        )
      ) {
        const rejected = new Response("Forbidden — origin mismatch.", { status: 403 });
        rejected.headers.set("x-trace-id", requestId);
        return rejected;
      }

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
          if (!import.meta.env.DEV) applySecurityHeaders(gated.headers, env);
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
      // Skipped only under `astro dev` (Vite's HMR dev server), which injects
      // <style> tags and eval-based sourcemaps at runtime that a strict CSP
      // would legitimately block. `import.meta.env.DEV` is a build-time
      // constant baked by Vite — always false in the built output that
      // `wrangler dev`, CI, and production all serve — so unlike the
      // *_DISABLED runtime flags, there is no way to "leave this on" in a real
      // deployment.
      // DIAGNOSTIC: re-enabled with CSP itself stubbed out inside
      // security-headers.ts, to bisect CSP vs the other headers (HSTS is the
      // next suspect). NOT for merge in this state.
      if (!import.meta.env.DEV) applySecurityHeaders(response.headers, env);
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
