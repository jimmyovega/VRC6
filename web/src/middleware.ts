import { defineMiddleware } from "astro:middleware";
import { getAuth } from "./lib/auth";

// Resolves the better-auth session on every request and exposes it on
// Astro.locals (user / session), so pages and the layout can read auth state.
export const onRequest = defineMiddleware(async (context, next) => {
  const result = await getAuth().api.getSession({ headers: context.request.headers });
  const user = (result?.user ?? null) as App.Locals["user"];
  context.locals.user = user;
  context.locals.session = (result?.session ?? null) as App.Locals["session"];

  // Route protection.
  const path = new URL(context.request.url).pathname;
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!user) return context.redirect("/login");
    if (user.role !== "admin") return context.redirect("/dashboard");
  } else if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    if (!user) return context.redirect("/login");
  }

  return next();
});
