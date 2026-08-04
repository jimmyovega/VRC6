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

const mediaEnv = env as typeof env & {
  MEDIA: R2Bucket;
  MEDIA_BASE_URL?: string;
  IMAGES: ImagesBinding;
};

/** Quality passed to the Images binding's WebP encoder — a standard balance of size vs fidelity. */
const WEBP_QUALITY = 80;

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

  // Every accepted upload — including ones already sniffed as image/webp — is
  // re-encoded through the Images binding, so every stored key is a genuine
  // WebP at a known quality, not just whatever compression the uploader's own
  // tool happened to produce. Smaller stored/served bytes = faster page loads
  // on a site that renders many images per page.
  let webp: ArrayBuffer;
  try {
    // The Images binding's input requires a stream with a known length — a
    // plain ReadableStream (including one re-derived from a parsed multipart
    // part) doesn't carry that, so the bytes are piped through a
    // FixedLengthStream (the Workers runtime's purpose-built type for this)
    // instead. The transform's own output stream has the same constraint and
    // R2's put() would hit it too if handed the stream directly, so the
    // result is buffered to an ArrayBuffer here rather than streamed straight
    // into R2 — fine at this size (uploads are capped at 5 MB).
    const { readable, writable } = new FixedLengthStream(bytes.byteLength);
    const writer = writable.getWriter();
    // Deliberately not awaited here — must run concurrently with .input()
    // below reading the other end, not sequentially before it. Errors are
    // still surfaced: a write failure aborts the readable side, so .input()'s
    // own read rejects and is caught below; this just stops it from also
    // surfacing as an unhandled promise rejection.
    void writer
      .write(new Uint8Array(bytes))
      .then(() => writer.close())
      .catch((err) => writer.abort(err));

    const transformed = await mediaEnv.IMAGES.input(readable)
      .transform({})
      .output({ format: "image/webp", quality: WEBP_QUALITY });
    webp = await transformed.response().arrayBuffer();
  } catch (err) {
    log.error("image conversion failed", {
      userId: actor.id,
      sniffed,
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: "Couldn't process that image. Try a different file." }, 500);
  }

  const key = newImageKey("image/webp")!;
  await mediaEnv.MEDIA.put(key, webp, {
    httpMetadata: { contentType: "image/webp" },
  });
  log.info("media uploaded", { userId: actor.id, key, size: file.size });

  return json({ url: mediaUrl(key, mediaEnv.MEDIA_BASE_URL), key }, 201);
};
