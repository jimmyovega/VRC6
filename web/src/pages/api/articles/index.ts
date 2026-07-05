import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getDb, schema } from "../../../db";
import { logAudit } from "../../../lib/audit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Empty TipTap document — one blank paragraph so the editor has a cursor home.
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

// POST /api/articles — create a fresh draft owned by the current user. Any
// signed-in user (admin or editor) may author; the workflow (submit/approve)
// comes later. A browser <form> submission (non-JSON) is answered with a real
// redirect into the editor; API/fetch callers (application/json) get the id.
export const POST: APIRoute = async ({ locals, request }) => {
  const actor = locals.user;
  if (!actor) return json({ error: "Unauthorized" }, 401);

  const db = getDb(env.DB);
  // A collision-proof placeholder slug; it's re-derived from the title on save.
  const slug = `draft-${crypto.randomUUID().slice(0, 8)}`;
  const [created] = await db
    .insert(schema.articles)
    .values({
      title: "Untitled draft",
      body: EMPTY_DOC,
      authorId: actor.id,
      status: "draft",
      slug,
    })
    .returning({ id: schema.articles.id });

  await logAudit(db, {
    actorId: actor.id,
    action: "article.create",
    targetArticleId: created.id,
  });

  const editUrl = `/dashboard/articles/${created.id}/edit`;
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) {
    return new Response(null, { status: 303, headers: { Location: editUrl } });
  }
  return json({ id: created.id }, 201);
};
