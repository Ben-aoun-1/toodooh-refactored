import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { campaignDispatchAllocation, campaignDispatchPlan } from '../db/schema.js';

import {
  campaignCpmRates,
  campaignTTiers,
  cpmForCampaign,
  getDispatchConfig,
} from './dispatch/config.js';
import { usesToursEngine } from './dispatch/engine-switch.js';
import { assemblePool } from './dispatch/pool.js';
import { tForDuration } from './dispatch/thresholds.js';
import { calculerCampagne } from './dispatch/tours/campaign-calcul.js';
import { EPS } from './dispatch/tours/remplir.js';

// E5 (VF US-1.3/1.4) — the C_max ceiling the budget cursor is bounded by:
//
//   I_max = Σ Ii over the campaign's ELIGIBLE pool     (targeting ∩ zones ∩ active ∩ approved
//                                                       owner ∩ installed screen ∩ hours,
//                                                       engagement-netted, T-weighted)
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
  /** CF-HF4 — targeting-matching venues BEFORE capacity/day exclusions (the saturated/empty split). */
  targetedCount: number;
  /** The CPM the ceiling priced at (event vs standard) — handy for callers/tests. */
  cpmTnd: number;
  /**
   * DISP-TOURS — the cart's figures at the targeted budget (asked with `budgetTnd`): the exact
   * price (at or under the budget, R9) and the qualified impressions it buys. 0 = the budget is
   * too small to give any venue 30 DT. Absent on the v1 engine.
   */
  quote?: { budgetTnd: number; prixTnd: number; impressions: number; venuesCount: number };
}

export const computeCampaignCmax = async (
  campaign: {
    id: string;
    startDate: string;
    endDate: string;
    campaignType: string;
    eventId?: string | null;
    /** CPM-1 — the campaign's own rates (captured at creation); the ceiling prices at them. */
    standardCpmTnd: string;
    eventCpmTnd: string;
    /** CPM-2 — the campaign's own T tiers (captured at creation); REQUIRED, so no caller can
     *  fall back to the live T. */
    t10s: string;
    t20s: string;
    t30s: string;
  },
  spotSeconds: number,
  /** DISP-TOURS — also price the campaign at this targeted budget (the cart's quote). */
  budgetTnd?: number,
): Promise<CampaignCmax> => {
  // EV3 — THE ENGINE BOUNDARY (pinned): the classic C_max never prices a POSITIONING (an
  // event-BOUND row — the binding, not the type string, discriminates; a legacy 'event'-typed
  // row without a binding still prices here at CPM_evt, exactly as before EV3). EV2's event
  // pricing owns the positioning ceiling; bloc dispatch is EV4. Reaching here with a bound row
  // is a routing bug — fail loudly rather than price nonsense. eventId is optional so the
  // pre-EV3 callers (tests included) stay byte-identical: absent ≡ unbound ≡ classic.
  if (campaign.eventId != null) {
    throw new Error('computeCampaignCmax received an event positioning (EV3 engine boundary)');
  }
  // CPM-1 / CPM-2 — the CPM and the attention index T are the campaign's own (CPM-3: the CPM is
  // its screencaster's, realigned while a draft not yet frozen; T is the one in effect when it was
  // created); the live config still supplies F (out of scope by ruling).
  const config = await getDispatchConfig();
  const t = tForDuration(spotSeconds, campaignTTiers(campaign));
  const cpm = cpmForCampaign(campaign.campaignType, campaignCpmRates(campaign));
  // E5.1 (VF US-2.1) — zero targeting lines = the whole network: the pool assembles over every
  // eligible venue and the ceiling prices the full inventory (the old NO_TARGETING zero-fold
  // retired with the status).
  //
  // CF-SK1 amendment — the campaign's OWN frozen allocations are EXCLUDED from the engagement
  // netting (the E6 seam): its own seconds are its delivery, not competition. Without this, a
  // draft carrying a frozen plan (a cart skip item whose confirm later failed on another item)
  // re-prices against itself on retry — the ceiling collapses below its own budget and the cart
  // wedges on BUDGET_EXCEEDS_CMAX forever. Plan-less campaigns are untouched (empty exclusion).
  // DISP-TOURS (R10) — the ceiling is the tours maximum: every usable heure-type of the pool, the
  // venues under 30 DT even full left out; floored to the centime so it is always deliverable.
  // A campaign never competes with its own allocations (assemble.ts excludes them).
  if (await usesToursEngine(db, campaign.id)) {
    const { pool, calcul } = await calculerCampagne(
      db,
      { id: campaign.id, startDate: campaign.startDate, endDate: campaign.endDate },
      { s: spotSeconds, t, cpm, budgetTnd: budgetTnd ?? Number.POSITIVE_INFINITY },
      { typicalWeek: 'live' },
    );
    const retained = calcul.venues.filter((v) => v.impressions > EPS).length;
    return {
      cMaxTnd: Math.floor(calcul.cMaxTnd * 100 + 1e-6) / 100,
      iMaxFacturable: calcul.iMax,
      eligibleCount: calcul.venues.filter((v) => v.statut !== 'exclu_plein').length,
      targetedCount: pool.candidateCount,
      cpmTnd: cpm,
      ...(budgetTnd === undefined
        ? {}
        : {
            quote: {
              budgetTnd,
              prixTnd: Math.round(calcul.prixTnd * 1e4) / 1e4,
              impressions: calcul.iAlloue,
              venuesCount: retained,
            },
          }),
    };
  }
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
  const { pool, candidateCount } = await assemblePool(
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
    // CF-HF4 — the saturated/empty split: candidates that matched the targeting BEFORE the
    // capacity/day exclusions (0 = nothing matches; > 0 with eligibleCount 0 = saturated).
    targetedCount: candidateCount,
    cpmTnd: cpm,
  };
};
