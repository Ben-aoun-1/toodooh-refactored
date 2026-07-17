import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  type Campaign,
  type CampaignDispatchPlan,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  notifications,
  screenhosts,
} from '../../db/schema.js';
import { logger } from '../../logger.js';

import { getDispatchConfig } from './config.js';
import { buildPlan } from './plan.js';
import { assemblePool } from './pool.js';
import { seuilImpressions, tForDuration } from './thresholds.js';

const log = logger.child({ module: 'dispatch' });

// E1 (VF) — T is no longer an input: the attention index derives from the spot duration S and the
// config's t_10s/t_20s/t_30s buckets inside runDispatch (and is snapshotted onto the plan).
export interface DispatchInputs {
  iCible: number;
  cpm: number;
  s: number;
}

export type DispatchResult =
  | { status: 'NO_WINDOW' }
  | { status: 'NO_TARGETING' }
  | { status: 'ALREADY_DISPATCHED' }
  | { status: 'TOO_THIN'; nMin: number; nMax: number }
  | { status: 'NO_ELIGIBLE' }
  | { status: 'OK'; plan: CampaignDispatchPlan; allocationCount: number };

// Assemble the eligible pool from the DB, run the pure pipeline, and persist the frozen plan
// (A.7, irrevocable). Owner-scope is N/A (admin/internal entrypoint); the campaign is passed in.
export const runDispatch = async (
  campaign: Pick<Campaign, 'id' | 'name' | 'startDate' | 'endDate'>,
  inputs: DispatchInputs,
): Promise<DispatchResult> => {
  if (!campaign.startDate || !campaign.endDate) return { status: 'NO_WINDOW' };

  const [existing] = await db
    .select({ id: campaignDispatchPlan.id })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaign.id))
    .limit(1);
  if (existing) return { status: 'ALREADY_DISPATCHED' }; // frozen + irrevocable

  const config = await getDispatchConfig();
  // E1 (VF) — the attention index for THIS campaign's spot duration; snapshotted onto the plan.
  const t = tForDuration(inputs.s, config);
  // E3 (Mariem 2026-07-15 amendment) — the anti-miette seuil is VALUE-based, derived HERE from the
  // campaign's CPM (the same S_min=20 TND rule as redispatch). dispatch_config.seuil_diffusable no
  // longer feeds this path (superseded; the column stays for the admin surface).
  const seuil = seuilImpressions(inputs.cpm);

  // E3 — the pool assembly + occupancy netting live in assemblePool (shared with the refusal
  // cascade and later redispatch); dispatch runs it with no exclusions.
  const assembled = await assemblePool(
    db,
    { id: campaign.id, startDate: campaign.startDate, endDate: campaign.endDate },
    { s: inputs.s, t, fMaxSeconds: config.fMaxSeconds },
  );
  if (assembled.status === 'NO_TARGETING') return { status: 'NO_TARGETING' };
  const { windowDays, pool } = assembled;

  const built = buildPlan({
    iCible: inputs.iCible,
    cpm: inputs.cpm,
    s: inputs.s,
    t,
    seuilDiffusable: seuil,
    gMois: config.gMois,
    joursActifs: config.joursActifs,
    rMinEfficace: config.rMinEfficace,
    fMaxSeconds: config.fMaxSeconds,
    windowDays,
    pool,
  });

  // Clôture: a too-thin (N_min>N_max / empty pool) or no-allocation result is NOT a deliverable
  // plan — do NOT freeze it. Freezing an empty plan + the unique index would lock the campaign
  // forever; instead return the clôture alert so the advertiser can adjust the cursor / targeting
  // and re-dispatch (renvoi curseur). A genuine PARTIAL (nRetenus>0, not too-thin) IS delivered → frozen.
  if (built.isTooThin) return { status: 'TOO_THIN', nMin: built.nMin, nMax: built.nMax };
  if (built.nRetenus === 0) return { status: 'NO_ELIGIBLE' };

  // E3 amendment — a sub-seuil uncovered remainder is stored on the plan for E6, not dropped.
  if (built.reliquatStocke > 0) {
    log.info(
      { campaignId: campaign.id, reliquat: built.reliquatStocke, seuil },
      'dispatch: reliquat sous le seuil — stocké pour le redispatch (E6)',
    );
  }

  // Persist the frozen plan + allocations atomically.
  const inserted = await db
    .transaction(async (tx) => {
      const [planRow] = await tx
        .insert(campaignDispatchPlan)
        .values({
          campaignId: campaign.id,
          iCible: inputs.iCible,
          cpm: String(inputs.cpm),
          sSpotSeconds: inputs.s,
          // E1 — the column keeps its historical name; since E1 it snapshots the ATTENTION index
          // T (duration-derived), no longer a tier coefficient.
          tTierCoef: String(t),
          // E3 — snapshots the DERIVED value-based seuil (seuilImpressions(cpm)), the threshold
          // this plan was actually built against.
          seuilDiffusable: seuil,
          sMin: String(built.sMin),
          gJour: String(built.gJour),
          fMaxSeconds: config.fMaxSeconds,
          rMinEfficace: config.rMinEfficace,
          couvert: built.couvert,
          nMin: built.nMin,
          nMax: built.nMax,
          nRetenus: built.nRetenus,
          isPartial: built.isPartial,
          isTooThin: built.isTooThin,
          reliquatStocke: built.reliquatStocke,
        })
        .returning();
      if (!planRow) throw new Error('dispatch plan insert failed');
      if (built.allocations.length > 0) {
        await tx.insert(campaignDispatchAllocation).values(
          built.allocations.map((a) => ({
            planId: planRow.id,
            screenhostId: a.screenhostId,
            iiPotentiel: a.iiPotentiel,
            rI: a.rI,
            revenuPrevisionnel: String(a.revenuPrevisionnel),
            creneaux: a.creneaux,
          })),
        );
        // PRODUCER — every allocation lands EN_ATTENTE (the new default), so the campaign won't air
        // until the screenhost OWNER accepts it. Notify each DISTINCT allocated owner once (an owner
        // with several allocated venues gets a single notification → their accept/reject surface
        // lists all their EN_ATTENTE allocations). Screenhosts with no owner are skipped. Inside the
        // same transaction as the freeze: the plan, allocations, and notifications are all-or-nothing.
        const allocatedScreenhostIds = built.allocations.map((a) => a.screenhostId);
        const ownerRows = await tx
          .select({ ownerId: screenhosts.ownerId })
          .from(screenhosts)
          .where(inArray(screenhosts.id, allocatedScreenhostIds));
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
      return planRow;
    })
    .catch((err: unknown) => {
      // Lost the check-then-insert race against the unique index (campaign_dispatch_plan_campaign_uq):
      // a concurrent dispatch already froze the plan. Surface the irrevocable conflict, not a 500.
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    });
  if (inserted === null) return { status: 'ALREADY_DISPATCHED' };

  return { status: 'OK', plan: inserted, allocationCount: built.allocations.length };
};
