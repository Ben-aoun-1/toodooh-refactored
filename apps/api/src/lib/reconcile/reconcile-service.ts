import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  type CampaignReconciliation,
  type CampaignScreenhostPayout,
  agentReferrals,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignRedispatchRounds,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  reversementLines,
  screenhosts,
} from '../../db/schema.js';
import { getDispatchConfig } from '../dispatch/config.js';
import {
  computeReversement,
  millimesToTnd,
  reversementBaseMillimes,
} from '../reversement/split.js';
import { S_MIN_TND } from '../vf-constants.js';

// E6 — the delivered-per-créneau bucketing is SHARED with the redispatch detector
// (delivered-slots.ts): one FIX A implementation, zero drift between detection and settlement.
import { loadDeliveredSlots } from './delivered-slots.js';
import { type AllocationInput, type CampaignValuation, reconcileCampaign } from './valuation.js';

export type ReconcileResult =
  | { status: 'NO_PLAN' }
  | { status: 'ALREADY_RECONCILED' }
  | {
      status: 'OK';
      reconciliation: CampaignReconciliation;
      payouts: CampaignScreenhostPayout[];
      valuation: CampaignValuation;
    };

// Reconcile one campaign: read the frozen plan + its allocations (the PROMISE) and the VIDEO_ENDED
// proof_of_play counts per screenhost (the ACTUAL), value the shortfall (valuation.ts), and persist
// the campaign_reconciliation row + per-screenhost payouts in one transaction. The unique(campaign_id)
// constraint is the idempotency guard — a concurrent / repeat reconcile loses the insert race (23505)
// and is reported ALREADY_RECONCILED rather than double-settling. snapshot cpm + s_min from the plan.
export const reconcileCampaignById = async (
  campaignId: string,
  reconciledBy: string,
): Promise<ReconcileResult> => {
  const [existing] = await db
    .select({ id: campaignReconciliation.id })
    .from(campaignReconciliation)
    .where(eq(campaignReconciliation.campaignId, campaignId))
    .limit(1);
  if (existing) return { status: 'ALREADY_RECONCILED' };

  const [plan] = await db
    .select()
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaignId))
    .limit(1);
  if (!plan) return { status: 'NO_PLAN' };
  const cpm = Number(plan.cpm);
  // E1 (VF) — the refund gate reads the FIXED VF materiality floor (S_min = 20 TND), no longer the
  // plan's derived snapshot (seuil × CPM/1000 ≈ 15 TND at POC values). The snapshot column stays
  // stored for audit; only the GATE moved. BEHAVIOR CHANGE: gaps valued in [old_s_min, 20) TND now
  // settle RÉUSSIE (no refund) instead of PARTIAL.
  const sMin = S_MIN_TND;

  const allocations = await db
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.planId, plan.id));

  // Delivered SLOTS per screenhost — the shared FIX A bucketing (binary per Tunis (date,hour)).
  const deliveredBySh = await loadDeliveredSlots(campaignId);

  // E6 — the NET context: the plan's frozen T (physical → facturable), the CURRENT stored
  // reliquat (never delivered, never replaced → part of the net gap by construction), and the
  // rounds ledger's missed-sourced placements (the double-count the NET math removes — a
  // replaced-and-delivered slot can never also be refunded).
  const rounds = await db
    .select({
      placedFact: campaignRedispatchRounds.placedFact,
      reliquatConsumedFact: campaignRedispatchRounds.reliquatConsumedFact,
    })
    .from(campaignRedispatchRounds)
    .where(eq(campaignRedispatchRounds.campaignId, campaignId));
  const replacedMissedFact = rounds.reduce(
    (sum, r) => sum + Math.max(0, r.placedFact - r.reliquatConsumedFact),
    0,
  );

  const inputs: AllocationInput[] = allocations.map((a) => ({
    screenhostId: a.screenhostId,
    creneaux: a.creneaux.map((c) => ({ date: c.date, hour: c.hour, impressions: c.impressions })),
    deliveredSlots: deliveredBySh.get(a.screenhostId) ?? new Set<string>(),
  }));
  const t = Number(plan.tTierCoef);
  const valuation = reconcileCampaign(inputs, cpm, sMin, {
    t,
    reliquatStockeFact: plan.reliquatStocke,
    replacedMissedFact,
  });

  // ── E7 (VF EPIC 5) — the reversement split of each venue's DELIVERED value ────────────────────
  // Base (SPEC form): Revenu_i = (Ii_diffusé_fact ÷ I_cible) × C_cible with C_cible the plan's
  // target value (I_cible × CPM/1000) — algebraically ≡ diffusé × CPM/1000 (pinned in the rail
  // tests). The refunded/undelivered part NEVER enters a base: bases are delivered-only, so the
  // split and the E6 refund path cannot overlap by construction. A RÉUSSIE's sub-S_min gap sits
  // in spend but in NO line — it rests with the platform, unsplit. Splits are computed BEFORE the
  // transaction (a drifted Σ≠100 config throws here and nothing persists). Pre-E7 settlements are
  // never restated — the ALREADY_RECONCILED short-circuit above is the only path to old rows.
  const cfg = await getDispatchConfig();
  const pcts = {
    sh: cfg.pctSh,
    toodooh: cfg.pctToodooh,
    agentSh: cfg.pctAgentSh,
    agentSc: cfg.pctAgentSc,
  };
  const cCibleTnd = (plan.iCible * cpm) / 1000;
  const splits = valuation.perScreenhost
    .filter((p) => p.deliveredImp > 0)
    .map((p) => ({
      screenhostId: p.screenhostId,
      split: computeReversement(
        reversementBaseMillimes(p.deliveredImp * t, plan.iCible, cCibleTnd),
        pcts,
      ),
    }));
  const shAmountBySh = new Map(
    splits.map((s) => [s.screenhostId, millimesToTnd(s.split.shMillimes)]),
  );

  // Agent attribution (read-only): the venue owner's / the advertiser's referring agent, NULL when
  // no referral exists (the 3 % amounts are recorded regardless — payout mechanics are later).
  const [campaignRow] = await db
    .select({ advertiserId: campaigns.advertiserId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const advertiserId = campaignRow?.advertiserId ?? null;
  const splitShIds = splits.map((s) => s.screenhostId);
  const ownerRows = splitShIds.length
    ? await db
        .select({ id: screenhosts.id, ownerId: screenhosts.ownerId })
        .from(screenhosts)
        .where(inArray(screenhosts.id, splitShIds))
    : [];
  const ownerBySh = new Map(ownerRows.map((r) => [r.id, r.ownerId]));
  const referredIds = [
    ...new Set(
      [...ownerRows.map((r) => r.ownerId), advertiserId].filter((v): v is string => v !== null),
    ),
  ];
  const referralRows = referredIds.length
    ? await db
        .select({
          agentUserId: agentReferrals.agentUserId,
          referredUserId: agentReferrals.referredUserId,
        })
        .from(agentReferrals)
        .where(inArray(agentReferrals.referredUserId, referredIds))
    : [];
  const agentByReferred = new Map(referralRows.map((r) => [r.referredUserId, r.agentUserId]));

  const persisted = await db
    .transaction(async (tx) => {
      const [recon] = await tx
        .insert(campaignReconciliation)
        .values({
          campaignId,
          expectedImp: valuation.expectedImp,
          deliveredImp: valuation.deliveredImp,
          manquementImp: valuation.manquementImp,
          pPerteTnd: String(valuation.pPerteTnd),
          refundTnd: String(valuation.refundTnd),
          spendTnd: String(valuation.spendTnd),
          status: valuation.status,
          reconciledBy,
        })
        .returning();
      if (!recon) throw new Error('reconciliation insert failed');
      const payouts =
        valuation.perScreenhost.length > 0
          ? await tx
              .insert(campaignScreenhostPayout)
              .values(
                valuation.perScreenhost.map((p) => ({
                  reconciliationId: recon.id,
                  campaignId,
                  screenhostId: p.screenhostId,
                  expectedImp: p.expectedImp,
                  deliveredImp: p.deliveredImp,
                  // E7 — the venue payable IS the 50 % SH line (was 100 % of delivered value).
                  earningsTnd: String(shAmountBySh.get(p.screenhostId) ?? 0),
                })),
              )
              .returning()
          : [];
      if (splits.length > 0) {
        await tx.insert(reversementLines).values(
          splits.map(({ screenhostId, split }) => {
            const ownerId = ownerBySh.get(screenhostId) ?? null;
            return {
              source: 'campaign',
              campaignId,
              screenhostId,
              baseValueTnd: String(millimesToTnd(split.baseMillimes)),
              shAmountTnd: String(millimesToTnd(split.shMillimes)),
              toodoohAmountTnd: String(millimesToTnd(split.toodoohMillimes)),
              agentShAmountTnd: String(millimesToTnd(split.agentShMillimes)),
              agentScAmountTnd: String(millimesToTnd(split.agentScMillimes)),
              agentShId: ownerId === null ? null : (agentByReferred.get(ownerId) ?? null),
              agentScId: advertiserId === null ? null : (agentByReferred.get(advertiserId) ?? null),
              settledAt: recon.reconciledAt,
            };
          }),
        );
      }
      return { recon, payouts };
    })
    .catch((err: unknown) => {
      // Lost the race against the unique(campaign_id) — a concurrent reconcile already settled.
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    });
  if (persisted === null) return { status: 'ALREADY_RECONCILED' };

  return {
    status: 'OK',
    reconciliation: persisted.recon,
    payouts: persisted.payouts,
    valuation,
  };
};
