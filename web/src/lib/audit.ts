// Append-only audit trail for user + article actions.
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

type DB = DrizzleD1Database<typeof schema>;

export async function logAudit(
  db: DB,
  entry: {
    actorId?: string | null;
    action: string;
    targetUserId?: string | null;
    targetArticleId?: number | null;
    details?: unknown;
  },
): Promise<void> {
  await db.insert(schema.audits).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetUserId: entry.targetUserId ?? null,
    targetArticleId: entry.targetArticleId ?? null,
    details: (entry.details ?? null) as never,
  });
}
