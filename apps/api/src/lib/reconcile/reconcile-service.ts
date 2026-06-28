import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  type CampaignReconciliation,
  type CampaignScreenhostPayout,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignScreenhostPayout,
  proofOfPlay,
} from '../../db/schema.js';

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
  const sMin = Number(plan.sMin);

  const allocations = await db
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.planId, plan.id));

  // delivered_plays per screenhost = VIDEO_ENDED proofs for this campaign (the billing proof).
  const proofRows = await db
    .select({ screenhostId: proofOfPlay.screenhostId, plays: sql<number>`count(*)::int` })
    .from(proofOfPlay)
    .where(and(eq(proofOfPlay.campaignId, campaignId), eq(proofOfPlay.eventType, 'VIDEO_ENDED')))
    .groupBy(proofOfPlay.screenhostId);
  const deliveredBySh = new Map<string, number>();
  for (const row of proofRows) deliveredBySh.set(row.screenhostId, row.plays);

  const inputs: AllocationInput[] = allocations.map((a) => ({
    screenhostId: a.screenhostId,
    iiPotentiel: a.iiPotentiel,
    expectedPlays: a.creneaux.reduce((sum, c) => sum + c.reps, 0),
    deliveredPlays: deliveredBySh.get(a.screenhostId) ?? 0,
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
