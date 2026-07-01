// Custom Worker entry: Astro SSR `fetch` plus a Cloudflare Cron `scheduled`
// handler. Astro's Cloudflare adapter compiles whatever wrangler `main` points
// to, so this wraps the adapter's server entrypoint and adds scheduled jobs.
import astro from "@astrojs/cloudflare/entrypoints/server";
import { runScheduledJobs } from "./lib/cron";

export default {
  fetch: astro.fetch,
  async scheduled(
    _controller: ScheduledController,
    _env: unknown,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runScheduledJobs());
  },
};
