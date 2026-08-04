import { describe, expect, it } from "vitest";
import {
  assertSafeConfig,
  configProblems,
  flagEnabled,
  isProduction,
} from "../../src/lib/config-guard";

// A configuration that would pass in production: no bypass flags, all secrets.
const SAFE_PROD = {
  BETTER_AUTH_SECRET: "a-real-secret",
  TURNSTILE_SECRET_KEY: "0x-real-turnstile-secret",
  RESEND_API_KEY: "re_real_key",
};

describe("flagEnabled", () => {
  it("is true only for the exact string \"1\"", () => {
    expect(flagEnabled("1")).toBe(true);
  });

  it("is false for values that read as off but are truthy in JS", () => {
    // This is the whole reason the helper exists: `!!"0"` === true.
    expect(flagEnabled("0")).toBe(false);
    expect(flagEnabled("false")).toBe(false);
    expect(flagEnabled("no")).toBe(false);
  });

  it("is false for absent or non-string values", () => {
    expect(flagEnabled(undefined)).toBe(false);
    expect(flagEnabled(null)).toBe(false);
    expect(flagEnabled(1)).toBe(false);
    expect(flagEnabled(true)).toBe(false);
  });
});

describe("isProduction", () => {
  it("treats an unset environment as production", () => {
    // Fail closed: forgetting to set SENTRY_ENVIRONMENT must not be a way to
    // skip the checks.
    expect(isProduction({})).toBe(true);
    expect(isProduction({ SENTRY_ENVIRONMENT: "" })).toBe(true);
    expect(isProduction({ SENTRY_ENVIRONMENT: "   " })).toBe(true);
  });

  it("recognises the known non-production environments", () => {
    for (const name of ["development", "dev", "test", "ci", "local", "preview"]) {
      expect(isProduction({ SENTRY_ENVIRONMENT: name })).toBe(false);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isProduction({ SENTRY_ENVIRONMENT: "Development" })).toBe(false);
    expect(isProduction({ SENTRY_ENVIRONMENT: "  CI  " })).toBe(false);
  });

  it("treats anything unrecognised as production", () => {
    expect(isProduction({ SENTRY_ENVIRONMENT: "production" })).toBe(true);
    expect(isProduction({ SENTRY_ENVIRONMENT: "staging" })).toBe(true);
    expect(isProduction({ SENTRY_ENVIRONMENT: "developmentish" })).toBe(true);
  });
});

describe("configProblems", () => {
  it("reports nothing for a well-formed production config", () => {
    expect(configProblems(SAFE_PROD)).toEqual([]);
  });

  it("ignores everything outside production", () => {
    // Local dev sets every bypass and has no secrets — that must stay fine.
    const dev = {
      SENTRY_ENVIRONMENT: "development",
      TURNSTILE_DISABLED: "1",
      RATE_LIMIT_DISABLED: "1",
      EMAIL_DISABLED: "1",
      EMAIL_DEBUG: "1",
      ALLOW_PUBLIC_SIGNUP: "1",
    };
    expect(configProblems(dev)).toEqual([]);
  });

  it("flags each bypass flag left on in production", () => {
    for (const flag of [
      "TURNSTILE_DISABLED",
      "RATE_LIMIT_DISABLED",
      "EMAIL_DISABLED",
      "EMAIL_DEBUG",
      "ALLOW_PUBLIC_SIGNUP",
    ]) {
      const problems = configProblems({ ...SAFE_PROD, [flag]: "1" });
      expect(problems, `${flag} should be reported`).toHaveLength(1);
      expect(problems[0]).toContain(flag);
    }
  });

  it("does not flag a bypass flag that is present but off", () => {
    expect(configProblems({ ...SAFE_PROD, TURNSTILE_DISABLED: "0" })).toEqual([]);
  });

  it("flags each missing or blank required secret", () => {
    for (const key of ["BETTER_AUTH_SECRET", "TURNSTILE_SECRET_KEY", "RESEND_API_KEY"]) {
      const missing = { ...SAFE_PROD, [key]: undefined };
      expect(configProblems(missing)[0], `${key} missing`).toContain(key);
      const blank = { ...SAFE_PROD, [key]: "   " };
      expect(configProblems(blank)[0], `${key} blank`).toContain(key);
    }
  });

  it("catches the exact scenario that made Turnstile fail open", () => {
    // A deploy that simply forgot TURNSTILE_SECRET_KEY: verifyTurnstile()
    // returns true and the login page still renders a widget with the
    // always-passes test key, so nothing looks wrong from the outside.
    const { TURNSTILE_SECRET_KEY: _omitted, ...withoutTurnstile } = SAFE_PROD;
    const problems = configProblems(withoutTurnstile);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("TURNSTILE_SECRET_KEY");
  });

  it("reports every problem at once rather than stopping at the first", () => {
    expect(configProblems({ TURNSTILE_DISABLED: "1", RATE_LIMIT_DISABLED: "1" })).toHaveLength(5);
  });
});

describe("assertSafeConfig", () => {
  it("returns quietly for a safe production config", () => {
    expect(() => assertSafeConfig(SAFE_PROD)).not.toThrow();
  });

  it("returns quietly in development regardless of flags", () => {
    expect(() => assertSafeConfig({ SENTRY_ENVIRONMENT: "development" })).not.toThrow();
  });

  it("throws, naming the offending keys", () => {
    expect(() => assertSafeConfig({ ...SAFE_PROD, RATE_LIMIT_DISABLED: "1" })).toThrow(
      /RATE_LIMIT_DISABLED/,
    );
  });
});
