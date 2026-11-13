import { and, eq, inArray } from 'drizzle-orm';

import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  notifications,
  screenhosts,
} from '../../../db/schema.js';
import { dropTypicalWeekFreeze } from '../../typical-week-freeze.js';
import { getDispatchConfig } from '../config.js';
import { type DbExecutor } from '../pool.js';

// DISP-TOURS Q1 (Mariem, 03/11/2026: « ok ») — a standard campaign is frozen and its places
// reserved at « Lancer » in every case; it airs only once its spot is validated; a refused spot
// frees the places and the amount goes back to the wallet. While the spot waits, the campaign is
// « en attente » with RESERVE allocations: they hold their hours, but no owner sees them nor is
// told — an owner never handles a campaign whose spot is not validated. Here, the owners'
// notice (R13, one home for the launch and the validation), the validation's proposal, and the
// refusal's release.

/** R13 — one notice per owner, with what the campaign brings them (always ≥ 30 DT a venue). */
export const tellOwners = async (
  tx: DbExecutor,
  campaign: { id: string; name: string },
  venues: readonly { venueId: string; montantTnd: number }[],
): Promise<void> => {
  if (venues.length === 0) return;
  const ownerRows = await tx
    .select({ id: screenhosts.id, ownerId: screenhosts.ownerId })
    .from(screenhosts)
    .where(
      inArray(
        screenhosts.id,
        venues.map((v) => v.venueId),
      ),
    );
  const montantByOwner = new Map<string, number>();
  for (const r of ownerRows) {
    if (r.ownerId === null) continue;
    const montant = venues.find((v) => v.venueId === r.id)?.montantTnd ?? 0;
    montantByOwner.set(r.ownerId, (montantByOwner.get(r.ownerId) ?? 0) + montant);
  }
  if (montantByOwner.size === 0) return;
  await tx.insert(notifications).values(
    [...montantByOwner].map(([ownerId, montant]) => ({
      userId: ownerId,
      type: 'dispatch_pending_acceptance',
      title: 'Campagne en attente de votre acceptation',
      body: `La campagne « ${campaign.name} » vous rapporte ${montant.toFixed(2).replace('.', ',')} DT. Elle attend votre acceptation.`,
      campaignId: campaign.id,
    })),
  );
};

/**
 * The spot is validated (the activation's flip): the reserved allocations are proposed to their
 * owners — RESERVE → EN_ATTENTE — and each owner is told the amount. A no-op for a campaign
 * launched with its spot already validated (its allocations were proposed at the launch).
 */
export const proposeReserved = async (
  tx: DbExecutor,
  campaign: { id: string; name: string },
): Promise<void> => {
  const [plan] = await tx
    .select({ id: campaignDispatchPlan.id, detail: campaignDispatchPlan.detail })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaign.id))
    .limit(1);
  if (!plan) return;
  // created_at becomes the proposal's instant: the owner's answer delay (SPS, the agents'
  // follow-up) runs from when they were asked, never from the reservation.
  const proposed = await tx
    .update(campaignDispatchAllocation)
    .set({ statutAcceptation: 'EN_ATTENTE', createdAt: new Date() })
    .where(
      and(
        eq(campaignDispatchAllocation.planId, plan.id),
        eq(campaignDispatchAllocation.statutAcceptation, 'RESERVE'),
      ),
    )
    .returning({
      venueId: campaignDispatchAllocation.screenhostId,
      revenu: campaignDispatchAllocation.revenuPrevisionnel,
    });
  if (proposed.length === 0) return;
  const pctSh = plan.detail?.params.pctSh ?? (await getDispatchConfig()).pctSh;
  await tellOwners(
    tx,
    campaign,
    proposed.map((p) => ({ venueId: p.venueId, montantTnd: (Number(p.revenu) * pctSh) / 100 })),
  );
};

/**
 * The campaign is refused before it was ever validated: its reserved places are given back (the
 * plan and its allocations go — nothing aired, nothing to settle), so is its typical-week freeze,
 * and its targeted budget comes back (the launch had set the exact price). The wallet engages
 * nothing for a refused campaign (lib/recharges.ts): the amount is available again.
 */
export const releaseReservation = async (tx: DbExecutor, campaignId: string): Promise<void> => {
  const [plan] = await tx
    .select({
      id: campaignDispatchPlan.id,
      engine: campaignDispatchPlan.engine,
      detail: campaignDispatchPlan.detail,
    })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaignId))
    .limit(1);
  if (plan?.engine !== 'tours') return;
  await tx.delete(campaignDispatchPlan).where(eq(campaignDispatchPlan.id, plan.id));
  await dropTypicalWeekFreeze(tx, campaignId);
  const target = plan.detail?.budgetTnd;
  if (target !== undefined && Number.isFinite(target)) {
    await tx
      .update(campaigns)
      .set({ requestedBudget: (Math.round(target * 100) / 100).toFixed(2) })
      .where(eq(campaigns.id, campaignId));
  }
};
