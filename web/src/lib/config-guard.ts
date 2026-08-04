// Fail-closed configuration guard.
//
// Three security controls — Turnstile, the auth rate limiter, and outbound
// email — each carry a dev/CI bypass. Every one of them previously failed
// *open*: `verifyTurnstile` returns true when TURNSTILE_SECRET_KEY is merely
// absent, and the login form still renders a widget using Cloudflare's
// always-passes test site key, so a deployment with a typo'd or dropped secret
// looks fully protected while verifying nothing.
//
// The only thing standing between that and production was a comment in
// .dev.vars.example. This module makes it structural: in production, a bypass
// flag or a missing secret is a hard boot failure rather than a silent
// downgrade. Loud and broken beats quiet and unprotected.

// Bypass flags that must never be set in production.
const BYPASS_FLAGS = [
  "TURNSTILE_DISABLED",
  "RATE_LIMIT_DISABLED",
  "EMAIL_DISABLED",
  "EMAIL_DEBUG",
  "ALLOW_PUBLIC_SIGNUP",
] as const;

// Secrets without which a security control silently degrades.
const REQUIRED_SECRETS = [
  "BETTER_AUTH_SECRET",
  "TURNSTILE_SECRET_KEY",
  "RESEND_API_KEY",
] as const;

type ConfigEnv = Record<string, unknown>;

/**
 * Whether a dev/CI bypass flag counts as ON.
 *
 * Exact match on "1", never truthiness: `!!"0"` and `!!"false"` are both true
 * in JS, so a truthy check would enable a bypass for config that plainly reads
 * as off. Every flag in this codebase uses this predicate.
 */
export function flagEnabled(value: unknown): boolean {
  return value === "1";
}

/**
 * Production is the default posture: anything that isn't explicitly a known
 * non-production environment is treated as production. An unset
 * SENTRY_ENVIRONMENT must not be a way to opt out of these checks.
 */
export function isProduction(cfg: ConfigEnv): boolean {
  const raw = cfg.SENTRY_ENVIRONMENT;
  if (typeof raw !== "string" || raw.trim() === "") return true;
  const envName = raw.trim().toLowerCase();
  return !["development", "dev", "test", "ci", "local", "preview"].includes(envName);
}

/**
 * Returns the reasons this configuration is unsafe to serve production traffic.
 * Empty array = safe. Pure, so it can be exhaustively unit-tested.
 */
export function configProblems(cfg: ConfigEnv): string[] {
  if (!isProduction(cfg)) return [];

  const problems: string[] = [];

  for (const flag of BYPASS_FLAGS) {
    if (flagEnabled(cfg[flag])) {
      problems.push(`${flag} is set — that bypass is for local dev and CI only.`);
    }
  }

  for (const key of REQUIRED_SECRETS) {
    const value = cfg[key];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`${key} is missing — the control it guards would silently fail open.`);
    }
  }

  return problems;
}

/**
 * Throws when the running configuration would leave a security control
 * disabled in production. Called once per isolate from the Worker entry, so a
 * misconfigured deploy fails immediately and visibly instead of serving traffic
 * with Turnstile or the rate limiter quietly switched off.
 */
export function assertSafeConfig(cfg: ConfigEnv): void {
  const problems = configProblems(cfg);
  if (problems.length === 0) return;
  throw new Error(
    `Refusing to start: unsafe production configuration.\n` +
      problems.map((p) => `  - ${p}`).join("\n") +
      `\nSet SENTRY_ENVIRONMENT=development for local dev, or fix the above.`,
  );
}
