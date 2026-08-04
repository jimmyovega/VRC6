// Response headers applied to every request by the middleware. Each one
// closes a specific gap from the security audit — none were set anywhere in
// the app before this.
//
// CSP here is strict: no `'unsafe-inline'` on script-src or style-src-elem
// (see the doc comment on buildCsp() for the Astro build config that makes
// that possible) plus origin allowlisting (network/frame/image loads) and
// closing clickjacking/plugin-content/base-form injection. The actual XSS
// boundary is still `src/lib/body.ts` (escapes text, allowlists URL
// schemes/CSS values) — verified directly against its own test suite, not
// assumed. Every source listed below is grounded in an actual usage in this
// codebase, found by grepping for every external origin the app references —
// not copied from a generic template.

export interface SecurityHeadersEnv {
  MEDIA_BASE_URL?: string;
}

const CLOUDFLARE_CHALLENGES = "https://challenges.cloudflare.com";
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_STATIC = "https://fonts.gstatic.com";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy, built per-request so `img-src` tracks whatever
 * `MEDIA_BASE_URL` actually is in this environment (the R2 custom domain in
 * prod; unset in local dev/CI, where media serves same-origin through
 * `/media/<key>` instead — see `mediaUrl()` in lib/media.ts).
 *
 * - `script-src` / `style-src-elem` do NOT carry `'unsafe-inline'`. Getting
 *   here took a real detour: Astro inlines small, page-specific
 *   `<script>`/`<style>` blocks directly into HTML when they fall under
 *   Vite's size-based inlining threshold — confirmed by a live CSP violation
 *   naming the exact culprits, Layout.astro's nav-toggle/logout script and
 *   Breadcrumb.astro's scoped styles. Fixed at the source in
 *   `astro.config.mjs`: `build.inlineStylesheets: 'never'` plus
 *   `vite.build.assetsInlineLimit: 0` force every script/style external
 *   unconditionally, so the inlining this policy would otherwise need to
 *   tolerate never happens. (That fix relies on the app having zero framework
 *   islands — no `client:*` hydration — since Astro's own inlining controls
 *   are known to not apply to island-generated scripts/styles; re-check this
 *   note if a framework integration is ever added.)
 * - `frame-ancestors 'none'`: closes the clickjacking finding — the site was
 *   fully framable, including `/dashboard`, `/admin`, and
 *   `/dashboard/security` (2FA disable).
 */
export function buildCsp(env: SecurityHeadersEnv): string {
  const mediaOrigin = originOf(env.MEDIA_BASE_URL);
  const imgSrc = ["'self'", mediaOrigin].filter((v): v is string => v !== null).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' ${CLOUDFLARE_CHALLENGES}`,
    `style-src-elem 'self' ${GOOGLE_FONTS_CSS}`,
    "style-src-attr 'unsafe-inline'",
    `font-src 'self' ${GOOGLE_FONTS_STATIC}`,
    `img-src ${imgSrc}`,
    `connect-src 'self' ${CLOUDFLARE_CHALLENGES}`,
    `frame-src ${CLOUDFLARE_CHALLENGES}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** Applies every security header to a mutable Headers instance in place. */
export function applySecurityHeaders(headers: Headers, env: SecurityHeadersEnv): void {
  headers.set("Content-Security-Policy", buildCsp(env));
  // Prevents a stored payload (e.g. an upload whose declared content-type
  // doesn't match its bytes) from being MIME-sniffed into something
  // executable. Pairs with the upload magic-byte check.
  headers.set("X-Content-Type-Options", "nosniff");
  // Full URLs (including query strings) are never sent cross-origin. Matters
  // concretely for /reset-password?token=…, which loads third-party
  // subresources (Google Fonts, Turnstile) while a live token sits in the URL.
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // The app uses none of these; deny by default rather than leaving them open.
  headers.set("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  // `frame-ancestors` above is the modern equivalent and wins in any browser
  // that reads CSP; this is kept for the few that only honor the legacy header.
  headers.set("X-Frame-Options", "DENY");
  // Cloudflare's edge can add this via a zone-level HSTS setting, but that's
  // dashboard config outside this repo — setting it here means the app is
  // correct on its own regardless of the zone's dashboard configuration.
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}
