// Response headers applied to every request by the middleware. Each one
// closes a specific gap from the security audit — none were set anywhere in
// the app before this.
//
// CSP is the most load-bearing: `src/lib/body.ts` is the app's hand-written
// XSS boundary (it escapes text and allowlists URL schemes/CSS values), and
// CSP is the second line of defense if that renderer ever regresses. Every
// source listed below is grounded in an actual usage in this codebase, found
// by grepping for every external origin, every <script>, and every inline
// style attribute the app emits — not copied from a generic template.

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
 * - `script-src`: only Turnstile's widget script (`login.astro`,
 *   `forgot-password.astro`) loads from an external host. Every other
 *   `<script>` in the app is a plain (non-`is:inline`) block, which Astro/Vite
 *   extracts to a same-origin bundled file at build time — confirmed against
 *   the built output. No `'unsafe-inline'`/`'unsafe-eval'` needed.
 * - `style-src-elem` vs `style-src-attr` (Astro 7.1+ supports the split):
 *   component `<style>` blocks are always extracted to same-origin CSS files
 *   at build time — also confirmed against the built output — so
 *   `style-src-elem` stays strict. But `body.ts`, `ArticleCard.astro`, and the
 *   carousel emit inline `style="…"` attributes (text-align, aspect-ratio,
 *   object-position), all already allowlisted/numerically clamped at the
 *   point they're written. Scoping `'unsafe-inline'` to `style-src-attr` only
 *   means a `<style>` tag injection stays blocked even if that allowlisting
 *   ever failed — the blanket `style-src 'unsafe-inline'` most CSPs settle
 *   for would not have that property.
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
  // DIAGNOSTIC: CSP itself disabled to bisect the CI E2E anomaly against HSTS
  // (localhost + non-HTTPS is a known-sensitive combination for it). NOT for merge.
  // headers.set("Content-Security-Policy", buildCsp(env));
  void buildCsp;
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
