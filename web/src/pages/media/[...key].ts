import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

const mediaEnv = env as typeof env & { MEDIA: R2Bucket };

// GET /media/<key> — stream a stored object from R2. Used in local dev / E2E and
// as a same-origin fallback; in prod these are normally served directly from the
// media.vrc6.com custom domain (which hits R2's CDN without touching the Worker).
//
// That split matters for anything set here: this route's headers (including
// the security ones below) only apply to the same-origin fallback path — the
// production media.vrc6.com domain bypasses this file, and this repo has no
// control over headers R2 serves there (that's Cloudflare dashboard/R2 bucket
// config). The real fix for the risk that mattered — a stored object being
// served as something executable — is that its declared content-type is now
// sniffed from the real bytes at write time (see api/uploads.ts), not
// response headers on read, so it holds regardless of which domain serves it.
export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key) return new Response("Not found", { status: 404 });

  const object = await mediaEnv.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  // Trustworthy since api/uploads.ts: the content-type stored on the object
  // is sniffed from the actual bytes at write time, not the client's
  // declaration, so this can never diverge from what the file really is.
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Keys are content-unique (UUID), so objects are safe to cache forever.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  // Explicit here too, even though middleware sets it globally — this route
  // is the one place a stored object's declared type reaches a response, so
  // it shouldn't depend on the global default remaining in place to stay
  // safe. No Content-Disposition: inline rendering is the whole point of an
  // image route, and svg+xml (the one type that would make inline rendering
  // dangerous) is excluded from uploads at both the allowlist and the
  // magic-byte sniff — never in TYPE_EXT, never recognized by sniffImageType.
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
};
