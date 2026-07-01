import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "../../src/lib/turnstile";

describe("turnstile siteverify", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns true when Cloudflare reports success", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyTurnstileToken("secret", "token")).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns false when Cloudflare reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }))),
    );
    expect(await verifyTurnstileToken("secret", "bad-token")).toBe(false);
  });

  it("treats a network error as a failed verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await verifyTurnstileToken("secret", "token")).toBe(false);
  });
});
