import { expect, request as apiRequest, test } from "@playwright/test";

// Public reading experience (M1). Runs against wrangler dev + seeded local D1.

const BASE = "http://localhost:8788";
const PASSWORD = "Sup3rSecret!23";

async function retry(fn: () => Promise<any>) {
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fn();
      if (res.status() < 500) return res;
      lastErr = new Error(`HTTP ${res.status()}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// owner@vrc6.com is in ADMIN_EMAIL (incl. CI) → admin on sign-up.
async function loginAsOwner(page: any) {
  const ctx = await apiRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  await retry(() => ctx.post("/api/auth/sign-up/email", { data: { email: "owner@vrc6.com", password: PASSWORD, name: "Owner" } }));
  await ctx.dispose();

  await page.goto("/login");
  await page.locator('input[name="email"]').fill("owner@vrc6.com");
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "SIGN IN" }).click();
  await page.waitForURL(`${BASE}/`);
}

// Uses its own fresh session rather than `page` — callers may have already
// cleared the page's cookies (to test as an anonymous visitor) by the time
// cleanup runs.
async function setFeatured(id: number, featured: boolean) {
  const ctx = await apiRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  await retry(() => ctx.post("/api/auth/sign-up/email", { data: { email: "owner@vrc6.com", password: PASSWORD, name: "Owner" } }));
  await retry(() => ctx.post("/api/auth/sign-in/email", { data: { email: "owner@vrc6.com", password: PASSWORD } }));
  const res = await retry(() => ctx.post(`/api/articles/${id}/feature`, { data: { featured } }));
  await ctx.dispose();
  return res;
}

test("E2E-01 home lists published articles and category chips", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/VRC6/);
  // Check structurally (feed's first page has a real, visible article title)
  // rather than a fixed seeded title — which page any specific article lands
  // on shifts whenever another test in the same CI run publishes a new one
  // (newest-first homepage ordering); this has broken title-based assertions
  // here and in E2E-07 before.
  await expect(page.locator('.feed-item[data-page="0"] .card-title').first()).toBeVisible();
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
  // Select the first page-2 item structurally (data-page="1"), not by a fixed
  // seeded title — the exact article that lands on page 2 shifts whenever
  // another test in the same CI run publishes a new article (newest-first
  // ordering), which has broken this test twice via unrelated PRs before.
  const pageTwoItem = page.locator('.feed-item[data-page="1"]').first();
  await expect(pageTwoItem).toBeHidden();
  const pageTwoTitle = pageTwoItem.locator(".card-title");
  await page.getByRole("button", { name: "More articles" }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await expect(pageTwoItem).toBeVisible();
  await expect(pageTwoTitle).toBeVisible();
});

test("E2E-08 sitemap.xml lists published articles", async ({ page }) => {
  const res = await page.goto("/sitemap.xml");
  expect(res?.status()).toBe(200);
  const body = (await res?.text()) ?? "";
  expect(body).toContain("<urlset");
  expect(body).toContain("/articles/against-the-algorithm");
});

test("E2E-09 robots.txt points to the sitemap", async ({ page }) => {
  const res = await page.goto("/robots.txt");
  expect(res?.status()).toBe(200);
  const body = (await res?.text()) ?? "";
  expect(body).toMatch(/Sitemap:\s*https?:\/\/.*\/sitemap\.xml/);
});

// Which article is featured is site-wide state (M4 Phase C) — toggling it
// would race E2E-01/E2E-02 above if they ran concurrently in another worker,
// so this is tagged @serial (see maintenance.spec.ts for the same pattern)
// and always restores the default (nothing featured) afterward.
test("E2E-52 an admin-featured article becomes the homepage hero, even if not the most recent @serial", async ({
  page,
}) => {
  await loginAsOwner(page);

  // Find "The Digital Underground..." article's id via the admin console's
  // title-search filter (Phase B) rather than guessing an autoIncrement id.
  const searchRes = await retry(() => page.request.get("/admin/articles?q=Digital+Underground"));
  const html = await searchRes.text();
  const match = html.match(/\/dashboard\/articles\/(\d+)\/edit/);
  if (!match) throw new Error("Seeded 'Digital Underground' article not found");
  const id = Number(match[1]);

  try {
    const featureRes = await setFeatured(id, true);
    expect(featureRes.ok()).toBeTruthy();

    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.locator(".featured")).toContainText("The Digital Underground");
    await expect(page.locator(".featured .tag")).toHaveText("FEATURED");
    // The previously-default hero (most recent) is bumped into the regular feed.
    await expect(page.locator(".featured")).not.toContainText("Against the Algorithm");
  } finally {
    await setFeatured(id, false);
  }
});
