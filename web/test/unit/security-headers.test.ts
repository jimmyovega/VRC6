import { describe, expect, it } from "vitest";
import { applySecurityHeaders, buildCsp } from "../../src/lib/security-headers";

describe("buildCsp", () => {
  it("is a single-line, semicolon-separated policy with no directive left empty", () => {
    const csp = buildCsp({});
    expect(csp).not.toContain("\n");
    for (const directive of csp.split(";").map((d) => d.trim())) {
      expect(directive.length).toBeGreaterThan(0);
    }
  });

  it("default-src is 'self' — nothing loads cross-origin unless a directive explicitly allows it", () => {
    expect(buildCsp({})).toContain("default-src 'self'");
  });

  it("allows the Turnstile widget script, iframe, and its own network calls", () => {
    const csp = buildCsp({});
    expect(csp).toContain("challenges.cloudflare.com");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("connect-src 'self' https://challenges.cloudflare.com");
  });

  it("script-src and style-src-elem never allow inline", () => {
    // astro.config.mjs forces every script/style external
    // (build.inlineStylesheets: 'never' + vite.build.assetsInlineLimit: 0),
    // so neither directive needs 'unsafe-inline' — verified live via a
    // wrangler dev build with zero inline <script>/<style> in the rendered
    // HTML. style-src-attr still allows inline for the renderer's own
    // sanctioned alignment/aspect-ratio attributes — unrelated to this.
    const csp = buildCsp({});
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    const styleElem = csp.split(";").find((d) => d.trim().startsWith("style-src-elem"));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'self'");
    expect(styleElem).not.toContain("'unsafe-inline'");
    expect(styleElem).toContain("https://fonts.googleapis.com");
  });

  it("script-src never contains unsafe-eval", () => {
    const scriptSrc = buildCsp({}).split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("allows Google Fonts' static font files", () => {
    expect(buildCsp({})).toContain("font-src 'self' https://fonts.gstatic.com");
  });

  it("img-src falls back to same-origin only when MEDIA_BASE_URL is unset (local dev/CI)", () => {
    expect(buildCsp({})).toContain("img-src 'self'");
    expect(buildCsp({ MEDIA_BASE_URL: undefined })).toContain("img-src 'self'");
  });

  it("img-src includes the R2 media origin when MEDIA_BASE_URL is set", () => {
    const csp = buildCsp({ MEDIA_BASE_URL: "https://media.vrc6.com" });
    expect(csp).toContain("img-src 'self' https://media.vrc6.com");
  });

  it("reduces MEDIA_BASE_URL to its origin, dropping any path/query", () => {
    // mediaUrl() builds `${base}/${key}` — if MEDIA_BASE_URL ever carried a
    // path, img-src must still match on origin only, not fail closed.
    const csp = buildCsp({ MEDIA_BASE_URL: "https://media.vrc6.com/some/path?x=1" });
    expect(csp).toContain("img-src 'self' https://media.vrc6.com");
    expect(csp).not.toContain("/some/path");
  });

  it("ignores an unparseable MEDIA_BASE_URL rather than emitting garbage into the header", () => {
    const csp = buildCsp({ MEDIA_BASE_URL: "not a url" });
    expect(csp).toContain("img-src 'self'");
    expect(csp).not.toContain("not a url");
  });

  it("denies framing this site from anywhere", () => {
    expect(buildCsp({})).toContain("frame-ancestors 'none'");
  });

  it("denies plugin content and restricts <base>/form targets to same-origin", () => {
    const csp = buildCsp({});
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});

describe("applySecurityHeaders", () => {
  it("sets every header exactly once", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, {});
    expect(headers.get("Content-Security-Policy")).toBeTruthy();
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
  });

  it("does not clobber unrelated headers already on the response", () => {
    const headers = new Headers({ "x-trace-id": "abc123" });
    applySecurityHeaders(headers, {});
    expect(headers.get("x-trace-id")).toBe("abc123");
  });

  it("HSTS includes subdomains", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, {});
    expect(headers.get("Strict-Transport-Security")).toContain("includeSubDomains");
  });
});
