import { expect, test } from "@playwright/test";
import { generateSync } from "otplib";

const totp = (secret: string) => generateSync({ strategy: "totp", secret });

// Auth foundation (M2 Phase A) — against wrangler dev + better-auth on D1.

test("E2E-10 sign up via API then log in through the form", async ({ page, request }) => {
  const email = `e2e-${Date.now()}@vrc6.com`;
  const password = "Sup3rSecret!23";

  const signup = await request.post("/api/auth/sign-up/email", {
    data: { email, password, name: "E2E User" },
  });
  expect(signup.ok()).toBeTruthy();

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "SIGN IN" }).click();

  await page.waitForURL("http://localhost:8788/");
  // Session middleware reflects the logged-in state in the header.
  await expect(page.getByRole("button", { name: "LOG OUT" })).toBeVisible();
});

test("E2E-31 the mobile header collapses the nav behind a hamburger", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/contact");
  const toggle = page.getByRole("button", { name: /toggle menu/i });
  await expect(toggle).toBeVisible();
  // Collapsed by default, and nothing overflows horizontally.
  await expect(page.getByRole("link", { name: "CONTACT US" })).toBeHidden();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
  // The hamburger reveals the nav.
  await toggle.click();
  await expect(page.getByRole("link", { name: "CONTACT US" })).toBeVisible();
});

test("E2E-33 the desktop header shows the nav inline (no hamburger)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/contact");
  await expect(page.getByRole("link", { name: "CONTACT US" })).toBeVisible();
  await expect(page.getByRole("button", { name: /toggle menu/i })).toBeHidden();
});

test("E2E-30 the 2FA code step is hidden on the login page until needed", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "SIGN IN" })).toBeVisible();
  // The 2FA form only appears after a two-factor sign-in redirect.
  await expect(page.getByRole("button", { name: "VERIFY" })).toBeHidden();
});

test("E2E-11 wrong credentials show an error", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("nobody@vrc6.com");
  await page.locator('input[name="password"]').fill("definitely-wrong");
  await page.getByRole("button", { name: "SIGN IN" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

async function signUpAndLogin(page: any, request: any, email: string) {
  await request.post("/api/auth/sign-up/email", {
    data: { email, password: "Sup3rSecret!23", name: email },
  });
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("Sup3rSecret!23");
  await page.getByRole("button", { name: "SIGN IN" }).click();
  await page.waitForURL("http://localhost:8788/");
}

test("E2E-12 anonymous users are redirected from protected routes to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});

test("E2E-13 an editor can reach the dashboard but not admin", async ({ page, request }) => {
  await signUpAndLogin(page, request, `editor-${Date.now()}@vrc6.com`);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});

test("E2E-14 the bootstrap admin (ADMIN_EMAIL) can reach admin", async ({ page, request }) => {
  // owner@vrc6.com matches ADMIN_EMAIL → becomes admin on sign-up.
  await signUpAndLogin(page, request, "owner@vrc6.com");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
});

// Security regression — the middleware used to derive its path from the raw
// `request.url`, while Astro routes on a percent-decoded, slash-collapsed path.
// That mismatch let `/%61dmin/audit` and `//admin/audit` reach the admin pages
// with no session at all (the audit log leaks user email addresses).
//
// These assert the OUTCOME (no admin surface without an admin session), not the
// mechanism, so they hold whichever of the two layers catches it: the middleware
// path fix or the per-page `isAdmin` guards. Verified to fail against the
// original code, where `/%61dmin/audit` returned 200 with the audit table.
// NB: these MUST be requested as absolute URLs. A leading `//` in a *relative*
// URL is protocol-relative, so `request.get("//admin")` would resolve to
// `http://admin/` and never touch the app at all.
const ORIGIN = "http://localhost:8788";
const ADMIN_PATH_VARIANTS = [
  "/admin", // control — the plain path must keep working
  "//admin", // duplicate leading slash
  "/%61dmin", // percent-encoded 'a'
  "/%2561dmin", // double-encoded
  "/admin/audit", // control
  "//admin/audit",
  "/%61dmin/audit",
  "/admin/review",
  "//admin/review",
  "/%61dmin/articles",
];

test("E2E-62 encoded and double-slash admin paths cannot bypass the auth gate (anonymous)", async ({
  request,
}) => {
  for (const path of ADMIN_PATH_VARIANTS) {
    const res = await request.get(`${ORIGIN}${path}`, { maxRedirects: 0 });
    expect(
      [301, 302].includes(res.status()),
      `${path} should redirect an anonymous visitor, got ${res.status()}`,
    ).toBeTruthy();
    expect(res.headers()["location"], `${path} should redirect to /login`).toContain("/login");
    // Belt and braces: the audit page's contents must never appear.
    expect(await res.text()).not.toContain("Audit log");
  }
});

test("E2E-63 an editor cannot reach admin pages via any path encoding", async ({
  page,
  request,
}) => {
  await signUpAndLogin(page, request, `editor-enc-${Date.now()}@vrc6.com`);
  for (const path of ADMIN_PATH_VARIANTS) {
    await page.goto(`${ORIGIN}${path}`);
    // Every variant must land on the dashboard, never an admin page.
    await expect(page, `${path} should not expose an admin page to an editor`).toHaveURL(
      /\/dashboard$/,
    );
  }
});

test("E2E-15 forgot-password shows a confirmation after submit", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.locator('input[name="email"]').fill("anyone@vrc6.com");
  await page.getByRole("button", { name: "SEND RESET LINK" }).click();
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible();
});

test("E2E-16 reset-password without a token shows an error", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByText(/Missing reset link/i)).toBeVisible();
});

test("E2E-25 an expired/invalid reset link shows a recovery message", async ({ page }) => {
  await page.goto("/reset-password?error=INVALID_TOKEN");
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "REQUEST A NEW LINK" })).toBeVisible();
});

test("E2E-26 admin sees link status and can resend activation to a pending user", async ({ page, request }) => {
  await signUpAndLogin(page, request, "owner@vrc6.com");
  const email = `resend-${Date.now()}@vrc6.com`;
  await page.goto("/admin");
  await page.locator('#invite-form input[name="email"]').fill(email);
  await page.getByRole("button", { name: "SEND INVITE" }).click();
  await expect(page.getByText(/Invite sent/i)).toBeVisible();

  await page.reload();
  const row = page.locator(".user-row", { hasText: email });
  // A freshly-invited user has a live activation link.
  await expect(row.getByText("LINK ACTIVE")).toBeVisible();

  const userId = await row.getByRole("button", { name: "RESEND ACTIVATION" }).getAttribute("data-id");
  const res = await page.request.post("/api/admin/resend-invite", { data: { userId } });
  expect(res.ok()).toBeTruthy();
});

test("E2E-27 a logged-in user can log out", async ({ page, request }) => {
  await signUpAndLogin(page, request, `logout-${Date.now()}@vrc6.com`);
  await expect(page.getByRole("button", { name: "LOG OUT" })).toBeVisible();
  await page.getByRole("button", { name: "LOG OUT" }).click();
  // The header must re-render logged-out (session actually cleared).
  await expect(page.getByRole("link", { name: "LOG IN" })).toBeVisible();
  await expect(page.getByRole("button", { name: "LOG OUT" })).toHaveCount(0);
});

test("E2E-28 a deleted user can't be mutated", async ({ page, request, playwright }) => {
  const email = `deltest-${Date.now()}@vrc6.com`;
  const ctx = await playwright.request.newContext({
    baseURL: "http://localhost:8788",
    extraHTTPHeaders: { Origin: "http://localhost:8788" },
  });
  const signup = await ctx.post("/api/auth/sign-up/email", {
    data: { email, password: "Sup3rSecret!23", name: "Del Test" },
  });
  const created = (await signup.json()) as { user: { id: string } };
  await ctx.dispose();

  await signUpAndLogin(page, request, "owner@vrc6.com");
  expect(
    (await page.request.post("/api/admin/user-action", { data: { userId: created.user.id, action: "delete" } })).ok(),
  ).toBeTruthy();

  // Server rejects any further action on a deleted user.
  const setRole = await page.request.post("/api/admin/user-action", {
    data: { userId: created.user.id, action: "setRole", role: "admin" },
  });
  expect(setRole.ok()).toBeFalsy();

  // And the admin UI hides the deleted user entirely.
  await page.goto("/admin");
  await expect(page.locator(".user-row", { hasText: email })).toHaveCount(0);
});

test("E2E-29 an admin can re-invite a deleted user (revives the same account)", async ({ page, request, playwright }) => {
  const email = `reinvite-${Date.now()}@vrc6.com`;
  const ctx = await playwright.request.newContext({
    baseURL: "http://localhost:8788",
    extraHTTPHeaders: { Origin: "http://localhost:8788" },
  });
  const created = (await (
    await ctx.post("/api/auth/sign-up/email", { data: { email, password: "Sup3rSecret!23", name: "Re Invite" } })
  ).json()) as { user: { id: string } };
  await ctx.dispose();

  await signUpAndLogin(page, request, "owner@vrc6.com");
  expect(
    (await page.request.post("/api/admin/user-action", { data: { userId: created.user.id, action: "delete" } })).ok(),
  ).toBeTruthy();

  // Re-inviting the same email revives it (200), rather than 409.
  const reinvite = await page.request.post("/api/admin/invite", { data: { email, name: "Re Invite", role: "editor" } });
  expect(reinvite.ok()).toBeTruthy();

  await page.goto("/admin");
  const row = page.locator(".user-row", { hasText: email });
  await expect(row.getByText("PENDING ACTIVATION")).toBeVisible();
  // Same user id reused (revived, not recreated).
  const revivedId = await row.getByRole("button", { name: "RESEND ACTIVATION" }).getAttribute("data-id");
  expect(revivedId).toBe(created.user.id);
});

test("E2E-32 an admin can't act on their own account in the list", async ({ page, request }) => {
  await signUpAndLogin(page, request, "owner@vrc6.com");
  await page.goto("/admin");
  const ownRow = page.locator(".user-row", { hasText: "owner@vrc6.com" });
  await expect(ownRow.getByText("YOU")).toBeVisible();
  await expect(ownRow.getByRole("button", { name: "DELETE" })).toHaveCount(0);
  await expect(ownRow.getByRole("button", { name: "SUSPEND" })).toHaveCount(0);
  await expect(ownRow.getByRole("button", { name: /MAKE (ADMIN|EDITOR)/ })).toHaveCount(0);
});

test("E2E-17 an admin can invite a user", async ({ page, request }) => {
  await signUpAndLogin(page, request, "owner@vrc6.com");
  await page.goto("/admin");
  await page.locator('input[name="email"]').fill(`invitee-${Date.now()}@vrc6.com`);
  await page.locator('input[name="name"]').fill("Invitee");
  await page.getByRole("button", { name: "SEND INVITE" }).click();
  await expect(page.getByText(/Invite sent/i)).toBeVisible();
});

test("E2E-18 an admin can suspend a user, blocking their login", async ({
  page,
  request,
  playwright,
}) => {
  const email = `suspendme-${Date.now()}@vrc6.com`;
  const password = "Sup3rSecret!23";

  // Create an active editor in an isolated context; capture their id.
  // better-auth's CSRF check rejects cookie-bearing requests without an Origin
  // header (real browsers always send one; API request contexts don't).
  const editorCtx = await playwright.request.newContext({
    baseURL: "http://localhost:8788",
    extraHTTPHeaders: { Origin: "http://localhost:8788" },
  });
  const signup = await editorCtx.post("/api/auth/sign-up/email", {
    data: { email, password, name: "Suspend Me" },
  });
  const created = (await signup.json()) as { user: { id: string } };
  // They can log in initially.
  expect((await editorCtx.post("/api/auth/sign-in/email", { data: { email, password } })).status()).toBe(200);

  // Admin suspends them.
  await signUpAndLogin(page, request, "owner@vrc6.com");
  const suspend = await page.request.post("/api/admin/user-action", {
    data: { userId: created.user.id, action: "suspend" },
  });
  expect(suspend.ok()).toBeTruthy();

  // Login is now blocked.
  expect((await editorCtx.post("/api/auth/sign-in/email", { data: { email, password } })).status()).not.toBe(200);
  await editorCtx.dispose();
});

test("E2E-19 the audit log records admin actions", async ({ page, request, playwright }) => {
  const email = `audit-target-${Date.now()}@vrc6.com`;
  const ctx = await playwright.request.newContext({
    baseURL: "http://localhost:8788",
    extraHTTPHeaders: { Origin: "http://localhost:8788" },
  });
  const signup = await ctx.post("/api/auth/sign-up/email", {
    data: { email, password: "Sup3rSecret!23", name: "Audit Target" },
  });
  const created = (await signup.json()) as { user: { id: string } };
  await ctx.dispose();

  await signUpAndLogin(page, request, "owner@vrc6.com");
  const suspend = await page.request.post("/api/admin/user-action", {
    data: { userId: created.user.id, action: "suspend" },
  });
  expect(suspend.ok()).toBeTruthy();

  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  await expect(page.getByText("user.suspend").first()).toBeVisible();
});

test("E2E-20 an admin can run the activation-expiry sweep", async ({ page, request }) => {
  await signUpAndLogin(page, request, "owner@vrc6.com");
  // Send a JSON content-type so Astro's CSRF origin check is skipped (a real
  // browser sends an Origin header; the API request context doesn't).
  const res = await page.request.post("/api/admin/run-expiry", { data: {} });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { ok: boolean; expired: number };
  expect(body.ok).toBe(true);
  expect(typeof body.expired).toBe("number");
});

test("E2E-21 the Turnstile widget renders on the public auth forms", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator(".cf-turnstile")).toBeAttached();
  await page.goto("/forgot-password");
  await expect(page.locator(".cf-turnstile")).toBeAttached();
});

test("E2E-22 a user can enable TOTP 2FA and is challenged for it at login", async ({
  playwright,
}) => {
  const email = `twofa-${Date.now()}@vrc6.com`;
  const password = "Sup3rSecret!23";
  const ctx = await playwright.request.newContext({
    baseURL: "http://localhost:8788",
    extraHTTPHeaders: { Origin: "http://localhost:8788" },
  });

  // Sign up (auto-logged-in, active).
  expect((await ctx.post("/api/auth/sign-up/email", { data: { email, password, name: "TwoFA" } })).ok()).toBeTruthy();

  // Enable 2FA → returns the TOTP URI + backup codes.
  const enable = await ctx.post("/api/auth/two-factor/enable", { data: { password } });
  expect(enable.ok()).toBeTruthy();
  const { totpURI, backupCodes } = (await enable.json()) as { totpURI: string; backupCodes: string[] };
  expect(backupCodes.length).toBeGreaterThan(0);
  const secret = new URL(totpURI).searchParams.get("secret")!;
  expect(secret).toBeTruthy();

  // Confirm enrolment with a generated code.
  expect((await ctx.post("/api/auth/two-factor/verify-totp", { data: { code: totp(secret) } })).ok()).toBeTruthy();

  // Sign out, then sign back in — 2FA is now required (no full session yet).
  await ctx.post("/api/auth/sign-out");
  const signin = await ctx.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(signin.ok()).toBeTruthy();
  const signinBody = (await signin.json()) as { twoFactorRedirect?: boolean; token?: string };
  expect(signinBody.twoFactorRedirect).toBe(true);
  expect(signinBody.token).toBeFalsy();

  // Complete login with a fresh code.
  expect((await ctx.post("/api/auth/two-factor/verify-totp", { data: { code: totp(secret) } })).ok()).toBeTruthy();

  // The session is now established.
  const sess = await ctx.get("/api/auth/get-session");
  const sessBody = (await sess.json()) as { user?: { email?: string } } | null;
  expect(sessBody?.user?.email).toBe(email);

  await ctx.dispose();
});

test("E2E-23 the security page exposes 2FA enrolment", async ({ page, request }) => {
  await signUpAndLogin(page, request, `sec-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard/security");
  await expect(page.getByRole("heading", { level: 1, name: "Security" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ENABLE 2FA" })).toBeVisible();
});

test("E2E-64 a user can change their password from Security & 2FA, and other sessions are revoked", async ({
  page,
  request,
  browser,
}) => {
  const email = `pwchange-${Date.now()}@vrc6.com`;
  const oldPassword = "Sup3rSecret!23";
  const newPassword = "BrandNewPass456";

  await signUpAndLogin(page, request, email);

  // A second device/session for the same account, in its own cookie jar.
  const otherContext = await browser.newContext();
  await otherContext.request.post("/api/auth/sign-in/email", {
    data: { email, password: oldPassword },
  });
  expect((await otherContext.request.get("/dashboard")).url()).toContain("/dashboard");

  await page.goto("/dashboard/security");
  await page.locator("#current-password").fill(oldPassword);
  await page.locator("#new-password").fill(newPassword);
  await page.locator("#confirm-new-password").fill(newPassword);
  await page.getByRole("button", { name: "CHANGE PASSWORD" }).click();
  await expect(
    page.getByText("Password changed. You've been signed out of other devices."),
  ).toBeVisible();

  // This tab's own session survives — better-auth reissues its cookie in the
  // same response, so it's excluded from the revocation.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);

  // The other device's session is dead — it gets bounced to /login.
  expect((await otherContext.request.get("/dashboard")).url()).toContain("/login");

  // The credential actually changed, not just the UI state. A fresh context
  // for this, not the `request` fixture used by signUpAndLogin above:
  // `request` is one reusable APIRequestContext for the whole test, so it
  // still carries the cookie from that earlier sign-up call — and
  // better-auth's origin-check requires an Origin header on ANY request that
  // carries a Cookie header at all (see origin-check.mjs's `useCookies`
  // check), which a plain `.post()` doesn't set. Real behavior worth
  // knowing, just not what this assertion is about.
  const verifyContext = await browser.newContext();
  const oldStillWorks = await verifyContext.request.post("/api/auth/sign-in/email", {
    data: { email, password: oldPassword },
  });
  expect(oldStillWorks.status()).toBe(401);
  const newWorks = await verifyContext.request.post("/api/auth/sign-in/email", {
    data: { email, password: newPassword },
  });
  expect(newWorks.ok()).toBeTruthy();

  await otherContext.close();
  await verifyContext.close();
});

test("E2E-65 the security page shows recent access history, excluded from the admin audit log", async ({
  page,
  request,
  browser,
}) => {
  const email = `access-${Date.now()}@vrc6.com`;
  await signUpAndLogin(page, request, email);

  await page.goto("/dashboard/security");
  const rows = page.locator(".access-row");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(10);
  // A real browser UA gets summarized ("Chrome on Windows"), not dumped raw.
  await expect(rows.first().locator(".access-device")).toContainText("Chrome");
  await expect(rows.first().locator(".access-when")).not.toHaveText("");

  // Login events are excluded from the general admin audit view — that page
  // stays focused on moderation actions, not access noise (see the `ne`
  // filter in admin/audit.astro). A fresh browser context for the admin
  // check, not `page`/`request` above: `request` is one reusable
  // APIRequestContext for the whole test, so by this point it's already
  // carrying the cookie from the first signUpAndLogin's sign-up call, and
  // better-auth's origin-check requires an Origin header on any request
  // that carries a Cookie header at all — which a plain `.post()` doesn't
  // set (see the identical note on E2E-64).
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signUpAndLogin(adminPage, adminContext.request, "owner@vrc6.com");
  await adminPage.goto("/admin/audit");
  await expect(adminPage.getByText("user.login")).toHaveCount(0);
  await adminContext.close();
});

test("E2E-24 responses carry a request-scoped x-trace-id header", async ({ request }) => {
  const res = await request.get("/");
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["x-trace-id"]).toBeTruthy();
});
