import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, schema } from "../../src/db";
import { expirePendingActivations } from "../../src/lib/cron";

const DAY = 24 * 60 * 60 * 1000;

type DB = ReturnType<typeof getDb>;

async function makeUser(db: DB, id: string, status: string, createdAt: Date) {
  await db.insert(schema.user).values({
    id,
    name: id,
    email: `${id}@vrc6.com`,
    emailVerified: false,
    createdAt,
    updatedAt: createdAt,
    role: "editor",
    status: status as "pending_activation" | "active",
  });
}

// Integration tests run against a real (isolated) D1 instance with migrations applied.
describe("activation expiry sweep (D1)", () => {
  it("expires only stale pending_activation users and audits each one", async () => {
    const db = getDb(env.DB);
    const now = new Date();
    await makeUser(db, "stale-pending", "pending_activation", new Date(now.getTime() - 10 * DAY));
    await makeUser(db, "fresh-pending", "pending_activation", new Date(now.getTime() - 1 * DAY));
    await makeUser(db, "active-old", "active", new Date(now.getTime() - 30 * DAY));

    const count = await expirePendingActivations(db, now, 7);
    expect(count).toBe(1);

    const rows = await db.select().from(schema.user);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["stale-pending"].status).toBe("expired");
    expect(byId["stale-pending"].expiredAt).toBeTruthy();
    expect(byId["fresh-pending"].status).toBe("pending_activation");
    expect(byId["active-old"].status).toBe("active");

    const audited = await db
      .select()
      .from(schema.audits)
      .where(eq(schema.audits.action, "user.activation_expired"));
    expect(audited).toHaveLength(1);
    expect(audited[0].targetUserId).toBe("stale-pending");
    expect(audited[0].actorId).toBeNull();
  });

  it("returns 0 and writes no audit when nothing is stale", async () => {
    const db = getDb(env.DB);
    const now = new Date();
    await makeUser(db, "fresh-only", "pending_activation", new Date(now.getTime() - DAY));

    expect(await expirePendingActivations(db, now, 7)).toBe(0);
    const audited = await db.select().from(schema.audits);
    expect(audited).toHaveLength(0);
  });
});
