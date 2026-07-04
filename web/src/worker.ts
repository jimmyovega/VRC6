// Custom Worker entry: Astro SSR `fetch` plus a Cloudflare Cron `scheduled`
// handler, wrapped with Sentry for error reporting. Astro's Cloudflare adapter
// compiles whatever wrangler `main` points to, so this wraps the adapter's
// server entrypoint. Sentry stays disabled when SENTRY_DSN is unset (dev/CI).
import * as Sentry from "@sentry/cloudflare";
import astro from "@astrojs/cloudflare/entrypoints/server";
import { runScheduledJobs } from "./lib/cron";

const handler = {
  fetch: astro.fetch,
  async scheduled(
    _controller: ScheduledController,
    _env: unknown,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runScheduledJobs());
  },
};

export default Sentry.withSentry(
  (env: { SENTRY_DSN?: string; SENTRY_ENVIRONMENT?: string }) => ({
    // No DSN → the SDK is inert, so local dev / CI / tests are unaffected.
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    // Errors only for now — no performance tracing.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  }),
  handler,
);
