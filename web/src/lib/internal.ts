// Trusted-call marker for in-process auth API calls. Some admin flows (e.g. the
// invite endpoint calling signUpEmail / requestPasswordReset) re-enter
// better-auth's endpoint pipeline, which would otherwise trip the public
// Turnstile / rate-limit / invite-only before-hook. We tag those in-process
// calls with a header that a browser client can't forge.
//
// The marker is DERIVED from BETTER_AUTH_SECRET rather than being the secret
// itself. It previously sent the raw secret as a header value — the same key
// that signs session cookies and encrypts TOTP secrets — so any future
// header-logging bug (a Sentry beforeSend that captures headers, a debug
// middleware, a proxy access log) would have escalated from "bypass token
// leaked" to "attacker can forge any session". A one-way HMAC means a leak of
// the marker costs only the marker.
import { env } from "cloudflare:workers";

export const INTERNAL_HEADER = "x-vrc6-internal";

// Fixed label so the derived value is domain-separated from any other use of
// the secret — deriving from a constant means the marker is stable per
// deployment without ever transmitting the secret itself.
const DERIVATION_LABEL = "vrc6:internal-call:v1";

let cachedMarker: string | null = null;

function secret(): string {
  return (env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET ?? "";
}

/**
 * HMAC-SHA256(secret, label), hex-encoded. Memoised per isolate — the inputs
 * are constant for the lifetime of a deployment.
 */
async function marker(): Promise<string> {
  if (cachedMarker !== null) return cachedMarker;
  const s = secret();
  if (s.length === 0) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(s),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(DERIVATION_LABEL));
  cachedMarker = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return cachedMarker;
}

/** Header object to spread onto a trusted in-process auth.api call. */
export async function internalHeaders(base?: Headers): Promise<Headers> {
  const headers = new Headers(base);
  // Always overwrite: `base` may be an inbound client request's headers, and an
  // attacker-supplied value must never survive into a trusted call.
  headers.set(INTERNAL_HEADER, await marker());
  return headers;
}

/**
 * Constant-time string comparison. Length is not secret here (the marker is a
 * fixed-width hex digest), so an early length check is fine; the byte loop
 * avoids the short-circuit that `===` would take on the first differing byte.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when a request carries the valid internal marker (trusted server call). */
export async function isInternalCall(headers: Headers | null | undefined): Promise<boolean> {
  const expected = await marker();
  if (expected.length === 0) return false;
  const got = headers?.get(INTERNAL_HEADER);
  if (typeof got !== "string") return false;
  return timingSafeEqual(got, expected);
}
