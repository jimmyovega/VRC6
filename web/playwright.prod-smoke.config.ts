import { defineConfig, devices } from "@playwright/test";

// A tiny, truly-live tier: 1-2 checks against the deployed site itself (real
// Resend/Turnstile config, real Cloudflare routing), run right after deploy.
// Deliberately separate from playwright.config.ts, which spins up a local
// `wrangler dev` — this one has no webServer and hits a real URL.
export default defineConfig({
  testDir: "./e2e-prod-smoke",
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: "list",
  use: {
    baseURL: process.env.PROD_SMOKE_URL ?? "https://vrc6.jimmy-o-vega.workers.dev",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
