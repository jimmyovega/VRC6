// Cloudflare Turnstile server-side verification for the public auth forms.
// Mirrors the EMAIL_DEBUG dev fallback: when no secret is configured or
// TURNSTILE_DISABLED is set, verification is bypassed so local dev / E2E / CI
// don't need a live challenge. Production sets the real secret (and no bypass).
import { env } from "cloudflare:workers";

const tsEnv = env as typeof env & {
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_DISABLED?: string;
};

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare's "always passes" test site key — the default for dev/CI.
export const TEST_SITE_KEY = "1x00000000000000000000AA";

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
  if (tsEnv.TURNSTILE_DISABLED || !secret) {
    console.log("[turnstile] verification bypassed (dev/disabled)");
    return true;
  }
  if (!token) return false;
  return verifyTurnstileToken(secret, token, remoteIp);
}
