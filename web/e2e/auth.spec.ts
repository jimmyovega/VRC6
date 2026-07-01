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

test("E2E-15 forgot-password shows a confirmation after submit", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.locator('input[name="email"]').fill("anyone@vrc6.com");
  await page.getByRole("button", { name: "SEND RESET LINK" }).click();
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible();
});

test("E2E-16 reset-password without a token shows an error", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByText(/Missing or invalid reset link/i)).toBeVisible();
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

test("E2E-24 responses carry a request-scoped x-trace-id header", async ({ request }) => {
  const res = await request.get("/");
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["x-trace-id"]).toBeTruthy();
});
