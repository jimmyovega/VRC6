import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "../../src/lib/email";

// RESEND_API_KEY is present in the test bindings, but EMAIL_DISABLED=1 must keep
// every send log-only so tests never make a live Resend call (see vitest.config.ts).
describe("sendEmail EMAIL_DISABLED", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never makes a live request when disabled, even with a key present", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await sendEmail({
      to: "x@vrc6.com",
      subject: "Hi",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, dev: true });
  });
});
