import type { APIRoute } from "astro";
import { and, eq, ne } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../db";
import { canEditArticle } from "../../../lib/permissions";
import { isDocJson, MAX_BODY_BYTES } from "../../../lib/body";
import { slugify } from "../../../lib/text";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MAX_TITLE = 200;
const MAX_EXCERPT = 500;

// Derive a unique slug from the title, ignoring the article's own row. Falls
// back to the existing slug when the title has no slug-able characters yet.
async function uniqueSlug(
  db: ReturnType<typeof getDb>,
  title: string,
  id: number,
  fallback: string,
): Promise<string> {
  const base = slugify(title);
  if (!base) return fallback;
  const clash = await db
    .select({ id: schema.articles.id })
    .from(schema.articles)
    .where(and(eq(schema.articles.slug, base), ne(schema.articles.id, id)))
    .limit(1);
  // `-${id}` is guaranteed unique (id is the PK) when the base is taken.
  return clash.length ? `${base}-${id}` : base;
}

// PUT /api/articles/:id — autosave the draft's title / excerpt / body.
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const actor = locals.user;
  if (!actor) return json({ error: "Unauthorized" }, 401);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, 400);

  const db = getDb(env.DB);
  const [article] = await db
    .select({ authorId: schema.articles.authorId, status: schema.articles.status, slug: schema.articles.slug })
    .from(schema.articles)
    .where(eq(schema.articles.id, id))
    .limit(1);
  if (!article) return json({ error: "Not found" }, 404);
  if (!canEditArticle(actor, article)) return json({ error: "Forbidden" }, 403);

  let payload: { title?: unknown; excerpt?: unknown; body?: unknown; categoryId?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Body: must be a plausible TipTap doc and within the size budget.
  if (!isDocJson(payload.body)) return json({ error: "Invalid body" }, 400);
  if (JSON.stringify(payload.body).length > MAX_BODY_BYTES) {
    return json({ error: "Body too large" }, 413);
  }

  const title = (typeof payload.title === "string" ? payload.title : "").trim().slice(0, MAX_TITLE) || "Untitled draft";
  const excerptRaw = typeof payload.excerpt === "string" ? payload.excerpt.trim().slice(0, MAX_EXCERPT) : "";
  const excerpt = excerptRaw || null;
  const slug = await uniqueSlug(db, title, id, article.slug);
  // Category: accept a real category id, else clear it. Verify membership so a
  // bad id can't trip the FK (and to ignore junk input).
  const catId = Number(payload.categoryId);
  let categoryId: number | null = null;
  if (Number.isInteger(catId) && catId > 0) {
    const [cat] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.id, catId))
      .limit(1);
    categoryId = cat ? catId : null;
  }
  const updatedAt = new Date();

  await db
    .update(schema.articles)
    .set({ title, excerpt, body: payload.body, categoryId, slug, updatedAt })
    .where(eq(schema.articles.id, id));

  return json({ ok: true, slug, updatedAt: updatedAt.getTime() });
};
