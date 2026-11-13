import { and, eq, isNull, lte, or } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  screenhosts,
} from '../../db/schema.js';
import { ownerNotDeactivatedSql } from '../approved-owner.js';
import { type BlackoutWindow } from '../event-blackout.js';
import { airedCreativeTypeSql, airedStorageKeySql, ctaAirableSql } from '../spot-cta.js';

import { campaignWindowValidUntil, isWindowActive } from './playlist.js';
import { toursAirtime } from './tours-airtime.js';

export interface ActiveAllocation {
  campaignId: string;
  campaignName: string;
  creativeId: string;
  storageKey: string;
  durationSeconds: number | null;
  repsPerHour: number; // R_i — planned reps/hour at this screenhost (cadence hint for the player)
  /** EV4 rider — 'video' | 'photo' from the creatives join (the player renders images too). */
  creativeType: string;
  /** FRESH-1 — the Tunis midnight after the campaign's end date (the window's close). */
  validUntil: Date;
  /**
   * DISP-TOURS — a tours allocation airs only inside its créneaux: false outside them (the
   * playlist still carries the entry, blacked out until its next hour; nothing else may air or
   * record it). Always true on a v1 allocation (one r_i, every hour of the window).
   */
  airableNow: boolean;
  /** DISP-TOURS — the next 48 h outside the allocation's créneaux (absent on a v1 allocation). */
  offWindows?: BlackoutWindow[];
}

// THE single authorization gate for what a screen may air AND what it may bill proof-of-play for.
// A campaign is airable on a screenhost iff ALL hold:
//   • it has an ACCEPTE dispatch allocation to that screenhost,
//   • the campaign is status = 'active' (defense-in-depth: a draft/pending/rejected campaign with a
//     frozen plan + approved creative + active window must NOT air — the activation lane flips it),
//   • its linked creative is validation_status = 'approved' (content gate),
//   • the campaign window covers `now` (Africa/Tunis),
//   • DEMO-1 — a demo campaign's airs_at has passed (NULL on every other campaign),
//   • QR-CTA1 — a campaign with a call to action has its QR copy ready (and then airs THAT copy).
// computeScreenPlaylist (what to send) and the proof-of-play ingest (what to record) BOTH call this,
// so a screen only ever records proof for content the server authorized it to air. Pass campaignId
// to resolve a single campaign (proof ingest); omit for the full list (playlist push).
export const activeAllocationsForScreenhost = async (
  screenhostId: string,
  now: Date,
  campaignId?: string,
  /** DISP-TOURS — the playlist also wants a tours entry between its hours (blacked out). */
  opts: { includeOffHours?: boolean } = {},
): Promise<ActiveAllocation[]> => {
  const conditions = [
    eq(campaignDispatchAllocation.screenhostId, screenhostId),
    eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
    eq(campaigns.status, 'active'),
    eq(creatives.validationStatus, 'approved'),
    or(isNull(campaigns.airsAt), lte(campaigns.airsAt, now)),
    ctaAirableSql(),
    // DEACT-1 — a deactivated owner's venues stop airing at once (ruling 2026-10-28).
    ownerNotDeactivatedSql(),
  ];
  if (campaignId !== undefined) conditions.push(eq(campaigns.id, campaignId));

  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      creativeId: creatives.id,
      storageKey: airedStorageKeySql(),
      durationSeconds: creatives.durationSeconds,
      creativeType: airedCreativeTypeSql(), // QR-CTA2 — a photo's QR copy airs as a video
      repsPerHour: campaignDispatchAllocation.rI,
      engine: campaignDispatchPlan.engine,
      creneaux: campaignDispatchAllocation.creneaux,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .innerJoin(screenhosts, eq(screenhosts.id, campaignDispatchAllocation.screenhostId))
    .where(and(...conditions));

  return rows.flatMap((row): ActiveAllocation[] => {
    if (row.endDate === null || !isWindowActive(row.startDate, row.endDate, now)) return [];
    const base = {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      creativeId: row.creativeId,
      storageKey: row.storageKey,
      durationSeconds: row.durationSeconds,
      creativeType: row.creativeType,
      validUntil: campaignWindowValidUntil(row.endDate),
    };
    if (row.engine !== 'tours')
      return [{ ...base, repsPerHour: row.repsPerHour, airableNow: true }];
    const airtime = toursAirtime(row.creneaux, now);
    const airableNow = airtime.currentReps !== null;
    if (!airableNow && !opts.includeOffHours) return [];
    return [
      {
        ...base,
        repsPerHour: airtime.currentReps ?? airtime.nextReps ?? 0,
        airableNow,
        offWindows: airtime.offWindows,
      },
    ];
  });
};
