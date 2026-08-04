// A minimal, explicit CSRF defense for the app's own state-changing endpoints
// (api/articles/*, api/admin/*, api/uploads — everything outside better-auth's
// own pipeline, which already runs its own origin check keyed off
// BETTER_AUTH_URL). Protection today is entirely implicit: better-auth's
// session cookie defaults to SameSite=Lax, which blocks cross-site form POSTs
// in current browsers, but nothing in this repo asserts that itself — it's
// one library default (or one browser quirk) away from a silent gap. This
// makes the same property structural instead of assumed.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Only non-"safe" HTTP methods (per RFC 9110) need an origin check at all. */
export function requiresOriginCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * True when the request may proceed.
 *
 * Lenient when `Origin` is absent, strict when it's present and wrong. That
 * asymmetry is deliberate, not a hole: a same-site, non-CORS request can
 * legitimately omit `Origin` (older browser navigations, some non-fetch
 * clients, this app's own E2E suite calling through Playwright's
 * `page.request`, which doesn't replicate full browser fetch semantics) — but
 * a cross-site attacker's forged form POST or fetch call, the thing this
 * check exists to stop, always carries an `Origin` header the browser sets
 * and the page can't override. A present-and-mismatched `Origin` is exactly
 * that signature; an absent one is not evidence of anything.
 */
export function originIsTrusted(origin: string | null, siteOrigin: string): boolean {
  if (!origin) return true;
  return origin === siteOrigin;
}
