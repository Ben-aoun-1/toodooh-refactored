import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
} from '../../db/schema.js';

import { isWindowActive } from './playlist.js';

export interface ActiveAllocation {
  campaignId: string;
  campaignName: string;
  creativeId: string;
  storageKey: string;
  durationSeconds: number | null;
  repsPerHour: number; // R_i — planned reps/hour at this screenhost (cadence hint for the player)
}

// THE single authorization gate for what a screen may air AND what it may bill proof-of-play for.
// A campaign is airable on a screenhost iff ALL hold:
//   • it has an ACCEPTE dispatch allocation to that screenhost,
//   • the campaign is status = 'active' (defense-in-depth: a draft/pending/rejected campaign with a
//     frozen plan + approved creative + active window must NOT air — the activation lane flips it),
//   • its linked creative is validation_status = 'approved' (content gate),
//   • the campaign window covers `now` (Africa/Tunis).
// computeScreenPlaylist (what to send) and the proof-of-play ingest (what to record) BOTH call this,
// so a screen only ever records proof for content the server authorized it to air. Pass campaignId
// to resolve a single campaign (proof ingest); omit for the full list (playlist push).
export const activeAllocationsForScreenhost = async (
  screenhostId: string,
  now: Date,
  campaignId?: string,
): Promise<ActiveAllocation[]> => {
  const conditions = [
    eq(campaignDispatchAllocation.screenhostId, screenhostId),
    eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
    eq(campaigns.status, 'active'),
    eq(creatives.validationStatus, 'approved'),
  ];
  if (campaignId !== undefined) conditions.push(eq(campaigns.id, campaignId));

  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      creativeId: creatives.id,
      storageKey: creatives.storageKey,
      durationSeconds: creatives.durationSeconds,
      repsPerHour: campaignDispatchAllocation.rI,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(and(...conditions));

  return rows
    .filter((row) => isWindowActive(row.startDate, row.endDate, now))
    .map((row) => ({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      creativeId: row.creativeId,
      storageKey: row.storageKey,
      durationSeconds: row.durationSeconds,
      repsPerHour: row.repsPerHour,
    }));
};
