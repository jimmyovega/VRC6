import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../../db";
import { getArticleById } from "../../../../db/queries";
import { canSubmitArticle } from "../../../../lib/permissions";
import { whyCannotSubmit } from "../../../../lib/article";
import { logAudit } from "../../../../lib/audit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/articles/:id/submit — move an author's own draft to pending_review.
// A browser <form> submit is redirected back to the dashboard; JSON callers
// get { ok }.
export const POST: APIRoute = async ({ params, locals, request }) => {
  const actor = locals.user;
  if (!actor) return json({ error: "Unauthorized" }, 401);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, 400);

  const db = getDb(env.DB);
  const article = await getArticleById(db, id);
  if (!article) return json({ error: "Not found" }, 404);
  if (!canSubmitArticle(actor, article)) return json({ error: "Forbidden" }, 403);

  const blocker = whyCannotSubmit(article);
  if (blocker) return json({ error: blocker }, 400);

  await db
    .update(schema.articles)
    .set({ status: "pending_review", updatedAt: new Date() })
    .where(eq(schema.articles.id, id));
  await logAudit(db, { actorId: actor.id, action: "article.submit", targetArticleId: id });

  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) return new Response(null, { status: 303, headers: { Location: "/dashboard" } });
  return json({ ok: true });
};
