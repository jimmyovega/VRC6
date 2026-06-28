import { expect, test } from "@playwright/test";

// Public reading experience (M1). Runs against wrangler dev + seeded local D1.

test("E2E-01 home lists published articles and category chips", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/VRC6/);
  await expect(page.getByText("The Digital Underground", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "PHOTOGRAPHY" })).toBeVisible();
});

test("E2E-02 clicking an article opens its detail page with breadcrumb", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Cyberspace Nomads/ }).click();
  await expect(page).toHaveURL(/\/articles\/cyberspace-nomads$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /Cyberspace Nomads/ }),
  ).toBeVisible();
  // Breadcrumb: Home (link) << Category (link)
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Home" })).toBeVisible();
});

test("E2E-03 unknown article slug returns a 404 page", async ({ page }) => {
  const res = await page.goto("/articles/does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
});

test("E2E-04 category page lists only its own articles", async ({ page }) => {
  await page.goto("/category/events");
  await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
  await expect(page.getByText("Neon Nights Guide")).toBeVisible();
  await expect(page.getByText("Cyberspace Nomads")).toHaveCount(0);
});

test("E2E-05 unknown category returns a 404", async ({ page }) => {
  const res = await page.goto("/category/not-a-real-category");
  expect(res?.status()).toBe(404);
});

test("E2E-06 empty category shows the empty state", async ({ page }) => {
  await page.goto("/category/games");
  await expect(page.getByRole("heading", { level: 1, name: "Games" })).toBeVisible();
  await expect(page.getByText(/No published articles/i)).toBeVisible();
});
