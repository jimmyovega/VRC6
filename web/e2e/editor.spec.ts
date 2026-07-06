import { expect, request as apiRequest, test } from "@playwright/test";

const BASE = "http://localhost:8788";
const PASSWORD = "Sup3rSecret!23";

// `wrangler dev` occasionally answers a POST with 503 "worker restarted
// mid-request" (and doesn't auto-retry non-GETs). Retry on 5xx; a duplicate
// sign-up just comes back as a <500 client error, which ends the loop.
async function postRetry(ctx: any, url: string, data: unknown) {
  let res = await ctx.post(url, { data });
  for (let i = 0; i < 4 && res.status() >= 500; i++) {
    await new Promise((r) => setTimeout(r, 300));
    res = await ctx.post(url, { data });
  }
  return res;
}

// Sign up via a fresh, disposable API context so no leftover session cookie
// bleeds between users (a shared context would carry the previous signup's
// session and silently skip creating the next user).
async function signUp(email: string) {
  const ctx = await apiRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  await postRetry(ctx, "/api/auth/sign-up/email", { email, password: PASSWORD, name: email });
  await ctx.dispose();
}

async function loginViaForm(page: any, email: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "SIGN IN" }).click();
  await page.waitForURL(`${BASE}/`);
}

async function signUpAndLogin(page: any, email: string) {
  await signUp(email);
  await loginViaForm(page, email);
}

test("E2E-40 editor: create a draft, write with TipTap, autosave persists", async ({ page }) => {
  await signUpAndLogin(page, `writer-${Date.now()}@vrc6.com`);

  // Create a draft from the dashboard and land in the editor.
  await page.goto("/dashboard");
  // The form POST is answered with a 303 redirect straight into the editor.
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  // Generous timeout: the editor route + TipTap bundle compile cold on first hit.
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/dashboard\/articles\/\d+\/edit/);

  // Give it a title and type into the TipTap surface.
  await page.locator("#art-title").fill("My First Draft");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Hello from TipTap.");

  // The debounced autosave reports success.
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });

  // Reload — both title and body persisted server-side.
  await page.reload();
  await expect(page.locator("#art-title")).toHaveValue("My First Draft");
  await expect(page.locator(".ProseMirror")).toContainText("Hello from TipTap.");

  // And it shows on the dashboard as a draft.
  await page.goto("/dashboard");
  const row = page.locator(".article-row", { hasText: "My First Draft" });
  await expect(row).toBeVisible();
  await expect(row.locator(".tagpill")).toHaveText("DRAFT");
});

test("E2E-41 editor: cannot open another author's draft", async ({ page }) => {
  // Author A: sign up (auto-creates a session) and create a draft entirely via
  // an isolated API context — no browser login needed.
  const aCtx = await apiRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  await postRetry(aCtx, "/api/auth/sign-up/email", {
    email: `owner-${Date.now()}@vrc6.com`,
    password: PASSWORD,
    name: "Owner",
  });
  const res = await postRetry(aCtx, "/api/articles", {});
  const { id } = (await res.json()) as { id: number };
  expect(id).toBeGreaterThan(0);
  await aCtx.dispose();

  // Editor B logs in via the form and is bounced from A's draft.
  await signUpAndLogin(page, `intruder-${Date.now()}@vrc6.com`);
  await page.goto(`/dashboard/articles/${id}/edit`);
  await expect(page).toHaveURL(`${BASE}/dashboard`);
});

test("E2E-42 editor: submit a complete draft for review", async ({ page }) => {
  await signUpAndLogin(page, `submitter-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });

  await page.locator("#art-title").fill("Ready To Ship");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Enough words to count as real content.");
  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });

  const submit = page.getByRole("button", { name: "SUBMIT FOR REVIEW" });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Redirected to the dashboard, now shown as pending review.
  await expect(page).toHaveURL(`${BASE}/dashboard`);
  const row = page.locator(".article-row", { hasText: "Ready To Ship" });
  await expect(row.locator(".tagpill")).toHaveText("PENDING REVIEW");

  // Reopening is read-only with an "awaiting review" banner (no editor).
  await row.getByRole("link", { name: "Ready To Ship" }).click();
  await expect(page.locator(".banner")).toContainText("Submitted for review");
  await expect(page.locator(".ProseMirror")).toHaveCount(0);
});

test("E2E-43 editor: submit is gated until the draft is complete", async ({ page }) => {
  await signUpAndLogin(page, `incomplete-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });

  const submit = page.getByRole("button", { name: "SUBMIT FOR REVIEW" });
  // Fresh draft: blocked on the title first.
  await expect(submit).toBeDisabled();
  await expect(page.locator("#submit-hint")).toContainText("title");

  await page.locator("#art-title").fill("Has A Title");
  await expect(page.locator("#submit-hint")).toContainText("content");

  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Now it has content.");
  await expect(page.locator("#submit-hint")).toContainText("category");

  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(submit).toBeEnabled();
});
