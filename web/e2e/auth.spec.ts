import { expect, test } from "@playwright/test";

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
