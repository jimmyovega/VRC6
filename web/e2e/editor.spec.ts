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

// A page.goto/reload right after a page.request write can hit wrangler dev
// mid-restart and abort (ERR_ABORTED) — same underlying flakiness as the 5xx
// case above, just surfacing as a thrown navigation error instead of a status
// code. Retry it like any other transient dev-server hiccup.
async function gotoRetry(page: any, url: string) {
  let lastErr: unknown;
  for (let i = 0; i < 6; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));
    try {
      await page.goto(url);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
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

// Create a draft, fill it out completely, and submit it. Returns the article id.
async function writeAndSubmit(page: any, title: string): Promise<number> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  const id = Number(page.url().match(/articles\/(\d+)\/edit/)![1]);
  await page.locator("#art-title").fill(title);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("This draft has enough real content to be submitted.");
  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
  await expect(page).toHaveURL(`${BASE}/dashboard`);
  return id;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

test("E2E-44 workflow: editor submits, admin approves, article goes public", async ({ page }) => {
  const title = `Published Piece ${Date.now()}`;
  await signUpAndLogin(page, `author-${Date.now()}@vrc6.com`);
  const id = await writeAndSubmit(page, title);

  // Admin finds it in the review queue and approves it.
  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com"); // ADMIN_EMAIL → admin on sign-up
  await page.goto("/admin/review");
  await expect(page.locator(".review-row", { hasText: title })).toBeVisible();
  await page.goto(`/dashboard/articles/${id}/edit`);
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  // An anonymous visitor can now read it on the public site.
  await page.context().clearCookies();
  await page.goto(`/articles/${slugify(title)}`);
  await expect(page.locator("h1")).toContainText(title);
  await expect(page.getByText("enough real content to be submitted")).toBeVisible();
});

test("E2E-45 workflow: admin rejects an article back to the author with a reason", async ({ page }) => {
  const authorEmail = `rejectee-${Date.now()}@vrc6.com`;
  await signUpAndLogin(page, authorEmail);
  const id = await writeAndSubmit(page, `Needs Work ${Date.now()}`);

  // Admin sends it back with a reason.
  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com"); // in ADMIN_EMAIL (incl. CI) → admin
  await page.goto(`/dashboard/articles/${id}/edit`);
  await page.locator("input[name='reason']").fill("Needs a stronger intro.");
  await page.getByRole("button", { name: "REJECT" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  // The author sees it back as an editable draft carrying the reason.
  await page.context().clearCookies();
  await signUpAndLogin(page, authorEmail);
  await page.goto(`/dashboard/articles/${id}/edit`);
  await expect(page.locator(".banner.reject")).toContainText("Needs a stronger intro.");
  await expect(page.locator(".ProseMirror")).toBeVisible();
});

test("E2E-46 editor: uploading an image inserts it and serves it back", async ({ page }) => {
  await signUpAndLogin(page, `imager-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });

  // A 1x1 transparent PNG, picked through the toolbar's Image button.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('[data-cmd="image"]').click(),
  ]);
  await chooser.setFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });

  // The uploaded image is inserted into the editor with a /media URL (dev fallback).
  const img = page.locator(".ProseMirror img");
  await expect(img).toHaveCount(1, { timeout: 10_000 });
  const src = await img.getAttribute("src");
  expect(src).toMatch(/^\/media\/articles\/[0-9a-f-]{36}\.png$/);

  // And that URL streams the bytes back from R2 with an image content-type.
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
});

test("E2E-53 editor: upload a cover image, it shows on the homepage card and detail hero, and can be removed", async ({
  page,
}) => {
  const title = `Cover Story ${Date.now()}`;
  await signUpAndLogin(page, `coverer-${Date.now()}@vrc6.com`);
  const id = await writeAndSubmit(page, title);

  // Admin approves → published + public.
  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await page.goto(`/dashboard/articles/${id}/edit`);
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  // Back in the editor, upload a cover image via the dedicated button.
  await page.goto(`/dashboard/articles/${id}/edit`);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#cover-upload-btn").click(),
  ]);
  await chooser.setFiles({ name: "cover.png", mimeType: "image/png", buffer: png });

  const coverImg = page.locator("#cover-img");
  await expect(coverImg).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });

  // Reload — the cover persisted server-side.
  await page.reload();
  await expect(page.locator("#cover-img")).toBeVisible();
  await expect(page.locator("#cover-remove-btn")).toBeVisible();

  // It renders on the article's own homepage tile — either the paginated
  // grid card (.article) or, if this happens to be the newest published
  // article and nothing else is admin-featured, the hero slot (.featured).
  // Match on the shared <a class="card"> wrapper so either slot works, and
  // check the img is present with a real src rather than toBeVisible():
  // paginated grid cards beyond page 1 are deliberately kept in the DOM
  // (for crawlability) but hidden via inline display:none, which other
  // tests running concurrently in CI could push this card behind.
  await page.goto("/");
  const cardImg = page.locator("a.card", { hasText: title }).locator("img");
  await expect(cardImg).toHaveCount(1);
  expect(await cardImg.getAttribute("src")).toBeTruthy();

  // ...and on the detail page hero.
  await page.goto(`/articles/${slugify(title)}`);
  await expect(page.locator(".cover-img")).toBeVisible();

  // Remove it — the placeholder/no-cover state returns.
  await page.goto(`/dashboard/articles/${id}/edit`);
  await page.locator("#cover-remove-btn").click();
  await expect(page.locator("#cover-placeholder")).toBeVisible();
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });

  await page.reload();
  await expect(page.locator("#cover-img")).toBeHidden();

  await page.goto(`/articles/${slugify(title)}`);
  await expect(page.locator(".cover-img")).toHaveCount(0);
});

test("E2E-47 admin can unpublish a published article (it leaves the public site)", async ({ page }) => {
  const title = `Unpublish Me ${Date.now()}`;
  await signUpAndLogin(page, `unpub-author-${Date.now()}@vrc6.com`);
  const id = await writeAndSubmit(page, title);

  // Admin approves → published + public.
  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await page.goto(`/dashboard/articles/${id}/edit`);
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);
  await page.goto(`/articles/${slugify(title)}`);
  await expect(page.locator("h1")).toContainText(title);

  // Admin unpublishes → back to a draft, and no longer public.
  await page.goto(`/dashboard/articles/${id}/edit`);
  await page.getByRole("button", { name: "UNPUBLISH" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/articles/${id}/edit`));
  await expect(page.locator(".tagpill")).toHaveText("DRAFT");

  await page.context().clearCookies();
  const res = await page.request.get(`/articles/${slugify(title)}`);
  expect(res.status()).toBe(404);
});

test("E2E-48 an editor can delete their own draft", async ({ page }) => {
  await signUpAndLogin(page, `deleter-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });

  const title = `Trash Me ${Date.now()}`;
  await page.locator("#art-title").fill(title);
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });

  // Accept the confirm dialog, then delete.
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "DELETE", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/dashboard`);

  // Gone from the dashboard list.
  await expect(page.locator(".article-row", { hasText: title })).toHaveCount(0);
});

test("E2E-54 editor dashboard: status filter narrows the list and surfaces a rejection reason", async ({
  page,
}) => {
  const authorEmail = `dashfilter-${Date.now()}@vrc6.com`;
  await signUpAndLogin(page, authorEmail);

  // A plain, never-submitted draft.
  const draftTitle = `Untouched Draft ${Date.now()}`;
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("#art-title").fill(draftTitle);
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });

  // A second draft, submitted then rejected — ends up back as a draft with a reason.
  const rejectedTitle = `Sent Back ${Date.now()}`;
  const rejectedId = await writeAndSubmit(page, rejectedTitle);
  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await page.goto(`/dashboard/articles/${rejectedId}/edit`);
  await page.locator("input[name='reason']").fill("Needs more detail.");
  await page.getByRole("button", { name: "REJECT" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  // Back as the author: both drafts show up, and the rejected one carries its
  // reason prominently on the dashboard row (not just inside the editor).
  await page.context().clearCookies();
  await signUpAndLogin(page, authorEmail);
  await page.goto("/dashboard");
  await expect(page.locator(".article-row", { hasText: draftTitle })).toBeVisible();
  await expect(page.locator(".article-row", { hasText: rejectedTitle })).toBeVisible();
  const rejectedRow = page.locator(".article-row", { hasText: rejectedTitle });
  await expect(rejectedRow.locator(".a-rejection")).toContainText("Needs more detail.");
  await expect(page.locator(".article-row", { hasText: draftTitle }).locator(".a-rejection")).toHaveCount(0);

  // Filtering by "pending review" hides both (they're drafts again).
  await page.locator("select[name='status']").selectOption("pending_review");
  await page.getByRole("button", { name: "FILTER" }).click();
  await expect(page.locator(".article-row", { hasText: draftTitle })).toHaveCount(0);
  await expect(page.locator(".article-row", { hasText: rejectedTitle })).toHaveCount(0);

  // Filtering by "draft" shows both again.
  await page.goto("/dashboard?status=draft");
  await expect(page.locator(".article-row", { hasText: draftTitle })).toBeVisible();
  await expect(page.locator(".article-row", { hasText: rejectedTitle })).toBeVisible();
});

test("E2E-55 admin dashboard shows content/user counts and recent activity", async ({ page }) => {
  const authorEmail = `dashstats-${Date.now()}@vrc6.com`;
  await signUpAndLogin(page, authorEmail);

  // One plain draft, one submitted-for-review.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });
  const pendingId = await writeAndSubmit(page, `Stats Pending ${Date.now()}`);

  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await page.goto("/admin");
  const statBox = (label: string) =>
    page.locator(".stat-box", { hasText: label }).locator(".stat-n");
  // At least the draft + the pending-review article just created.
  await expect(page.locator(".stat-n")).toHaveCount(6);
  expect(Number(await statBox("DRAFTS").textContent())).toBeGreaterThanOrEqual(1);
  expect(Number(await statBox("PENDING REVIEW").textContent())).toBeGreaterThanOrEqual(1);
  expect(Number(await statBox("ACTIVE USERS").textContent())).toBeGreaterThanOrEqual(1);

  // Approving bumps PUBLISHED, and recent activity is no longer empty (plenty
  // of admin actions have already happened by this point in the suite).
  const approveRes = await page.request.post(`/api/articles/${pendingId}/approve`, { data: {} });
  expect(approveRes.ok()).toBeTruthy();
  // A page.request write immediately followed by a page.goto can hang (see
  // gotoRetry's doc comment) even when the target route was already visited —
  // a throwaway navigation in between reliably avoids it.
  await gotoRetry(page, "/");
  await gotoRetry(page, "/admin");
  expect(Number(await statBox("PUBLISHED").textContent())).toBeGreaterThanOrEqual(1);
  await expect(page.getByText("No audit entries yet.")).toHaveCount(0);
  await expect(page.locator(".activity-row").first()).toBeVisible();
});
