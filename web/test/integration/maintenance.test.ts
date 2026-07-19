import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb, schema } from "../../src/db";
import { getMaintenanceStatus, setMaintenanceMode } from "../../src/lib/maintenance";

describe("maintenance mode (D1)", () => {
  it("defaults to off when no row exists yet", async () => {
    const db = getDb(env.DB);
    expect(await getMaintenanceStatus(db)).toEqual({ enabled: false, message: null });
  });

  it("turns on with a message, then off again", async () => {
    const db = getDb(env.DB);
    await setMaintenanceMode(db, true, "Back in an hour");
    expect(await getMaintenanceStatus(db)).toEqual({ enabled: true, message: "Back in an hour" });

    await setMaintenanceMode(db, false, null);
    expect(await getMaintenanceStatus(db)).toEqual({ enabled: false, message: null });
  });

  it("upserts the single row rather than creating duplicates", async () => {
    const db = getDb(env.DB);
    await setMaintenanceMode(db, true, "first");
    await setMaintenanceMode(db, true, "second");
    const rows = await db.select().from(schema.siteSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].maintenanceMessage).toBe("second");
  });
});
