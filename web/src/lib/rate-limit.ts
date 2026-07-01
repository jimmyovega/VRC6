// Fixed-window rate limiting for the auth endpoints, backed by D1 so the
// counter is shared across Worker isolates. Honours a RATE_LIMIT_DISABLED
// bypass for local dev / E2E / CI (same pattern as the Turnstile bypass).
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { authRateLimit } from "../db/schema";

const rlEnv = env as typeof env & { RATE_LIMIT_DISABLED?: string };

type DB = ReturnType<typeof getDb>;

export type RateLimitResult = { allowed: boolean; retryAfter: number };

export function rateLimitDisabled(): boolean {
  return !!rlEnv.RATE_LIMIT_DISABLED;
}

// Per-path limits (relative paths under /api/auth). Tunable; deliberately
// generous so a real user retyping a password isn't punished, but tight enough
// to blunt credential-stuffing / enumeration / mass sign-up.
export const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/sign-in/email": { max: 8, windowMs: 60_000 },
  "/sign-up/email": { max: 5, windowMs: 60_000 },
  "/request-password-reset": { max: 4, windowMs: 60_000 },
  "/two-factor/verify-totp": { max: 8, windowMs: 60_000 },
};

// Increments the counter for `key`. Returns allowed=false once more than `max`
// requests land inside a `windowMs` window, until the window resets.
export async function consumeRateLimit(
  db: DB,
  key: string,
  max: number,
  windowMs: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const nowMs = now.getTime();
  const [existing] = await db
    .select()
    .from(authRateLimit)
    .where(eq(authRateLimit.key, key))
    .limit(1);

  // No window yet, or the previous one has expired → start fresh.
  if (!existing || existing.resetAt.getTime() <= nowMs) {
    const resetAt = new Date(nowMs + windowMs);
    if (existing) {
      await db.update(authRateLimit).set({ count: 1, resetAt }).where(eq(authRateLimit.key, key));
    } else {
      await db.insert(authRateLimit).values({ key, count: 1, resetAt });
    }
    return { allowed: true, retryAfter: 0 };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      retryAfter: Math.ceil((existing.resetAt.getTime() - nowMs) / 1000),
    };
  }

  await db
    .update(authRateLimit)
    .set({ count: existing.count + 1 })
    .where(eq(authRateLimit.key, key));
  return { allowed: true, retryAfter: 0 };
}
