import { describe, expect, it } from "vitest";
import { originIsTrusted, requiresOriginCheck, siteOrigin } from "../../src/lib/origin-check";

describe("requiresOriginCheck", () => {
  it("skips the safe methods (RFC 9110)", () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "get", "Head"]) {
      expect(requiresOriginCheck(m)).toBe(false);
    }
  });

  it("requires the check for every state-changing method", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(requiresOriginCheck(m)).toBe(true);
    }
  });
});

describe("originIsTrusted", () => {
  const SITE = "https://vrc6.com";

  it("trusts a matching origin", () => {
    expect(originIsTrusted("https://vrc6.com", SITE)).toBe(true);
  });

  it("rejects a mismatched origin — the actual attack this exists to stop", () => {
    expect(originIsTrusted("https://evil.example", SITE)).toBe(false);
  });

  it("rejects a same-domain-looking but different origin (scheme, port, or subdomain)", () => {
    expect(originIsTrusted("http://vrc6.com", SITE)).toBe(false); // scheme
    expect(originIsTrusted("https://vrc6.com:8443", SITE)).toBe(false); // port
    expect(originIsTrusted("https://evil.vrc6.com", SITE)).toBe(false); // subdomain
    expect(originIsTrusted("https://vrc6.com.evil.example", SITE)).toBe(false); // suffix trick
  });

  it("allows a missing Origin through — deliberately lenient, see the doc comment", () => {
    expect(originIsTrusted(null, SITE)).toBe(true);
  });

  it("treats an empty string the same as absent (Headers#get never actually returns one)", () => {
    expect(originIsTrusted("", SITE)).toBe(true);
  });
});

describe("siteOrigin", () => {
  // Root cause of a real bug: comparing against context.url.origin (the
  // request as the runtime re-derives it) rather than a fixed configured
  // value made every real browser-driven form POST in CI time out for 30s —
  // the login form's native submission carries a genuine Origin header that
  // wrangler dev's local proxying doesn't reliably mirror back through
  // context.url. BETTER_AUTH_URL is the fix: the one already-configured,
  // stable value the app uses for exactly this purpose elsewhere.

  it("reduces BETTER_AUTH_URL to its origin, dropping any path", () => {
    expect(siteOrigin("http://localhost:8788", "fallback")).toBe("http://localhost:8788");
    expect(siteOrigin("https://vrc6.com/some/path", "fallback")).toBe("https://vrc6.com");
  });

  it("falls back when BETTER_AUTH_URL is unset", () => {
    expect(siteOrigin(undefined, "http://localhost:8788")).toBe("http://localhost:8788");
  });

  it("falls back rather than throwing on an unparseable BETTER_AUTH_URL", () => {
    expect(siteOrigin("not a url", "http://localhost:8788")).toBe("http://localhost:8788");
  });
});
