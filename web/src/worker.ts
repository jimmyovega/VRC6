// Custom Worker entry: Astro SSR `fetch` plus a Cloudflare Cron `scheduled`
// handler, wrapped with Sentry for error reporting. Astro's Cloudflare adapter
// compiles whatever wrangler `main` points to, so this wraps the adapter's
// server entrypoint. Sentry stays disabled when SENTRY_DSN is unset (dev/CI).
import * as Sentry from "@sentry/cloudflare";
import astro from "@astrojs/cloudflare/entrypoints/server";
import { runScheduledJobs } from "./lib/cron";
import { assertSafeConfig } from "./lib/config-guard";

// Checked once per isolate on the first request rather than at module scope:
// the `env` binding isn't reliably readable at module-eval time, and doing it
// here means the failure surfaces as a normal request error that Sentry and the
// structured logger both see.
let configChecked = false;
function checkConfigOnce(env: unknown) {
  if (configChecked) return;
  assertSafeConfig((env ?? {}) as Record<string, unknown>);
  configChecked = true;
}

const handler = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    // Throws on a production deploy that still carries a dev bypass flag or is
    // missing a secret a security control depends on. Better to serve a 500
    // than to serve traffic with Turnstile silently switched off.
    checkConfigOnce(env);
    return astro.fetch(request, env as never, ctx);
  },
  async scheduled(
    _controller: ScheduledController,
    env: unknown,
    ctx: ExecutionContext,
  ) {
    checkConfigOnce(env);
    ctx.waitUntil(runScheduledJobs());
  },
};

// Replaced at build time by vite `define` (see astro.config.mjs) with the
// commit this bundle was built from. Empty for local builds.
declare const __VRC6_RELEASE__: string;

export default Sentry.withSentry(
  (env: { SENTRY_DSN?: string; SENTRY_ENVIRONMENT?: string }) => ({
    // No DSN → the SDK is inert, so local dev / CI / tests are unaffected.
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    // Ties each error to the deploy that produced it, and matches the release
    // the source maps were uploaded under so stack traces actually resolve.
    release: __VRC6_RELEASE__ || undefined,
    // Errors only for now — no performance tracing.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      // /reset-password?token=… carries a live, single-use account-takeover
      // token. sendDefaultPii:false strips cookies and IP but not the URL, and
      // any unhandled error on that page would ship the token to Sentry.
      const url = event.request?.url;
      if (url && url.includes("token=")) {
        try {
          const u = new URL(url);
          u.searchParams.set("token", "[redacted]");
          event.request!.url = u.toString();
        } catch {
          delete event.request!.url;
        }
      }
      return event;
    },
  }),
  handler,
);
