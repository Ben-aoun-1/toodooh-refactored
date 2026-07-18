import { eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  type CampaignReconciliation,
  type CampaignScreenhostPayout,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignScreenhostPayout,
} from '../../db/schema.js';
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

  const inputs: AllocationInput[] = allocations.map((a) => ({
    screenhostId: a.screenhostId,
    creneaux: a.creneaux.map((c) => ({ date: c.date, hour: c.hour, impressions: c.impressions })),
    deliveredSlots: deliveredBySh.get(a.screenhostId) ?? new Set<string>(),
  }));
  const valuation = reconcileCampaign(inputs, cpm, sMin);

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
                  earningsTnd: String(p.earningsTnd),
                })),
              )
              .returning()
          : [];
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
