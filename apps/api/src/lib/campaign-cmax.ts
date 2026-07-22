import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { campaignDispatchAllocation, campaignDispatchPlan } from '../db/schema.js';

import { cpmForCampaign, getDispatchConfig } from './dispatch/config.js';
import { assemblePool } from './dispatch/pool.js';
import { tForDuration } from './dispatch/thresholds.js';

// E5 (VF US-1.3/1.4) — the C_max ceiling the budget cursor is bounded by:
//
//   I_max = Σ Ii over the campaign's ELIGIBLE pool     (targeting ∩ zones ∩ active ∩ hours ∩
//                                                       capacity, engagement-netted, T-weighted)
//   C_max = ⌊ (CPM × I_max) ÷ 1000 ⌋                    (FLOOR to whole TND — the promise must
//                                                       be deliverable)
//
// The cursor MUST read the same occupancy truth as dispatch: assemblePool (E3) is that truth —
// each pool entry's residualCapacity is the venue's FACTURABLE capacity for the window (T-weighted
// since E1, netted of other campaigns' engaged broadcast seconds), so I_max is their plain sum.
// CONSUMED, never modified; the read-only path takes no occupancy locks (dispatch's freeze does).
//
// Post-submit shrinkage is dispatch's problem BY DESIGN: occupancy taken between submit and
// activation surfaces there as TOO_THIN (clôture, renvoi curseur) or a genuine PARTIAL — the
// submit-time gate only refuses promises that are already impossible at click time.

export interface CampaignCmax {
  /** ⌊CPM × I_max ÷ 1000⌋ — whole TND. */
  cMaxTnd: number;
  iMaxFacturable: number;
  eligibleCount: number;
  /** The CPM the ceiling priced at (event vs standard) — handy for callers/tests. */
  cpmTnd: number;
}

export const computeCampaignCmax = async (
  campaign: { id: string; startDate: string; endDate: string; campaignType: string },
  spotSeconds: number,
): Promise<CampaignCmax> => {
  const config = await getDispatchConfig();
  const t = tForDuration(spotSeconds, config);
  const cpm = cpmForCampaign(campaign.campaignType, config);
  // E5.1 (VF US-2.1) — zero targeting lines = the whole network: the pool assembles over every
  // eligible venue and the ceiling prices the full inventory (the old NO_TARGETING zero-fold
  // retired with the status).
  //
  // CF-SK1 amendment — the campaign's OWN frozen allocations are EXCLUDED from the engagement
  // netting (the E6 seam): its own seconds are its delivery, not competition. Without this, a
  // draft carrying a frozen plan (a cart skip item whose confirm later failed on another item)
  // re-prices against itself on retry — the ceiling collapses below its own budget and the cart
  // wedges on BUDGET_EXCEEDS_CMAX forever. Plan-less campaigns are untouched (empty exclusion).
  const [ownPlan] = await db
    .select({ id: campaignDispatchPlan.id })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaign.id))
    .limit(1);
  const ownAllocationIds = ownPlan
    ? (
        await db
          .select({ id: campaignDispatchAllocation.id })
          .from(campaignDispatchAllocation)
          .where(eq(campaignDispatchAllocation.planId, ownPlan.id))
      ).map((a) => a.id)
    : [];
  const { pool } = await assemblePool(
    db,
    { id: campaign.id, startDate: campaign.startDate, endDate: campaign.endDate },
    { s: spotSeconds, t, fMaxSeconds: config.fMaxSeconds },
    { excludeAllocationIds: ownAllocationIds },
  );
  const iMax = pool.reduce((sum, entry) => sum + entry.residualCapacity, 0);
  return {
    cMaxTnd: Math.floor((cpm * iMax) / 1000),
    iMaxFacturable: iMax,
    eligibleCount: pool.length,
    cpmTnd: cpm,
  };
};
