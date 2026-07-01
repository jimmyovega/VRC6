import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAuth } from "../../src/lib/auth";
import { getDb, schema } from "../../src/db";

// Guards the invite/activation flow: an expired reset token (what bit chief@ —
// clicked hours after a 1h-default link) must be rejected, a live one accepted.
// We force expiry by writing the token row directly, so no waiting is needed.
describe("password reset / activation token expiry (D1)", () => {
  it("rejects an expired token but accepts a live one", async () => {
    const auth = getAuth();
    const db = getDb(env.DB);
    const email = "reset-expiry@vrc6.com";

    await auth.api.signUpEmail({
      body: { email, password: "Sup3rSecret!23", name: "Reset Expiry" },
    });
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email));

    // better-auth stores reset tokens as `reset-password:<token>` → userId.
    const insertToken = (token: string, expiresAt: Date) =>
      db.insert(schema.verification).values({
        id: crypto.randomUUID(),
        identifier: `reset-password:${token}`,
        value: u.id,
        expiresAt,
      });

    // Expired token → rejected.
    await insertToken("expired-token", new Date(Date.now() - 60_000));
    await expect(
      auth.api.resetPassword({ body: { token: "expired-token", newPassword: "N3wValidPass!1" } }),
    ).rejects.toThrow();

    // Live token → accepted.
    await insertToken("live-token", new Date(Date.now() + 60_000));
    const res = await auth.api.resetPassword({
      body: { token: "live-token", newPassword: "N3wValidPass!1" },
    });
    expect(res).toBeTruthy();
  });
});
