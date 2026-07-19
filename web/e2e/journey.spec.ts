import { execSync } from "node:child_process";
import { expect, request as apiRequest, test } from "@playwright/test";

const BASE = "http://localhost:8788";
const ADMIN_EMAIL = "owner@vrc6.com";
const ADMIN_PASSWORD = "Sup3rSecret!23";

// The bootstrap admin (owner@vrc6.com, matched by ADMIN_EMAIL) only becomes an
// actual account on first sign-up — nothing pre-seeds it. A fresh, disposable
// API context avoids bleeding this session's cookies into the page below (see
// editor.spec.ts's `signUp`). A duplicate sign-up on a re-run just 409s, which
// is fine — we only need the account to exist before logging in.
async function ensureSignedUp(email: string, password: string) {
  const ctx = await apiRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  let res = await ctx.post("/api/auth/sign-up/email", { data: { email, password, name: email } });
  for (let i = 0; i < 4 && res.status() >= 500; i++) {
    await new Promise((r) => setTimeout(r, 300));
    res = await ctx.post("/api/auth/sign-up/email", { data: { email, password, name: email } });
  }
  await ctx.dispose();
}

// `wrangler dev` occasionally answers a state-changing request with a 5xx
// response or a thrown network error (bindings still warming up) — retry
// both, same rationale as the other spec files.
async function retry(fn: () => Promise<any>) {
  let lastErr: unknown;
  for (let i = 0; i < 6; i++) {
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

// A page.request write immediately followed by a page.goto can hang (a
// Playwright/connection-pool quirk, see editor.spec.ts) — retry it too.
async function gotoRetry(page: any, url: string) {
  let lastErr: unknown;
  for (let i = 0; i < 6; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    try {
      await page.goto(url);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Query the local D1 the webServer is backed by (same CLI `e2e:setup` already
// uses to seed it). EMAIL_DISABLED means the activation email is only
// dev-logged, never actually sent — this is how the test gets the real
// activation token without a live inbox, staying fully offline/deterministic.
function queryLocalD1<T = Record<string, unknown>>(sql: string): T[] {
  const out = execSync(
    `npx wrangler d1 execute vrc6-db --local --json --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: "utf8" },
  );
  const [result] = JSON.parse(out) as { results: T[] }[];
  return result?.results ?? [];
}

function activationTokenFor(email: string): string {
  const [user] = queryLocalD1<{ id: string }>(`SELECT id FROM user WHERE email = '${email}'`);
  if (!user) throw new Error(`No user row found for ${email}`);
  const [verification] = queryLocalD1<{ identifier: string }>(
    `SELECT identifier FROM verification WHERE value = '${user.id}' AND identifier LIKE 'reset-password:%' ORDER BY expires_at DESC LIMIT 1`,
  );
  if (!verification) throw new Error(`No live activation token found for ${email}`);
  return verification.identifier.replace(/^reset-password:/, "");
}

async function loginViaForm(page: any, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "SIGN IN" }).click();
  await page.waitForURL(`${BASE}/`);
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// The canonical full-workflow journey: an admin invites an editor, the editor
// activates via their real (captured, never-emailed) activation link, writes
// and submits an article, the admin publishes it, and an anonymous visitor
// reads it live. Deterministic and fully offline (*_DISABLED flags mean no
// live Resend/Turnstile calls) — tagged `@journey` and excluded from per-PR
// CI (see package.json's test:e2e:journey); run on a schedule instead, since
// it's slower and touches more surface than any single-feature test.
test("E2E-J1 admin invites → editor activates → writes → submits → admin publishes → article is public @journey", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const editorEmail = `journey-editor-${Date.now()}@vrc6.com`;
  const editorPassword = "J0urneyPass!42";

  await ensureSignedUp(ADMIN_EMAIL, ADMIN_PASSWORD);
  await loginViaForm(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const inviteRes = await retry(() =>
    page.request.post("/api/admin/invite", {
      data: { email: editorEmail, name: "Journey Editor", role: "editor" },
    }),
  );
  expect(inviteRes.ok()).toBeTruthy();

  const token = activationTokenFor(editorEmail);

  await page.context().clearCookies();
  await gotoRetry(page, `/reset-password?token=${token}`);
  await page.locator('input[name="password"]').fill(editorPassword);
  await page.getByRole("button", { name: "SET PASSWORD" }).click();
  await expect(page).toHaveURL(`${BASE}/login`);

  await loginViaForm(page, editorEmail, editorPassword);

  const title = `Journey Article ${Date.now()}`;
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("#art-title").fill(title);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("A full end-to-end journey, start to finish.");
  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
  await expect(page).toHaveURL(`${BASE}/dashboard`);

  await page.context().clearCookies();
  await loginViaForm(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await gotoRetry(page, "/admin/review");
  await expect(page.locator(".review-row", { hasText: title })).toBeVisible();
  await page.locator(".review-row", { hasText: title }).getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  await page.context().clearCookies();
  await gotoRetry(page, `/articles/${slugify(title)}`);
  await expect(page.locator("h1")).toContainText(title);
  await expect(page.getByText("A full end-to-end journey")).toBeVisible();
});
