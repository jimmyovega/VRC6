import { deflateSync } from "node:zlib";
import { expect, request as apiRequest, test } from "@playwright/test";

// A minimal, dependency-free PNG encoder (solid color, filter type 0) — used
// to prove a genuinely oversized inline image gets constrained by CSS, not
// just a 1x1 pixel that would render tiny regardless of any width rule.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const o = rowStart + 1 + x * 3;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

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

test("E2E-56 editor: panning the cover sets a focal point that persists", async ({ page }) => {
  const title = `Focus Story ${Date.now()}`;
  await signUpAndLogin(page, `focuser-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("#art-title").fill(title);

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

  // A fresh upload starts centered, and the small-card guide is shown.
  await expect(coverImg).toHaveAttribute("style", /object-position:\s*50% 50%/);
  await expect(page.locator("#cover-guide")).toBeVisible();

  // Drag the preview upward → focal point moves down the image (away from center).
  const box = (await page.locator("#cover-preview").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 80, { steps: 8 });
  await page.mouse.up();

  await expect(coverImg).not.toHaveAttribute("style", /object-position:\s*50% 50%/);
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });

  // The chosen focal point survives a reload (server-rendered from the saved value).
  await page.reload();
  await expect(page.locator("#cover-img")).not.toHaveAttribute(
    "style",
    /object-position:\s*50% 50%/,
  );
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

  // Reject (rather than approve) to generate a real, self-contained audit
  // entry for the recent-activity check below without ever touching the
  // `published` status — approving here would add a new published article
  // and could shift which seeded article lands on page 2 of the homepage
  // feed, an unrelated pagination test (E2E-07) elsewhere in the suite.
  const rejectRes = await page.request.post(`/api/articles/${pendingId}/reject`, {
    data: { reason: "Not today." },
  });
  expect(rejectRes.ok()).toBeTruthy();
  // A page.request write immediately followed by a page.goto can hang (see
  // gotoRetry's doc comment) even when the target route was already visited —
  // a throwaway navigation in between reliably avoids it.
  await gotoRetry(page, "/");
  await gotoRetry(page, "/admin");
  await expect(page.getByText("No audit entries yet.")).toHaveCount(0);
  await expect(page.locator(".activity-row").first()).toBeVisible();
});

test("E2E-57 a large inline body image is constrained to the prose column, not overflowing", async ({
  page,
}) => {
  await signUpAndLogin(page, `wideimg-${Date.now()}@vrc6.com`);
  const title = `Wide Image Story ${Date.now()}`;
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("#art-title").fill(title);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Text before the oversized image.");

  // A genuinely oversized (2000x900) image — proves the constraint actually
  // shrinks a real large image, not just that a tiny one happens to fit.
  const png = makePng(2000, 900, [220, 20, 140]);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('[data-cmd="image"]').click(),
  ]);
  await chooser.setFiles({ name: "wide.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".ProseMirror img")).toHaveCount(1, { timeout: 10_000 });

  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
  await expect(page).toHaveURL(`${BASE}/dashboard`);

  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await gotoRetry(page, "/admin/review");
  await page.locator(".review-row", { hasText: title }).getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  await page.context().clearCookies();
  await gotoRetry(page, `/articles/${slugify(title)}`);
  const img = page.locator(".body img");
  await expect(img).toBeVisible();

  const proseBox = (await page.locator(".prose").boundingBox())!;
  const imgBox = (await img.boundingBox())!;
  // The real 2000px-wide image renders no wider than its column, preserves
  // aspect ratio (doesn't distort), and sits flush with the column's left
  // edge (not centered/offset by an unconstrained overflow).
  expect(imgBox.width).toBeLessThanOrEqual(proseBox.width + 1);
  expect(imgBox.x).toBeGreaterThanOrEqual(proseBox.x - 1);
  expect(imgBox.x + imgBox.width).toBeLessThanOrEqual(proseBox.x + proseBox.width + 1);
  expect(imgBox.width / imgBox.height).toBeCloseTo(2000 / 900, 1);

  // And it gets the same lime border as the editor's own image styling.
  const borderColor = await img.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(borderColor).toBe("rgb(74, 222, 128)"); // --lime
});

test("E2E-58 editor: aligns a paragraph and an image, both render aligned on the public page", async ({
  page,
}) => {
  const title = `Aligned Story ${Date.now()}`;
  await signUpAndLogin(page, `aligner-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("#art-title").fill(title);

  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Centered paragraph text.");
  await page.locator('[data-cmd="alignCenter"]').click();
  await expect(page.locator('[data-cmd="alignCenter"]')).toHaveClass(/is-active/);

  // A new paragraph, then a right-aligned image in it. (Enter must not
  // steal focus to the alignCenter button — see the toolbar's mousedown
  // preventDefault, which is exactly what this exercises.)
  await page.keyboard.press("Enter");
  const png = makePng(400, 300, [30, 140, 220]);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('[data-cmd="image"]').click(),
  ]);
  await chooser.setFiles({ name: "align.png", mimeType: "image/png", buffer: png });
  const editorImg = page.locator(".ProseMirror img");
  await expect(editorImg).toHaveCount(1, { timeout: 10_000 });
  await editorImg.click(); // select the image node
  await page.locator('[data-cmd="alignRight"]').click();
  await expect(page.locator('[data-cmd="alignRight"]')).toHaveClass(/is-active/);

  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
  await expect(page).toHaveURL(`${BASE}/dashboard`);

  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await gotoRetry(page, "/admin/review");
  await page.locator(".review-row", { hasText: title }).getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  await page.context().clearCookies();
  await gotoRetry(page, `/articles/${slugify(title)}`);
  const centeredP = page.locator(".body p", { hasText: "Centered paragraph text." });
  await expect(centeredP).toHaveCSS("text-align", "center");
  const publicImg = page.locator(".body img");
  await expect(publicImg).toHaveAttribute("data-align", "right");
  // align:right resolves to margin-left:auto (some computed px) + margin-right:0.
  await expect(publicImg).toHaveCSS("margin-right", "0px");
});

test("E2E-59 editor: build a two-item image list, both thumbnails + excerpts render on the public page", async ({
  page,
}) => {
  const title = `Image List Story ${Date.now()}`;
  await signUpAndLogin(page, `imglist-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("#art-title").fill(title);

  await page.locator(".ProseMirror").click();

  // Start the list: the toolbar button asks for the first image immediately.
  const png1 = makePng(400, 260, [40, 180, 90]); // landscape
  const [chooser1] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('[data-cmd="imageList"]').click(),
  ]);
  await chooser1.setFiles({ name: "one.png", mimeType: "image/png", buffer: png1 });
  // First item appears; cursor is in its excerpt.
  await expect(page.locator(".ProseMirror .ili")).toHaveCount(1, { timeout: 10_000 });
  await page.keyboard.type("First caption");
  // The excerpt text is alignable (imageListItem is in the TextAlign types).
  await page.locator('[data-cmd="alignCenter"]').click();
  await expect(page.locator('[data-cmd="alignCenter"]')).toHaveClass(/is-active/);

  // Enter in a non-empty item prompts for the next image (the async keymap path
  // that the toolbar mousedown-preventDefault makes possible — keystrokes must
  // reach the editor, not a button).
  const png2 = makePng(240, 360, [180, 60, 200]); // portrait
  const [chooser2] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("Enter"),
  ]);
  await chooser2.setFiles({ name: "two.png", mimeType: "image/png", buffer: png2 });
  await expect(page.locator(".ProseMirror .ili")).toHaveCount(2, { timeout: 10_000 });
  await page.keyboard.type("Second caption");
  // Escape exits the list, leaving both items intact.
  await page.keyboard.press("Escape");

  // Both items are present in the editor with thumbnails + captions.
  await expect(page.locator(".ProseMirror .ili-thumb")).toHaveCount(2);
  await expect(page.locator(".ProseMirror .ili-text").first()).toHaveText("First caption");
  await expect(page.locator(".ProseMirror .ili-text").nth(1)).toHaveText("Second caption");

  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
  await expect(page).toHaveURL(`${BASE}/dashboard`);

  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await gotoRetry(page, "/admin/review");
  await page.locator(".review-row", { hasText: title }).getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  await page.context().clearCookies();
  await gotoRetry(page, `/articles/${slugify(title)}`);
  const list = page.locator(".body .image-list");
  await expect(list).toBeVisible();
  await expect(page.locator(".body .ili")).toHaveCount(2);
  const thumbs = page.locator(".body .ili-thumb");
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.first()).toBeVisible();
  // The image is a bounded thumbnail "bullet" (168px), not a full-width image.
  const thumbBox = (await thumbs.first().boundingBox())!;
  expect(thumbBox.width).toBeLessThanOrEqual(200);
  await expect(page.locator(".body .ili-text").first()).toHaveText("First caption");
  await expect(page.locator(".body .ili-text").nth(1)).toHaveText("Second caption");
  // The first item's excerpt was center-aligned via the toolbar; the second
  // keeps the default (computes to "start", the initial value).
  await expect(page.locator(".body .ili-text").first()).toHaveCSS("text-align", "center");
  await expect(page.locator(".body .ili-text").nth(1)).toHaveCSS("text-align", "start");
});

test("E2E-60 editor: insert a multi-image carousel; it renders a slideshow and the lightbox opens on the public page", async ({
  page,
}) => {
  const title = `Carousel Story ${Date.now()}`;
  await signUpAndLogin(page, `carousel-${Date.now()}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("#art-title").fill(title);

  await page.locator(".ProseMirror").click();
  // Body text so the draft is submittable (a carousel is an atom with no text).
  await page.keyboard.type("A gallery of images.");
  await page.keyboard.press("Enter");

  // Three images, mixed orientation: two landscape (2:1 and 3:2) and one
  // portrait. The viewport should size to the largest landscape ratio (2.0).
  const files = [
    { name: "wide.png", mimeType: "image/png", buffer: makePng(400, 200, [220, 40, 90]) },
    { name: "tall.png", mimeType: "image/png", buffer: makePng(200, 400, [40, 90, 220]) },
    { name: "mid.png", mimeType: "image/png", buffer: makePng(300, 200, [90, 220, 40]) },
  ];
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('[data-cmd="carousel"]').click(),
  ]);
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles(files);

  // The carousel NodeView renders all three slides in the editor.
  await expect(page.locator(".ProseMirror .carousel")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".ProseMirror .carousel-slide")).toHaveCount(3);

  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
  await expect(page).toHaveURL(`${BASE}/dashboard`);

  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await gotoRetry(page, "/admin/review");
  await page.locator(".review-row", { hasText: title }).getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);

  await page.context().clearCookies();
  await gotoRetry(page, `/articles/${slugify(title)}`);

  // Slideshow markup: one carousel, three slides, viewport sized to the
  // shortest-landscape ratio (2.0), plus arrows + dots for a multi-image set.
  const carousel = page.locator(".body .carousel");
  await expect(carousel).toBeVisible();
  await expect(page.locator(".body .carousel-slide")).toHaveCount(3);
  await expect(page.locator(".body .carousel-viewport")).toHaveAttribute(
    "style",
    /aspect-ratio:\s*2\.0000/,
  );
  await expect(page.locator(".body .carousel-arrow.prev")).toBeVisible();
  await expect(page.locator(".body .carousel-dot")).toHaveCount(3);

  // Clicking a slide opens the gallery lightbox; arrow-right advances the
  // counter; Escape closes it.
  const lightbox = page.locator(".carousel-lightbox");
  await expect(lightbox).toBeHidden();
  await page.locator(".body .carousel-slide").first().click();
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator(".cl-img")).toBeVisible();
  await expect(lightbox.locator(".cl-counter")).toHaveText("1 / 3");
  await page.keyboard.press("ArrowRight");
  await expect(lightbox.locator(".cl-counter")).toHaveText("2 / 3");
  await page.keyboard.press("Escape");
  await expect(lightbox).toBeHidden();
});

// Draft → type body → submit → (as owner) approve & publish. Returns the slug.
async function publishArticle(page: any, title: string, bodyText: string): Promise<string> {
  await signUpAndLogin(page, `width-${Date.now()}-${Math.random().toString(36).slice(2)}@vrc6.com`);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "+ NEW ARTICLE" }).click();
  await expect(page.locator("#art-title")).toBeVisible({ timeout: 15_000 });
  await page.locator("#art-title").fill(title);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type(bodyText);
  await page.locator("#art-category").selectOption({ index: 1 });
  await expect(page.locator("#save-status")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
  await expect(page).toHaveURL(`${BASE}/dashboard`);

  await page.context().clearCookies();
  await signUpAndLogin(page, "owner@vrc6.com");
  await gotoRetry(page, "/admin/review");
  await page.locator(".review-row", { hasText: title }).getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "APPROVE & PUBLISH" }).click();
  await expect(page).toHaveURL(`${BASE}/admin/review`);
  await page.context().clearCookies();
  return slugify(title);
}

test("E2E-61 article detail column width is consistent regardless of body length", async ({
  page,
}) => {
  // A one-line vs. a long-paragraph article — the detail page's two-column
  // layout (.article-layout) must be the same fixed width either way. It
  // previously shrank to fit the shortest article's widest line of content
  // (see the Bugs & Fixes gotcha: auto inline margins on a flex-item ancestor
  // pre-empt cross-axis stretch, so the box shrink-to-fit its content instead
  // of filling to max-width).
  const shortTitle = `Width Short ${Date.now()}`;
  const shortSlug = await publishArticle(page, shortTitle, "Short.");

  const longTitle = `Width Long ${Date.now()}`;
  const longBody =
    "Lorem ipsum dolor sit amet consectetur adipiscing elit. Quisque faucibus ex sapien " +
    "vitae pellentesque sem placerat. In id cursus mi pretium tellus duis convallis. " +
    "Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus.";
  const longSlug = await publishArticle(page, longTitle, longBody);

  await gotoRetry(page, `/articles/${shortSlug}`);
  const shortBox = (await page.locator(".article-layout").boundingBox())!;

  await gotoRetry(page, `/articles/${longSlug}`);
  const longBox = (await page.locator(".article-layout").boundingBox())!;

  expect(shortBox.width).toBeCloseTo(longBox.width, 0);
  expect(shortBox.x).toBeCloseTo(longBox.x, 0);
  // And it should actually be at the intended fixed column width, not some
  // other coincidentally-shared value.
  expect(shortBox.width).toBeGreaterThan(900);
});
