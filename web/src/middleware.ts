import { defineMiddleware } from "astro:middleware";
import { getAuth } from "./lib/auth";

// Resolves the better-auth session on every request and exposes it on
// Astro.locals (user / session), so pages and the layout can read auth state.
export const onRequest = defineMiddleware(async (context, next) => {
  const result = await getAuth().api.getSession({ headers: context.request.headers });
  context.locals.user = (result?.user ?? null) as App.Locals["user"];
  context.locals.session = (result?.session ?? null) as App.Locals["session"];
  return next();
});
