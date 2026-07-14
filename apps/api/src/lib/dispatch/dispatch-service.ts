import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  type Campaign,
  type CampaignDispatchPlan,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaignZones,
  notifications,
  screenhostAffluence,
  screenhosts,
} from '../../db/schema.js';

import { getDispatchConfig } from './config.js';
import {
  broadcastableHours,
  capaciteUtile,
  computeR,
  screenhostMatchesTargeting,
  screenhostMatchesZones,
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

  const lines = await db
    .select({ categoryId: campaignTargeting.categoryId, class: campaignTargeting.class })
    .from(campaignTargeting)
    .where(eq(campaignTargeting.campaignId, campaign.id));
  if (lines.length === 0) return { status: 'NO_TARGETING' };

  const config = await getDispatchConfig();
  const windowDays = buildWindowDays(campaign.startDate, campaign.endDate);

  // CF-Z1 — the campaign's targeted zones (VF US-2.1): none = whole network on that criterion.
  const zoneRows = await db
    .select({ zoneId: campaignZones.zoneId })
    .from(campaignZones)
    .where(eq(campaignZones.campaignId, campaign.id));
  const campaignZoneIds = zoneRows.map((z) => z.zoneId);

  // Hard filters: active + horaires set + capacity present + matches targeting (category × class)
  // + in a targeted zone (CF-Z1 — with prod entirely Grand Tunis this changes nothing today).
  const candidates = (
    await db
      .select({
        id: screenhosts.id,
        sps: screenhosts.sps,
        businessSectorId: screenhosts.businessSectorId,
        class: screenhosts.class,
        zoneId: screenhosts.zoneId,
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
      screenhostMatchesTargeting(
        { businessSectorId: sh.businessSectorId, class: sh.class },
        lines,
      ) &&
      screenhostMatchesZones(sh.zoneId, campaignZoneIds),
  );

  const candidateIds = candidates.map((c) => c.id);
  // Affluence (Ai) for the candidates; engaged broadcast SECONDS (other plans' allocations) cap the
  // per-screen F-budget below.
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
          rI: campaignDispatchAllocation.rI,
          spotSeconds: campaignDispatchPlan.sSpotSeconds,
        })
        .from(campaignDispatchAllocation)
        .innerJoin(
          campaignDispatchPlan,
          eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
        )
        .where(inArray(campaignDispatchAllocation.screenhostId, candidateIds))
    : [];

  const affByKey = new Map<string, number>();
  for (const a of affluenceRows)
    affByKey.set(`${a.screenhostId}:${a.dayOfWeek}:${a.hour}`, a.estimatedImpressions);
  // Engaged broadcast SECONDS/hour per screen = Σ other campaigns' (r_i × their spot duration S).
  // (This campaign has no allocations yet — ALREADY_DISPATCHED is rejected upstream.) Seconds, not
  // impressions: the cross-campaign cap is the 300s/hour broadcast budget, and a 30s spot and a 10s
  // spot cost it differently — impression accounting can't see that.
  const engagedSecondsById = new Map<string, number>();
  for (const e of engagementRows)
    engagedSecondsById.set(
      e.screenhostId,
      (engagedSecondsById.get(e.screenhostId) ?? 0) + e.rI * e.spotSeconds,
    );

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
    // Per-screen F-second cap: the residual broadcast budget after OTHER campaigns → R_eff. The
    // cross-campaign cap is SECONDS-based (residual ÷ S), so screens shared by campaigns with
    // different spot durations never exceed 300s/hour. (First campaign on a screen: engaged 0 →
    // residual F → R_eff = the unconstrained MIN[(3600/S)·T, F/S] — unchanged behavior.)
    const residualSeconds = Math.max(0, config.fMaxSeconds - (engagedSecondsById.get(sh.id) ?? 0));
    const rEff = computeR(inputs.s, inputs.t, residualSeconds); // MIN[(3600/S)·T, ⌊residual/S⌋]
    const capacite = Math.floor(capaciteUtile(avgAffluence, hours, rEff));
    const residualCapacity = capacite; // the F-cap is baked into R_eff — no impression subtraction
    if (residualCapacity <= 0) continue; // no residual broadcast budget (or zero affluence) → skip
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
      repsCap: rEff,
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
