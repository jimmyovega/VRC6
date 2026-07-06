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

// POST /api/articles/:id/reject — admin sends an article awaiting review back to
// the author as a draft, with a required reason. Accepts a form field or JSON.
export const POST: APIRoute = async ({ params, locals, request }) => {
  const actor = locals.user;
  if (!actor) return json({ error: "Unauthorized" }, 401);
  if (!canApproveArticle(actor)) return json({ error: "Forbidden" }, 403);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, 400);

  const db = getDb(env.DB);
  const article = await getArticleById(db, id);
  if (!article) return json({ error: "Not found" }, 404);
  if (article.status !== "pending_review") {
    return json({ error: "Article is not awaiting review." }, 400);
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  let reason = "";
  if (isJson) {
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    reason = (body.reason ?? "").trim();
  } else {
    const form = await request.formData().catch(() => null);
    reason = String(form?.get("reason") ?? "").trim();
  }
  reason = reason.slice(0, 500);
  if (!reason) return json({ error: "A rejection reason is required." }, 400);

  const now = new Date();
  await db
    .update(schema.articles)
    .set({ status: "draft", rejectionReason: reason, updatedAt: now })
    .where(eq(schema.articles.id, id));
  await logAudit(db, {
    actorId: actor.id,
    action: "article.reject",
    targetArticleId: id,
    details: { reason },
  });

  if (!isJson) return new Response(null, { status: 303, headers: { Location: "/admin/review" } });
  return json({ ok: true });
};
