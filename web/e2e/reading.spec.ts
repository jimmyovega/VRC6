import { expect, test } from "@playwright/test";

// Public reading experience (M1). Runs against wrangler dev + seeded local D1.

test("E2E-01 home lists published articles and category chips", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/VRC6/);
  await expect(page.getByText("The Digital Underground", { exact: false })).toBeVisible();
  // exact:true so the all-caps chip matches only itself, not article cards
  // whose accessible name also contains "Photography".
  await expect(page.getByRole("link", { name: "PHOTOGRAPHY", exact: true })).toBeVisible();
});

test("E2E-02 clicking the featured article opens its detail page with breadcrumb", async ({ page }) => {
  await page.goto("/");
  // The featured article is always visible (not subject to feed pagination).
  await page.getByRole("link", { name: /Against the Algorithm/ }).click();
  await expect(page).toHaveURL(/\/articles\/against-the-algorithm$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /Against the Algorithm/ }),
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
  // Locales is intentionally left unseeded (see seed.sql) so it renders empty.
  await page.goto("/category/locales");
  await expect(page.getByRole("heading", { level: 1, name: "Locales" })).toBeVisible();
  await expect(page.getByText(/No published articles/i)).toBeVisible();
});

test("E2E-07 home feed paginates client-side without a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  // A page-2 article is in the DOM but hidden on the first page.
  const pageTwoItem = page.getByRole("heading", {
    name: "Night Film: Shooting Neon on 35mm",
  });
  await expect(pageTwoItem).toBeHidden();
  await page.getByRole("button", { name: "More articles" }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await expect(pageTwoItem).toBeVisible();
});
