import { expect, test } from "@playwright/test";

// Deliberately tiny (per the Test Specifications' "kept tiny on purpose"
// design note): just enough to catch a broken deploy — the homepage renders
// and the real auth wiring answers — without becoming its own test suite.
//
// Site-wide maintenance mode (M4) is an intentional, admin-toggled state, not
// a broken deploy — an anonymous visitor gets a themed 503 there, same as a
// real outage would look at the HTTP level. Accept either, but require the
// 503 case to actually be *our* maintenance page (not some other failure that
// happens to also 503), so a genuine broken deploy still fails this check.
test("prod smoke: homepage renders (or is intentionally in maintenance)", async ({ page }) => {
  const res = await page.goto("/");
  const status = res?.status();
  if (status === 503) {
    await expect(page).toHaveTitle(/maintenance/i);
  } else {
    expect(status).toBe(200);
    await expect(page).toHaveTitle(/VRC6/);
  }
});

test("prod smoke: auth session endpoint responds", async ({ page }) => {
  const res = await page.request.get("/api/auth/get-session");
  expect(res.status()).toBeLessThan(500);
});
