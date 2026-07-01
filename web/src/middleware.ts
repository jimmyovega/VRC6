import { defineMiddleware } from "astro:middleware";
import { getAuth } from "./lib/auth";
import { log, runWithRequestId } from "./lib/log";

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
      // Workers Logs by the reference shown on the 500 page.
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
