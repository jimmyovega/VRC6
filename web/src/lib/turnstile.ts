// Cloudflare Turnstile server-side verification for the public auth forms.
// Mirrors the EMAIL_DEBUG dev fallback: when no secret is configured or
// TURNSTILE_DISABLED is set, verification is bypassed so local dev / E2E / CI
// don't need a live challenge. Production sets the real secret (and no bypass).
import { env } from "cloudflare:workers";
import { flagEnabled } from "./config-guard";
import { log } from "./log";

const tsEnv = env as typeof env & {
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_DISABLED?: string;
};

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare's "always passes" test site key — the default for dev/CI.
export const TEST_SITE_KEY = "1x00000000000000000000AA";

let bypassWarned = false;
function warnBypassOnce(reason: string): void {
  if (bypassWarned) return;
  bypassWarned = true;
  log.warn("turnstile verification bypassed for this isolate", { reason });
}

export function getTurnstileSiteKey(): string {
  return tsEnv.TURNSTILE_SITE_KEY ?? TEST_SITE_KEY;
}

// Pure call to Cloudflare's siteverify endpoint. Returns whether the token is
// valid. Network / parse failures are treated as a failed verification.
export async function verifyTurnstileToken(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

// Verifies a token using the configured secret, honouring the dev bypass.
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<boolean> {
  const secret = tsEnv.TURNSTILE_SECRET_KEY;
  if (flagEnabled(tsEnv.TURNSTILE_DISABLED) || !secret) {
    // Reachable only in dev/CI: config-guard.ts refuses to boot in production
    // with TURNSTILE_DISABLED set or TURNSTILE_SECRET_KEY missing, because this
    // branch returns true — i.e. it fails OPEN — and the login form would still
    // render a widget using the always-passes test site key.
    //
    // Warned once per isolate, not per request: the bypass is a static property
    // of the configuration, so a per-request warning is pure noise. It also
    // destabilises `wrangler dev` — a console warning on every auth request
    // floods the inspector proxy until it drops the connection and takes the
    // dev server down mid-test-run.
    warnBypassOnce(secret ? "TURNSTILE_DISABLED" : "no TURNSTILE_SECRET_KEY");
    return true;
  }
  if (!token) return false;
  return verifyTurnstileToken(secret, token, remoteIp);
}
