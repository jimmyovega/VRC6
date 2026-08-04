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

// The two findings from the security audit, re-checked against the real
// deployment on every deploy. Both were live in production once; a config
// regression or a bad merge could make either live again, and neither is
// visible from the outside without asking.
//
// These assert the *outcome* and are read-only — no account is created, and
// nothing is mutated.

test("prod smoke: the config guard let the Worker boot", async ({ page }) => {
  // If assertSafeConfig threw (a bypass flag set, or a security secret missing
  // from the Worker), EVERY route 500s. /login is reachable even during
  // maintenance, so it distinguishes "guard tripped" from "maintenance on".
  const res = await page.request.get("/login");
  expect(
    res.status(),
    "500 here means the production config is unsafe — check the Worker's secrets and vars",
  ).toBe(200);
});

test("prod smoke: admin routes are not reachable anonymously, however encoded", async ({
  page,
  baseURL,
}) => {
  // The middleware once read the raw request path while Astro routed on a
  // normalized one, so `//admin/audit` and `/%61dmin/audit` served the audit
  // log — including user email addresses — to anyone.
  //
  // Requested as ABSOLUTE urls: a leading `//` in a relative url is
  // protocol-relative, so `get("//admin/audit")` would resolve to
  // `https://admin/audit` and never touch the site at all.
  for (const path of ["/admin", "/admin/audit", "//admin/audit", "/%61dmin/audit"]) {
    const res = await page.request.get(`${baseURL}${path}`, { maxRedirects: 0 });
    expect(res.status(), `${path} must not render for an anonymous visitor`).not.toBe(200);
    expect(await res.text(), `${path} must not leak the audit table`).not.toContain("Audit log");
  }
});

test("prod smoke: public sign-up is closed", async ({ page }) => {
  // VRC6 is invite-only. Probed with a deliberately invalid body: a closed
  // endpoint rejects it before ever reaching user creation, so this can never
  // create an account even if the gate were open.
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: {},
    failOnStatusCode: false,
  });
  expect(res.status(), "public sign-up must not be open in production").not.toBe(200);
});
