// Site-wide maintenance-mode toggle, backed by the single-row site_settings
// table. A missing row means maintenance is off (the default, safe state).
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as Sentry from "@sentry/cloudflare";
import * as schema from "../db/schema";
import { log } from "./log";

type DB = DrizzleD1Database<typeof schema>;

const ROW_ID = 1;

export interface MaintenanceStatus {
  enabled: boolean;
  message: string | null;
}

export async function getMaintenanceStatus(db: DB): Promise<MaintenanceStatus> {
  try {
    const [row] = await db
      .select({
        maintenanceMode: schema.siteSettings.maintenanceMode,
        maintenanceMessage: schema.siteSettings.maintenanceMessage,
      })
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.id, ROW_ID))
      .limit(1);
    return { enabled: row?.maintenanceMode ?? false, message: row?.maintenanceMessage ?? null };
  } catch (err) {
    // This gate runs in middleware on every anonymous request to every path,
    // including ones that don't exist (bots probing for e.g. /xmlrpc.php).
    // D1 has occasional transient internal errors that are Cloudflare's own
    // infra, not this app's — letting one propagate here would 500 the
    // entire public site over a momentary blip on an unrelated request. Same
    // fail-open philosophy as "missing row means off" above, just extended
    // to cover "couldn't even ask." Still reported so a D1 that's actually
    // degraded (not just a one-off blip) doesn't go unnoticed.
    Sentry.captureException(err, { tags: { source: "getMaintenanceStatus" } });
    log.error("maintenance status query failed — failing open (maintenance off)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { enabled: false, message: null };
  }
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
