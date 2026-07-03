import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getAuth } from "../../src/lib/auth";
import { getDb, schema } from "../../src/db";

// Verifies the self-service activation is fully traceable: a pending user who
// sets a password via the reset/activation flow flips to active AND leaves a
// user.activated audit entry (previously activation left no audit trail).
describe("account activation via reset flow (D1)", () => {
  it("flips a pending user to active and audits the activation", async () => {
    const auth = getAuth();
    const db = getDb(env.DB);
    const email = "activate-me@vrc6.com";

    await auth.api.signUpEmail({
      body: { email, password: "Sup3rSecret!23", name: "Activate Me" },
    });
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email));

    // Put them in the invited state with a live activation token.
    await db
      .update(schema.user)
      .set({ status: "pending_activation" })
      .where(eq(schema.user.id, u.id));
    await db.insert(schema.verification).values({
      id: crypto.randomUUID(),
      identifier: "reset-password:activate-token",
      value: u.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    // Activate by setting a new password.
    await auth.api.resetPassword({
      body: { token: "activate-token", newPassword: "N3wValidPass!1" },
    });

    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
    expect(after.status).toBe("active");
    expect(after.activatedAt).toBeTruthy();

    const activated = await db
      .select()
      .from(schema.audits)
      .where(eq(schema.audits.action, "user.activated"));
    expect(activated).toHaveLength(1);
    expect(activated[0].targetUserId).toBe(u.id);
    expect(activated[0].actorId).toBe(u.id);
  });
});
