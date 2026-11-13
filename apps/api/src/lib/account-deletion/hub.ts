import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import { accountDeletions } from '../../db/schema.js';
import { env } from '../../env.js';

// DEL-1 — the hub half of a complete deletion: the hub (« wedooh », toodooh-dashboard) holds a
// PLACE per venue the platform pushed (keyed by the screenhost id) and a USER per agent (keyed by
// the toodooh user id). POST <WEDOOH_INGEST_URL>/api/sync/delete removes them there, with
// everything that hangs off them. Same auth as the location/agent pushes (x-api-key). The
// hand-off is durable: account_deletions.hub_status stays 'pending' until the hub answers 2xx, and
// a sweep retries (boot + every 10 min) — a hub that is down never blocks the deletion here.

const HUB_TIMEOUT_MS = 15_000;

export interface HubConfig {
  ingestUrl: string;
  syncKey: string;
}

const hubConfig = (override?: Partial<HubConfig>): HubConfig | null => {
  const ingestUrl = override?.ingestUrl ?? env.WEDOOH_INGEST_URL;
  const syncKey = override?.syncKey ?? env.TOODOOH_SYNC_KEY;
  return ingestUrl && syncKey ? { ingestUrl, syncKey } : null;
};

/** Sends every pending hub deletion once. Returns how many the hub confirmed. */
export const runHubDeletionSweep = async (
  log?: FastifyBaseLogger,
  override?: Partial<HubConfig>,
  fetchImpl: typeof fetch = fetch,
): Promise<number> => {
  const cfg = hubConfig(override);
  if (!cfg) return 0;
  const pending = await db
    .select({
      id: accountDeletions.id,
      deletedUserId: accountDeletions.deletedUserId,
      hubLocationIds: accountDeletions.hubLocationIds,
      hubAgent: accountDeletions.hubAgent,
    })
    .from(accountDeletions)
    .where(eq(accountDeletions.hubStatus, 'pending'))
    .orderBy(asc(accountDeletions.createdAt))
    .limit(50);
  let done = 0;
  for (const row of pending) {
    let error: string | null = null;
    try {
      const res = await fetchImpl(`${cfg.ingestUrl}/api/sync/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.syncKey },
        body: JSON.stringify({
          location_ids: row.hubLocationIds,
          toodooh_user_id: row.hubAgent ? row.deletedUserId : null,
        }),
        signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
      });
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : 'hub unreachable';
    }
    if (error === null) {
      await db
        .update(accountDeletions)
        .set({ hubStatus: 'done', hubDoneAt: new Date(), hubError: null })
        .where(and(eq(accountDeletions.id, row.id), eq(accountDeletions.hubStatus, 'pending')));
      done += 1;
    } else {
      log?.warn({ deletionId: row.id, error }, 'hub deletion not confirmed — will retry');
      await db
        .update(accountDeletions)
        .set({
          hubAttempts: sql`${accountDeletions.hubAttempts} + 1`,
          hubError: error.slice(0, 500),
        })
        .where(eq(accountDeletions.id, row.id));
    }
  }
  return done;
};

/** Fire-and-forget: send the pending hub deletions now (right after a deletion). */
export function kickHubDeletions(log?: FastifyBaseLogger): void {
  void runHubDeletionSweep(log).catch((err: unknown) =>
    log?.warn({ err }, 'hub deletion sweep failed'),
  );
}

/** Boot + 10 min unref'd sweep (the wedooh B2 sweep's cadence). */
export function startHubDeletionJob(log: FastifyBaseLogger): void {
  kickHubDeletions(log);
  const timer = setInterval(() => kickHubDeletions(log), 10 * 60_000);
  timer.unref();
}
