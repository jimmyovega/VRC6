import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../../db";
import { getArticleById } from "../../../../db/queries";
import { canApproveArticle } from "../../../../lib/permissions";
import { logAudit } from "../../../../lib/audit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/articles/:id/unpublish — admin pulls a published article back to a
// draft (leaves the public site; the author can revise and resubmit). Also
// clears the feature flag since a non-published article can't be featured.
export const POST: APIRoute = async ({ params, locals, request }) => {
  const actor = locals.user;
  if (!actor) return json({ error: "Unauthorized" }, 401);
  if (!canApproveArticle(actor)) return json({ error: "Forbidden" }, 403);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, 400);

  const db = getDb(env.DB);
  const article = await getArticleById(db, id);
  if (!article) return json({ error: "Not found" }, 404);
  if (article.status !== "published") {
    return json({ error: "Only a published article can be unpublished." }, 400);
  }

  await db
    .update(schema.articles)
    .set({ status: "draft", featured: false, updatedAt: new Date() })
    .where(eq(schema.articles.id, id));
  await logAudit(db, { actorId: actor.id, action: "article.unpublish", targetArticleId: id });

  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) {
    return new Response(null, { status: 303, headers: { Location: `/dashboard/articles/${id}/edit` } });
  }
  return json({ ok: true });
};
