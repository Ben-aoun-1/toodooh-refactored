import { eq, sql } from 'drizzle-orm';

import { campaignTypicalWeek, campaignTypicalWeekFreezes } from '../db/schema.js';

import type { DbExecutor } from './dispatch/pool.js';

// TW-SNAP (operator ruling Z-A, 2026-09-25) — a campaign's typical week is FROZEN when it is
// added to the cart: every venue's screenhost_affluence cells are copied, as they stand, into
// campaign_typical_week. From then on assemblePool reads the campaign's AUDIENCE from the copy
// (lib/dispatch/pool.ts), so the hub rewriting the live grid can no longer move what the
// screencaster paid for. Rulings: Q1 B re-freeze at every new add (removal drops the freeze),
// Q2 B a venue absent from the freeze is excluded, Q4 B no backfill (no header = the live week).

/**
 * Freeze the WHOLE network's typical week for this campaign (any previous freeze is replaced).
 * Whole network, not the targeted venues: the pool considers every active venue, and the
 * campaign's targeting can still change before confirm.
 */
export const freezeTypicalWeek = async (
  executor: DbExecutor,
  campaignId: string,
): Promise<void> => {
  await dropTypicalWeekFreeze(executor, campaignId);
  await executor.insert(campaignTypicalWeekFreezes).values({ campaignId });
  // A byte copy of the live cells, in one statement (no read-modify-write window).
  await executor.execute(sql`
    insert into campaign_typical_week
      (campaign_id, screenhost_id, day_of_week, hour, slot, estimated_impressions, in_effect)
    select ${campaignId}::uuid, screenhost_id, day_of_week, hour, slot, estimated_impressions, in_effect
    from screenhost_affluence`);
};

/** Removing the campaign from the cart drops its freeze (the cells cascade). */
export const dropTypicalWeekFreeze = async (
  executor: DbExecutor,
  campaignId: string,
): Promise<void> => {
  await executor
    .delete(campaignTypicalWeekFreezes)
    .where(eq(campaignTypicalWeekFreezes.campaignId, campaignId));
};

/** Does this campaign price and place on a frozen week? (No header = the live week.) */
export const hasTypicalWeekFreeze = async (
  executor: DbExecutor,
  campaignId: string,
): Promise<boolean> => {
  const [row] = await executor
    .select({ campaignId: campaignTypicalWeekFreezes.campaignId })
    .from(campaignTypicalWeekFreezes)
    .where(eq(campaignTypicalWeekFreezes.campaignId, campaignId))
    .limit(1);
  return row !== undefined;
};

/** The venues present in the freeze (Q2 B: a venue that joined after it is not a candidate). */
export const frozenVenueIds = async (
  executor: DbExecutor,
  campaignId: string,
): Promise<Set<string>> => {
  const rows = await executor
    .selectDistinct({ screenhostId: campaignTypicalWeek.screenhostId })
    .from(campaignTypicalWeek)
    .where(eq(campaignTypicalWeek.campaignId, campaignId));
  return new Set(rows.map((r) => r.screenhostId));
};
