// Site-wide maintenance-mode toggle, backed by the single-row site_settings
// table. A missing row means maintenance is off (the default, safe state).
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

type DB = DrizzleD1Database<typeof schema>;

const ROW_ID = 1;

export interface MaintenanceStatus {
  enabled: boolean;
  message: string | null;
}

export async function getMaintenanceStatus(db: DB): Promise<MaintenanceStatus> {
  const [row] = await db
    .select({
      maintenanceMode: schema.siteSettings.maintenanceMode,
      maintenanceMessage: schema.siteSettings.maintenanceMessage,
    })
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.id, ROW_ID))
    .limit(1);
  return { enabled: row?.maintenanceMode ?? false, message: row?.maintenanceMessage ?? null };
}

export async function setMaintenanceMode(
  db: DB,
  enabled: boolean,
  message: string | null,
): Promise<void> {
  await db
    .insert(schema.siteSettings)
    .values({ id: ROW_ID, maintenanceMode: enabled, maintenanceMessage: message })
    .onConflictDoUpdate({
      target: schema.siteSettings.id,
      set: { maintenanceMode: enabled, maintenanceMessage: message, updatedAt: new Date() },
    });
}
