import { defineConfig, devices } from "@playwright/test";

// A tiny, truly-live tier: a handful of checks against the deployed site
// itself (real Resend/Turnstile config, real Cloudflare routing), run right
// after deploy. Deliberately separate from playwright.config.ts, which spins up
// a local `wrangler dev` — this one has no webServer and hits a real URL.
//
// Defaults to the CUSTOM DOMAIN, not the workers.dev subdomain. Both serve the
// same Worker build, but the custom domain has its own DNS, TLS and routing in
// front of it — smoke-testing workers.dev leaves the hostname real readers
// actually use unverified. Override with PROD_SMOKE_URL.
export default defineConfig({
  testDir: "./e2e-prod-smoke",
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: "list",
  use: {
    baseURL: process.env.PROD_SMOKE_URL ?? "https://vrc6.com",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
