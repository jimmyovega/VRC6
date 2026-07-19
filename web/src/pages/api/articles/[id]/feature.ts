import type { APIRoute } from "astro";
import { eq, ne } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../../db";
import { getArticleById } from "../../../../db/queries";
import { isAdmin } from "../../../../lib/permissions";
import { logAudit } from "../../../../lib/audit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/articles/:id/feature — admin-only. Only one article is featured at
// a time: setting featured=true clears every other article's flag first (in
// the same D1 batch, so the swap is atomic). Only a published article can be
// featured — it wouldn't be visible anywhere otherwise.
export const POST: APIRoute = async ({ params, locals, request }) => {
  const actor = locals.user;
  if (!actor) return json({ error: "Unauthorized" }, 401);
  if (!isAdmin(actor)) return json({ error: "Forbidden" }, 403);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, 400);

  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  let featured: boolean;
  if (isJson) {
    const body = (await request.json().catch(() => ({}))) as { featured?: unknown };
    featured = body.featured === true;
  } else {
    const form = await request.formData().catch(() => null);
    featured = String(form?.get("featured") ?? "") === "true";
  }

  const db = getDb(env.DB);
  const article = await getArticleById(db, id);
  if (!article) return json({ error: "Not found" }, 404);
  if (featured && article.status !== "published") {
    return json({ error: "Only a published article can be featured." }, 400);
  }

  const now = new Date();
  if (featured) {
    // Atomic swap: clear every other article's flag, then set this one.
    await db.batch([
      db.update(schema.articles).set({ featured: false }).where(ne(schema.articles.id, id)),
      db.update(schema.articles).set({ featured: true, updatedAt: now }).where(eq(schema.articles.id, id)),
    ]);
  } else {
    await db.update(schema.articles).set({ featured: false, updatedAt: now }).where(eq(schema.articles.id, id));
  }

  await logAudit(db, {
    actorId: actor.id,
    action: featured ? "article.feature" : "article.unfeature",
    targetArticleId: id,
  });

  if (!isJson) {
    return new Response(null, { status: 303, headers: { Location: "/admin/articles" } });
  }
  return json({ ok: true, featured });
};
