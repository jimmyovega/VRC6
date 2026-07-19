import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../../db";
import { getArticleById } from "../../../../db/queries";
import { canDeleteArticle } from "../../../../lib/permissions";
import { logAudit } from "../../../../lib/audit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/articles/:id/delete — soft-delete (sets deleted_at, so it drops out
// of every list query but audit refs survive). Author may delete their own
// draft; an admin may delete any article.
export const POST: APIRoute = async ({ params, locals, request }) => {
  const actor = locals.user;
  if (!actor) return json({ error: "Unauthorized" }, 401);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, 400);

  const db = getDb(env.DB);
  const article = await getArticleById(db, id);
  if (!article) return json({ error: "Not found" }, 404);
  if (!canDeleteArticle(actor, article)) return json({ error: "Forbidden" }, 403);

  const now = new Date();
  await db
    .update(schema.articles)
    .set({ deletedAt: now, featured: false, updatedAt: now })
    .where(eq(schema.articles.id, id));
  await logAudit(db, { actorId: actor.id, action: "article.delete", targetArticleId: id });

  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) return new Response(null, { status: 303, headers: { Location: "/dashboard" } });
  return json({ ok: true });
};
