import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../../src/db";
import { consumeRateLimit } from "../../src/lib/rate-limit";

// Integration tests run against a real (isolated) D1 instance with migrations applied.
describe("auth rate limiter (D1)", () => {
  it("allows up to max requests then blocks within the window", async () => {
    const db = getDb(env.DB);
    const key = "1.2.3.4:/sign-in/email";
    const now = new Date("2026-06-30T12:00:00Z");

    for (let i = 0; i < 3; i++) {
      expect((await consumeRateLimit(db, key, 3, 60_000, now)).allowed).toBe(true);
    }
    const blocked = await consumeRateLimit(db, key, 3, 60_000, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("starts a fresh window once the old one expires", async () => {
    const db = getDb(env.DB);
    const key = "5.6.7.8:/sign-in/email";
    const t0 = new Date("2026-06-30T12:00:00Z");

    expect((await consumeRateLimit(db, key, 1, 60_000, t0)).allowed).toBe(true);
    expect((await consumeRateLimit(db, key, 1, 60_000, t0)).allowed).toBe(false);

    // 61s later the window has reset.
    const t1 = new Date(t0.getTime() + 61_000);
    expect((await consumeRateLimit(db, key, 1, 60_000, t1)).allowed).toBe(true);
  });

  it("tracks different keys independently", async () => {
    const db = getDb(env.DB);
    const now = new Date("2026-06-30T12:00:00Z");
    expect((await consumeRateLimit(db, "a:/sign-up/email", 1, 60_000, now)).allowed).toBe(true);
    // Different key is unaffected by the first key's exhausted window.
    expect((await consumeRateLimit(db, "b:/sign-up/email", 1, 60_000, now)).allowed).toBe(true);
  });
});
