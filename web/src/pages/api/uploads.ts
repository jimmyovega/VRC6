import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  MAX_IMAGE_BYTES,
  isAllowedImageType,
  mediaUrl,
  newImageKey,
  sniffImageType,
} from "../../lib/media";
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
  // Fast-path rejection on the client's own claim — saves reading the body of
  // an obviously-wrong upload. This is NOT the security check; see below.
  if (!isAllowedImageType(file.type)) {
    return json({ error: "Unsupported image type (use JPEG, PNG, WebP, or GIF)." }, 415);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return json({ error: "Image is too large (max 5 MB)." }, 413);
  }

  const bytes = await file.arrayBuffer();
  // The real check: identify the type from the bytes actually received, not
  // the client-declared Content-Type on the multipart part (fully
  // attacker-controlled — a request can declare image/png over arbitrary
  // bytes). Everything downstream — extension, stored key, and the
  // content-type the object is re-served with — is sourced from this sniffed
  // value, so a mismatched declaration can never reach storage.
  const sniffed = sniffImageType(new Uint8Array(bytes));
  if (!sniffed || sniffed !== file.type) {
    log.warn("upload rejected — declared type doesn't match file content", {
      userId: actor.id,
      declared: file.type,
      sniffed,
    });
    return json({ error: "The file's content doesn't match a supported image type." }, 415);
  }

  const key = newImageKey(sniffed)!;
  await mediaEnv.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: sniffed },
  });
  log.info("media uploaded", { userId: actor.id, key, size: file.size });

  return json({ url: mediaUrl(key, mediaEnv.MEDIA_BASE_URL), key }, 201);
};
