import { formatInTimeZone } from 'date-fns-tz';
import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  proofOfPlay,
  screenhosts,
} from '../../db/schema.js';
import { proofInstantSql } from '../playout/proof-instant.js';

import { slotKey } from './valuation.js';

// E6 — the ONE delivered-per-créneau bucketing, extracted from reconcile-service so the
// redispatch detector and the reconciliation read delivery IDENTICALLY (FIX A semantics: a
// créneau is DELIVERED iff ≥1 VIDEO_ENDED proof's PLAY instant (PROOF-R1, lib/playout/proof-instant.ts)
// falls in that (date, hour)
// in Africa/Tunis — binary per slot, spam-resistant; NOT a raw count, NOT the client event_ts).

/** Créneau date+hour are Africa/Tunis (the playout window pins to Tunis). */
export const PLAYOUT_TZ = 'Africa/Tunis';

/** Order of a créneau against a Tunis (date, hour): < 0 before, 0 the same hour, > 0 after. */
export const compareSlot = (
  date: string,
  hour: number,
  ref: { date: string; hour: number },
): number => (date === ref.date ? hour - ref.hour : date < ref.date ? -1 : 1);

/** Bucket a proof's PLAY instant (PROOF-R1: coalesce(played_at, received_at)) into its créneau slot key. */
export const proofSlotKey = (playedAt: Date): string =>
  slotKey(
    formatInTimeZone(playedAt, PLAYOUT_TZ, 'yyyy-MM-dd'),
    Number(formatInTimeZone(playedAt, PLAYOUT_TZ, 'H')),
  );

/**
 * The campaign's delivered slots per screenhost: Map<screenhostId, Set<slotKey>>. `stoppedAt`
 * (STOP-1, a superadmin stop): a demo venue's planned créneaux count as delivered only up to the
 * hour the campaign was stopped in — the later ones never aired.
 */
export const loadDeliveredSlots = async (
  campaignId: string,
  opts: { stoppedAt?: Date } = {},
): Promise<Map<string, Set<string>>> => {
  const proofRows = await db
    .select({ screenhostId: proofOfPlay.screenhostId, playedAt: proofInstantSql })
    .from(proofOfPlay)
    .where(and(eq(proofOfPlay.campaignId, campaignId), eq(proofOfPlay.eventType, 'VIDEO_ENDED')));
  const deliveredBySh = new Map<string, Set<string>>();
  for (const row of proofRows) {
    let set = deliveredBySh.get(row.screenhostId);
    if (!set) {
      set = new Set<string>();
      deliveredBySh.set(row.screenhostId, set);
    }
    set.add(proofSlotKey(row.playedAt));
  }
  const stopKey =
    opts.stoppedAt === undefined
      ? null
      : {
          date: formatInTimeZone(opts.stoppedAt, PLAYOUT_TZ, 'yyyy-MM-dd'),
          hour: Number(formatInTimeZone(opts.stoppedAt, PLAYOUT_TZ, 'H')),
        };
  // DEMO-2 (ruled Q2 A) — a demo screenhost has no screen and never sends a proof: its planned
  // créneaux count as delivered, so settlement, the redispatch detector and the displayed
  // impressions treat it as having aired (only demo campaigns are ever placed on one).
  const demoRows = await db
    .select({
      screenhostId: campaignDispatchAllocation.screenhostId,
      creneaux: campaignDispatchAllocation.creneaux,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(screenhosts, eq(screenhosts.id, campaignDispatchAllocation.screenhostId))
    .where(and(eq(campaignDispatchPlan.campaignId, campaignId), eq(screenhosts.demoOnly, true)));
  for (const row of demoRows) {
    let set = deliveredBySh.get(row.screenhostId);
    if (!set) {
      set = new Set<string>();
      deliveredBySh.set(row.screenhostId, set);
    }
    for (const c of row.creneaux) {
      if (stopKey !== null && compareSlot(c.date, c.hour, stopKey) > 0) continue;
      set.add(slotKey(c.date, c.hour));
    }
  }
  return deliveredBySh;
};
