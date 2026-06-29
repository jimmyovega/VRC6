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
