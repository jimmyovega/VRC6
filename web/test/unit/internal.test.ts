import { describe, expect, it } from "vitest";
import { INTERNAL_HEADER, internalHeaders, isInternalCall } from "../../src/lib/internal";

// BETTER_AUTH_SECRET is provided as a test binding (see vitest.config.ts).
describe("internal trusted-call marker", () => {
  it("round-trips: internalHeaders() is recognised by isInternalCall()", () => {
    expect(isInternalCall(internalHeaders())).toBe(true);
  });

  it("preserves existing headers when adding the marker", () => {
    const base = new Headers({ "x-turnstile-token": "abc" });
    const tagged = internalHeaders(base);
    expect(tagged.get("x-turnstile-token")).toBe("abc");
    expect(tagged.get(INTERNAL_HEADER)).toBeTruthy();
  });

  it("rejects missing or wrong markers", () => {
    expect(isInternalCall(null)).toBe(false);
    expect(isInternalCall(new Headers())).toBe(false);
    expect(isInternalCall(new Headers({ [INTERNAL_HEADER]: "not-the-secret" }))).toBe(false);
  });
});
