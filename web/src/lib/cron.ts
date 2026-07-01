// Scheduled maintenance jobs. Run by a Cloudflare Cron Trigger in production
// (via the `scheduled` handler in src/worker.ts); the expiry sweep is also
// callable on demand from the admin panel. Cron Triggers do not fire in
// `wrangler dev` / CI, so the logic lives here as a plain, testable function.
import { env } from "cloudflare:workers";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db";
import { user } from "../db/schema";
import { logAudit } from "./audit";

const DAY_MS = 24 * 60 * 60 * 1000;

const cronEnv = env as typeof env & { ACTIVATION_TTL_DAYS?: string };

type DB = ReturnType<typeof getDb>;

// Pending invitations never activated within the TTL window are marked
// `expired` (which also kills the dead activation link, since only `active`
// accounts may log in). Returns how many users were expired.
export async function expirePendingActivations(
  db: DB,
  now: Date = new Date(),
  ttlDays: number = Number(cronEnv.ACTIVATION_TTL_DAYS ?? "7"),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ttlDays * DAY_MS);
  const predicate = and(
    eq(user.status, "pending_activation"),
    lt(user.createdAt, cutoff),
  );

  const stale = await db.select({ id: user.id }).from(user).where(predicate);
  if (stale.length === 0) return 0;

  await db.update(user).set({ status: "expired", expiredAt: now }).where(predicate);

  for (const u of stale) {
    await logAudit(db, {
      actorId: null,
      action: "user.activation_expired",
      targetUserId: u.id,
    });
  }
  return stale.length;
}

// Entry point invoked by the Cron Trigger.
export async function runScheduledJobs(): Promise<{ expired: number }> {
  const db = getDb(env.DB);
  const expired = await expirePendingActivations(db);
  return { expired };
}
