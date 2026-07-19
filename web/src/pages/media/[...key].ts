import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

const mediaEnv = env as typeof env & { MEDIA: R2Bucket };

// GET /media/<key> — stream a stored object from R2. Used in local dev / E2E and
// as a same-origin fallback; in prod these are normally served directly from the
// media.vrc6.com custom domain (which hits R2's CDN without touching the Worker).
export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key) return new Response("Not found", { status: 404 });

  const object = await mediaEnv.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers); // content-type from stored metadata
  headers.set("etag", object.httpEtag);
  // Keys are content-unique (UUID), so objects are safe to cache forever.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
};
