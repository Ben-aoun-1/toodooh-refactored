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
    const capacite = capaciteUtile(avgAffluence, hours, r);
    const residualCapacity = Math.max(0, capacite - (engagedById.get(sh.id) ?? 0));
    if (residualCapacity <= 0) continue; // residual capacity > 0 hard filter
    pool.push({
      id: sh.id,
      sps: Number(sh.sps),
      anciennete: 0, // V1: derived from the registre (no prior plans → ties)
      revenuJour: 0, // V1: no prior plans today
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

  // Persist the frozen plan + allocations atomically.
  const plan = await db.transaction(async (tx) => {
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
  });

  return { status: 'OK', plan, allocationCount: built.allocations.length };
};
