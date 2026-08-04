import { describe, expect, it } from "vitest";
import { signupFlagOpen } from "../../src/lib/auth";

// VRC6 is invite-only. Public sign-up was once wide open, which let anyone
// self-register an active editor account (and grab admin if their address was
// listed in ADMIN_EMAIL). The gate must fail CLOSED.
describe("public sign-up policy", () => {
  it("opens only for the exact string \"1\"", () => {
    expect(signupFlagOpen("1")).toBe(true);
  });

  it("stays closed when the flag is absent", () => {
    expect(signupFlagOpen(undefined)).toBe(false);
    expect(signupFlagOpen("")).toBe(false);
  });

  it("stays closed for values that read as 'off' but are truthy in JS", () => {
    // The whole point of the exact-match: `!!"0"` and `!!"false"` are both true.
    expect(signupFlagOpen("0")).toBe(false);
    expect(signupFlagOpen("false")).toBe(false);
    expect(signupFlagOpen("no")).toBe(false);
    expect(signupFlagOpen("off")).toBe(false);
  });

  it("stays closed for near-misses rather than coercing them open", () => {
    expect(signupFlagOpen("true")).toBe(false);
    expect(signupFlagOpen("yes")).toBe(false);
    expect(signupFlagOpen(" 1")).toBe(false);
    expect(signupFlagOpen("1 ")).toBe(false);
    expect(signupFlagOpen("11")).toBe(false);
  });
});

// Note: publicSignupAllowed() itself isn't asserted here. It reads the ambient
// Worker env, and the test runner inherits .dev.vars (which sets the flag so the
// E2E fixtures can register) — so any expectation would assert local config
// rather than code. The production default is covered end-to-end instead: see
// the invite-only checks in e2e/auth.spec.ts.
