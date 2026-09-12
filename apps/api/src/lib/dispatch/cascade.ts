import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  type CampaignDispatchPlan,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  notifications,
  screenhosts,
} from '../../db/schema.js';
import { logger } from '../../logger.js';
import { NOOP_TRACE, type EngineTrace } from '../engine-journal/trace.js';

import { computeR, computeRi, physicalFromFacturable } from './eligibility.js';
import { buildCreneaux } from './plan.js';
import { type DbExecutor, assemblePool } from './pool.js';
import { type EligibleScreenhost, selection } from './selection.js';
import { seuilImpressions } from './thresholds.js';

const log = logger.child({ module: 'dispatch-cascade' });

// E3 — the refusal cascade (US-2.8): when a screenhost owner REFUSES a pre-diffusion allocation,
// their share V is re-placed by re-running THE SAME remplissage (selection, unmodified) over the
// remaining pool: screenhosts still eligible, not refused, with residual capacity — which INCLUDES
// already-retained screenhosts whose residual budget lets them absorb more (the VF's La Cloche
// d'Or → Les Dunes scenario). Runs INSIDE the reject route's transaction, under the same
// per-screenhost advisory locks as dispatch (it allocates): the REFUSE write and the re-placement
// are atomic — if the cascade fails, the refusal rolls back too.
//
// All engine parameters come from the FROZEN plan snapshot (cpm/s/T/G_jour/R_min_efficace/F), so a
// cascade can never drift from the plan it amends; only pool state (eligibility, affluence,
// engagement) is live.

export interface CascadeInput {
  plan: CampaignDispatchPlan;
  campaign: { id: string; name: string; startDate: string; endDate: string };
  refused: { id: string; screenhostId: string; iiPotentiel: number };
  /**
   * CAL-1 — PARTIAL re-placement: only part of the source allocation moves (one declared day), the
   * allocation itself stays. The source venue is excluded from the cascade pool (its share must land
   * elsewhere) but its allocation is NOT dropped from the engagement netting — it still airs the
   * other days. Default false = the refusal case (the whole allocation is dead).
   */
  partial?: boolean;
}

export interface CascadeOutcome {
  v: number; // the refused share being re-placed
  absorbed: number; // Σ re-placed onto other screenhosts
  createdAllocations: number; // new EN_ATTENTE rows
  updatedAllocations: number; // retained screenhosts that absorbed more (merged, back EN_ATTENTE)
  reliquatStored: number; // sub-seuil shortfall → joined the plan's reliquat_stocke (E3 amendment)
  flippedPartial: boolean; // ≥-seuil shortfall → the plan's clôture-1 flag
}

export const runRefusalCascade = async (
  tx: DbExecutor,
  input: CascadeInput,
  // LOG1 — observe-only journal (default no-op). The cascade runs on the CALLER's tx, so it can
  // only buffer; the reject route owns the post-outcome flush.
  trace: EngineTrace = NOOP_TRACE,
): Promise<CascadeOutcome> => {
  const { plan, campaign, refused } = input;
  const v = refused.iiPotentiel;
  trace.event('refusal_received', { impressions: v }, refused.screenhostId);
  const s = plan.sSpotSeconds;
  const t = Number(plan.tTierCoef);
  const cpm = Number(plan.cpm);
  const seuil = seuilImpressions(cpm);
  const gJour = Number(plan.gJour);

  // Every screenhost with a REFUSE row on this plan is out of the cascade pool — the refuser
  // (its row was just flipped in this tx) AND earlier refusers: re-offering a refused venue would
  // clobber its REFUSE history through the (plan, screenhost) unique row, and « cette action est
  // définitive ». The refused allocation is also dropped from the engagement netting (it will not
  // air) — belt only, since its screenhost is excluded outright.
  const refusedRows = await tx
    .select({ screenhostId: campaignDispatchAllocation.screenhostId })
    .from(campaignDispatchAllocation)
    .where(
      and(
        eq(campaignDispatchAllocation.planId, plan.id),
        eq(campaignDispatchAllocation.statutAcceptation, 'REFUSE'),
      ),
    );
  const excludeScreenhostIds = [
    ...new Set([...refusedRows.map((r) => r.screenhostId), refused.screenhostId]),
  ];

  // E5.1 — the pool always assembles (zero targeting lines = the whole network); the defensive
  // NO_TARGETING fallback is gone with the retired status. CAL-1: a partial move keeps the source
  // allocation engaged (it airs the other days), so it is not un-netted.
  const { pool } = await assemblePool(
    tx,
    campaign,
    { s, t, fMaxSeconds: plan.fMaxSeconds },
    {
      excludeScreenhostIds,
      ...(input.partial ? {} : { excludeAllocationId: refused.id }),
      lockOccupancy: true,
      trace,
    },
  );

  // THE SAME remplissage as dispatch — selection() verbatim, over the residual pool, for V.
  const eligible: EligibleScreenhost[] = pool.map((p) => ({
    id: p.id,
    sps: p.sps,
    anciennete: p.anciennete,
    residualCapacity: p.residualCapacity,
    revenuJour: p.revenuJour,
    activeToday: p.activeToday,
  }));
  const { retenus, couvert: absorbed } = selection(eligible, v, { seuilDiffusable: seuil, gJour });

  const poolById = new Map(pool.map((p) => [p.id, p]));
  const retainedIds = retenus.map((r) => r.id);
  const existingRows = retainedIds.length
    ? await tx
        .select()
        .from(campaignDispatchAllocation)
        .where(
          and(
            eq(campaignDispatchAllocation.planId, plan.id),
            inArray(campaignDispatchAllocation.screenhostId, retainedIds),
          ),
        )
    : [];
  const existingBySh = new Map(existingRows.map((r) => [r.screenhostId, r]));

  let createdAllocations = 0;
  let updatedAllocations = 0;
  for (const ret of retenus) {
    const p = poolById.get(ret.id);
    if (!p) continue;
    const existing = existingBySh.get(ret.id);
    if (existing) {
      // Retained screenhost absorbing MORE: the pool netted its OWN engagement, so ret.ai is the
      // ADDITIONAL share and p.repsCap the ADDITIONAL reps budget. Recompute r_i on the TOTAL
      // against the total residual ceiling (old reps + additional budget, physical hour bound) —
      // the same computeRi as dispatch, so Σ(r_i × S) ≤ F still holds on this screen. The deal
      // changed → back to EN_ATTENTE: the owner re-accepts the enlarged share.
      const totalAi = existing.iiPotentiel + ret.ai;
      const capTotal = Math.min(existing.rI + p.repsCap, computeR(s, 3600));
      const rI = computeRi(
        physicalFromFacturable(totalAi, t),
        p.avgAffluence,
        p.hours,
        plan.rMinEfficace,
        capTotal,
      );
      await tx
        .update(campaignDispatchAllocation)
        .set({
          iiPotentiel: totalAi,
          rI,
          revenuPrevisionnel: String((totalAi * cpm) / 1000),
          creneaux: buildCreneaux(p.days, p.slots, rI),
          statutAcceptation: 'EN_ATTENTE',
        })
        .where(eq(campaignDispatchAllocation.id, existing.id));
      updatedAllocations += 1;
      trace.event(
        'replacement_placed',
        { impressions: ret.ai, valueTnd: (ret.ai * cpm) / 1000, merged: true },
        ret.id,
      );
    } else {
      // Fresh screenhost — same shape as a dispatch allocation (EN_ATTENTE by default).
      const rI = computeRi(
        physicalFromFacturable(ret.ai, t),
        p.avgAffluence,
        p.hours,
        plan.rMinEfficace,
        p.repsCap,
      );
      await tx.insert(campaignDispatchAllocation).values({
        planId: plan.id,
        screenhostId: ret.id,
        iiPotentiel: ret.ai,
        rI,
        revenuPrevisionnel: String((ret.ai * cpm) / 1000),
        creneaux: buildCreneaux(p.days, p.slots, rI),
      });
      createdAllocations += 1;
      trace.event(
        'replacement_placed',
        { impressions: ret.ai, valueTnd: (ret.ai * cpm) / 1000, merged: false },
        ret.id,
      );
    }
  }

  // Notify each DISTINCT owner whose venue must (re-)accept — the dispatch producer pattern,
  // inside the same transaction.
  if (retainedIds.length > 0) {
    const ownerRows = await tx
      .select({ ownerId: screenhosts.ownerId })
      .from(screenhosts)
      .where(inArray(screenhosts.id, retainedIds));
    const ownerIds = [
      ...new Set(ownerRows.map((r) => r.ownerId).filter((id): id is string => id !== null)),
    ];
    if (ownerIds.length > 0) {
      await tx.insert(notifications).values(
        ownerIds.map((ownerId) => ({
          userId: ownerId,
          type: 'dispatch_pending_acceptance',
          title: 'Campagne en attente de votre acceptation',
          body: `La campagne « ${campaign.name} » attend votre acceptation.`,
          campaignId: campaign.id,
        })),
      );
    }
  }

  // Shortfall (nothing/partially absorbable) — the E3 amendment matrix: a sub-seuil remainder
  // JOINS the stored reliquat (E6 revalidates materiality on the total); a ≥-seuil remainder is
  // the clôture-1 path (is_partial flips, nothing stored).
  const shortfall = v - absorbed;
  let reliquatStored = 0;
  let flippedPartial = false;
  if (shortfall > 0 && shortfall < seuil) {
    reliquatStored = shortfall;
    trace.event('reliquat_stored', { impressions: shortfall, seuil });
    await tx
      .update(campaignDispatchPlan)
      .set({ reliquatStocke: sql`${campaignDispatchPlan.reliquatStocke} + ${shortfall}` })
      .where(eq(campaignDispatchPlan.id, plan.id));
    log.info(
      { campaignId: campaign.id, planId: plan.id, shortfall, seuil },
      'cascade: reliquat sous le seuil — stocké pour le redispatch (E6)',
    );
  } else if (shortfall >= seuil) {
    flippedPartial = true;
    trace.event('partial_coverage', { shortfall, seuil });
    await tx
      .update(campaignDispatchPlan)
      .set({ isPartial: true })
      .where(eq(campaignDispatchPlan.id, plan.id));
    log.warn(
      { campaignId: campaign.id, planId: plan.id, shortfall, seuil },
      'cascade: part refusée non réabsorbable — plan partiel (clôture 1)',
    );
  }

  return { v, absorbed, createdAllocations, updatedAllocations, reliquatStored, flippedPartial };
};
