import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { INTERNAL_HEADER, internalHeaders, isInternalCall } from "../../src/lib/internal";

// BETTER_AUTH_SECRET is provided as a test binding (see vitest.config.ts).
describe("internal trusted-call marker", () => {
  it("round-trips: internalHeaders() is recognised by isInternalCall()", async () => {
    expect(await isInternalCall(await internalHeaders())).toBe(true);
  });

  it("preserves existing headers when adding the marker", async () => {
    const base = new Headers({ "x-turnstile-token": "abc" });
    const tagged = await internalHeaders(base);
    expect(tagged.get("x-turnstile-token")).toBe("abc");
    expect(tagged.get(INTERNAL_HEADER)).toBeTruthy();
  });

  it("overwrites an attacker-supplied marker rather than trusting it", async () => {
    // invite.ts builds the trusted headers from the *inbound* request, so a
    // client-supplied value must never survive into the trusted call.
    const hostile = new Headers({ [INTERNAL_HEADER]: "attacker-controlled" });
    const tagged = await internalHeaders(hostile);
    expect(tagged.get(INTERNAL_HEADER)).not.toBe("attacker-controlled");
    expect(await isInternalCall(tagged)).toBe(true);
  });

  it("rejects missing or wrong markers", async () => {
    expect(await isInternalCall(null)).toBe(false);
    expect(await isInternalCall(new Headers())).toBe(false);
    expect(await isInternalCall(new Headers({ [INTERNAL_HEADER]: "not-the-secret" }))).toBe(false);
  });

  it("never transmits the signing secret itself", async () => {
    // The marker used to BE BETTER_AUTH_SECRET. It's now an HMAC of a fixed
    // label under that secret, so leaking the header can't forge sessions.
    const secret = (env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET;
    expect(secret).toBeTruthy();
    const value = (await internalHeaders()).get(INTERNAL_HEADER)!;
    expect(value).not.toBe(secret);
    expect(value).not.toContain(secret!);
    // SHA-256 hex digest.
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("presenting the raw secret is not accepted as the marker", async () => {
    const secret = (env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET!;
    expect(await isInternalCall(new Headers({ [INTERNAL_HEADER]: secret }))).toBe(false);
  });
});
