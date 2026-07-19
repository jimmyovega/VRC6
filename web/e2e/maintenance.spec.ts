import { expect, request as apiRequest, test } from "@playwright/test";

const BASE = "http://localhost:8788";
const PASSWORD = "Sup3rSecret!23";

// `wrangler dev` occasionally answers a POST with 503 "worker restarted
// mid-request" and doesn't auto-retry non-GETs; retry on 5xx (see editor.spec.ts).
async function postRetry(ctx: any, url: string, data: unknown) {
  let res = await ctx.post(url, { data });
  for (let i = 0; i < 4 && res.status() >= 500; i++) {
    await new Promise((r) => setTimeout(r, 300));
    res = await ctx.post(url, { data });
  }
  return res;
}

// owner@vrc6.com is in ADMIN_EMAIL (incl. CI) → admin on sign-up. Sign-up is
// idempotent here (a repeat call just 409s harmlessly) so this is safe to call
// whether or not the account already exists from another test/run.
async function loginAsOwner(page: any) {
  const ctx = await apiRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  await postRetry(ctx, "/api/auth/sign-up/email", {
    email: "owner@vrc6.com",
    password: PASSWORD,
    name: "Owner",
  });
  await ctx.dispose();

  await page.goto("/login");
  await page.locator('input[name="email"]').fill("owner@vrc6.com");
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "SIGN IN" }).click();
  await page.waitForURL(`${BASE}/`);
}

async function toggleMaintenance(page: any, enabled: boolean, message = "") {
  const res = await page.request.post("/api/admin/maintenance", { data: { enabled, message } });
  expect(res.ok()).toBeTruthy();
}

// The test deliberately clears its page's cookies partway through, so a
// `finally` cleanup can't rely on that context still being signed in. Log in
// fresh (via an isolated API context) purely to guarantee maintenance ends up
// off, regardless of what state the test's own page/cookies are left in.
async function forceMaintenanceOff() {
  const ctx = await apiRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  await postRetry(ctx, "/api/auth/sign-up/email", {
    email: "owner@vrc6.com",
    password: PASSWORD,
    name: "Owner",
  });
  await postRetry(ctx, "/api/auth/sign-in/email", { email: "owner@vrc6.com", password: PASSWORD });
  await postRetry(ctx, "/api/admin/maintenance", { enabled: false });
  await ctx.dispose();
}

// Maintenance mode is a single, site-wide flag — toggling it in one test would
// race any other test toggling it in parallel, so the whole on/off cycle lives
// in one test rather than being split across parallel-safe cases.
test("E2E-49 maintenance mode gates anonymous visitors, staff bypass, toggling off restores access @serial", async ({
  page,
}) => {
  await loginAsOwner(page);

  try {
    await toggleMaintenance(page, true, "Testing upkeep, back soon.");

    // A signed-in admin still sees the real homepage.
    await page.goto("/");
    await expect(page.locator(".site-header")).toBeVisible();

    // An anonymous visitor gets the maintenance page (503) with the custom message.
    await page.context().clearCookies();
    const res = await page.goto("/");
    expect(res?.status()).toBe(503);
    await expect(page.getByText("Testing upkeep, back soon.")).toBeVisible();

    // Category/article pages are gated the same way.
    const catRes = await page.request.get("/category/games");
    expect(catRes.status()).toBe(503);

    // But the login flow itself still works, so staff can get back in.
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "SIGN IN" })).toBeVisible();
    await page.locator('input[name="email"]').fill("owner@vrc6.com");
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "SIGN IN" }).click();
    await page.waitForURL(`${BASE}/`);
    await expect(page.locator(".site-header")).toBeVisible();

    // Turning it off restores public access.
    await toggleMaintenance(page, false);
    await page.context().clearCookies();
    const restored = await page.goto("/");
    expect(restored?.status()).toBe(200);
    await expect(page.locator(".site-header")).toBeVisible();
  } finally {
    // Always leave it off so it can't leak into other tests. Uses its own
    // fresh session rather than `page` — the test above deliberately clears
    // the page's cookies partway through.
    await forceMaintenanceOff();
  }
});
