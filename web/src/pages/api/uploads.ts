import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { MAX_IMAGE_BYTES, isAllowedImageType, mediaUrl, newImageKey } from "../../lib/media";
import { log } from "../../lib/log";

const mediaEnv = env as typeof env & { MEDIA: R2Bucket; MEDIA_BASE_URL?: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /api/uploads — authenticated image upload to R2. Any signed-in user
// (author) may upload; returns the public URL to embed in the article body.
export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.user;
  if (!actor) return json({ error: "Unauthorized" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Expected multipart form data." }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file provided." }, 400);
  if (!isAllowedImageType(file.type)) {
    return json({ error: "Unsupported image type (use JPEG, PNG, WebP, or GIF)." }, 415);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return json({ error: "Image is too large (max 5 MB)." }, 413);
  }

  const key = newImageKey(file.type)!;
  await mediaEnv.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  log.info("media uploaded", { userId: actor.id, key, size: file.size });

  return json({ url: mediaUrl(key, mediaEnv.MEDIA_BASE_URL), key }, 201);
};
