import { defineConfig, devices } from "@playwright/test";

// E2E tests run against a real `wrangler dev` server backed by a freshly
// migrated + seeded local D1. The webServer command builds, sets up the DB,
// then serves — so the run is reproducible locally and in CI (no CF secrets).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Every test shares one `wrangler dev` + one local D1, so high parallelism
  // oversubscribes them and causes contention timeouts under machine load. A
  // low, fixed worker count keeps the run stable; retries absorb the occasional
  // cold-start / load straggler.
  workers: 2,
  retries: 2,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8788",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Build + migrate + seed the local D1 via `npm run e2e:setup` BEFORE running
  // (see test:e2e). The webServer only serves — keeping it a single process
  // avoids a Windows libuv crash from chained npm sub-processes.
  webServer: {
    command: "npx wrangler dev --port 8788",
    url: "http://localhost:8788",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
