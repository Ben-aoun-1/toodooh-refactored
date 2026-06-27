import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  type Campaign,
  type CampaignDispatchPlan,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  screenhostAffluence,
  screenhosts,
} from '../../db/schema.js';

import { getDispatchConfig } from './config.js';
import {
  broadcastableHours,
  capaciteUtile,
  computeR,
  screenhostMatchesTargeting,
} from './eligibility.js';
import { type PoolEntry, buildPlan } from './plan.js';
import { buildWindowDays } from './window.js';

export interface DispatchInputs {
  iCible: number;
  cpm: number;
  s: number;
  t: number;
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
  campaign: Pick<Campaign, 'id' | 'startDate' | 'endDate'>,
  inputs: DispatchInputs,
): Promise<DispatchResult> => {
  if (!campaign.startDate || !campaign.endDate) return { status: 'NO_WINDOW' };

  const [existing] = await db
    .select({ id: campaignDispatchPlan.id })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaign.id))
    .limit(1);
  if (existing) return { status: 'ALREADY_DISPATCHED' }; // frozen + irrevocable

  const lines = await db
    .select({ categoryId: campaignTargeting.categoryId, class: campaignTargeting.class })
    .from(campaignTargeting)
    .where(eq(campaignTargeting.campaignId, campaign.id));
  if (lines.length === 0) return { status: 'NO_TARGETING' };

  const config = await getDispatchConfig();
  const r = computeR(inputs.s, inputs.t, config.fMaxSeconds);
  const windowDays = buildWindowDays(campaign.startDate, campaign.endDate);

  // Hard filters: active + horaires set + capacity present + matches targeting (category × class).
  const candidates = (
    await db
      .select({
        id: screenhosts.id,
        sps: screenhosts.sps,
        businessSectorId: screenhosts.businessSectorId,
        class: screenhosts.class,
        openingHour: screenhosts.openingHour,
        closingHour: screenhosts.closingHour,
        broadcastCapacity: screenhosts.broadcastCapacity,
      })
      .from(screenhosts)
      .where(eq(screenhosts.isActive, true))
  ).filter(
    (sh) =>
      sh.broadcastCapacity !== null &&
      broadcastableHours(sh.openingHour, sh.closingHour).length > 0 &&
      screenhostMatchesTargeting({ businessSectorId: sh.businessSectorId, class: sh.class }, lines),
  );

  const candidateIds = candidates.map((c) => c.id);
  // Affluence (Ai) for the candidates; engagements (other plans' allocations) reduce residual.
  const affluenceRows = candidateIds.length
    ? await db
        .select({
          screenhostId: screenhostAffluence.screenhostId,
          dayOfWeek: screenhostAffluence.dayOfWeek,
          hour: screenhostAffluence.hour,
          estimatedImpressions: screenhostAffluence.estimatedImpressions,
        })
        .from(screenhostAffluence)
        .where(inArray(screenhostAffluence.screenhostId, candidateIds))
    : [];
  const engagementRows = candidateIds.length
    ? await db
        .select({
          screenhostId: campaignDispatchAllocation.screenhostId,
          iiPotentiel: campaignDispatchAllocation.iiPotentiel,
        })
        .from(campaignDispatchAllocation)
        .where(inArray(campaignDispatchAllocation.screenhostId, candidateIds))
    : [];

  const affByKey = new Map<string, number>();
  for (const a of affluenceRows)
    affByKey.set(`${a.screenhostId}:${a.dayOfWeek}:${a.hour}`, a.estimatedImpressions);
  const engagedById = new Map<string, number>();
  for (const e of engagementRows)
    engagedById.set(e.screenhostId, (engagedById.get(e.screenhostId) ?? 0) + e.iiPotentiel);

  const windowWeekdays = [...new Set(windowDays.map((d) => d.dayOfWeek))];

  const pool: PoolEntry[] = [];
  for (const sh of candidates) {
    const bHours = broadcastableHours(sh.openingHour, sh.closingHour);
    const slots = windowWeekdays.flatMap((dow) =>
      bHours.map((hour) => ({
        dayOfWeek: dow,
        hour,
        affluence: affByKey.get(`${sh.id}:${dow}:${hour}`) ?? 0,
      })),
    );
    const hours = windowDays.length * bHours.length; // Hi — broadcastable slots over the window
    let totalAffluence = 0;
    for (const day of windowDays) {
      for (const hour of bHours)
        totalAffluence += affByKey.get(`${sh.id}:${day.dayOfWeek}:${hour}`) ?? 0;
    }
    const avgAffluence = hours > 0 ? totalAffluence / hours : 0;
    // Floor to whole impressions: capaciteUtile round-trips through FP (avgAffluence = total/hours
    // → ×hours), so non-uniform affluence yields e.g. 60030.0000000007. Flooring at the source keeps
    // residual/ai/couvert/ii_potentiel integers (the persisted columns are `integer`).
    const capacite = Math.floor(capaciteUtile(avgAffluence, hours, r));
    const residualCapacity = Math.max(0, capacite - (engagedById.get(sh.id) ?? 0));
    if (residualCapacity <= 0) continue; // residual capacity > 0 hard filter
    pool.push({
      id: sh.id,
      sps: Number(sh.sps),
      // V1 STUB (hardcoded — NOT registre-derived): no last-service / per-day-revenue registre
      // exists yet, so the dignity rule + ancienneté tiebreak are INERT until one does. Only
      // `engagements` (above) is genuinely derived from stored plans. TODO: wire a registre.
      anciennete: 0,
      revenuJour: 0,
      activeToday: false,
      avgAffluence,
      hours,
      capaciteUtile: capacite,
      residualCapacity,
      slots,
    });
  }

  const built = buildPlan({
    iCible: inputs.iCible,
    cpm: inputs.cpm,
    s: inputs.s,
    t: inputs.t,
    seuilDiffusable: config.seuilDiffusable,
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
          tTierCoef: String(inputs.t),
          seuilDiffusable: config.seuilDiffusable,
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
