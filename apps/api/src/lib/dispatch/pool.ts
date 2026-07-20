import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { type DrizzleDb } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaignZones,
  screenhostAffluence,
  screenhosts,
} from '../../db/schema.js';

import {
  broadcastableHours,
  capaciteUtile,
  computeR,
  facturableFromPhysical,
  screenhostMatchesTargeting,
  screenhostMatchesZones,
} from './eligibility.js';
import { type PoolEntry, type WindowDay } from './plan.js';
import { buildWindowDays } from './window.js';

// E3 — the ONE pool-assembly authority. Extracted VERBATIM from runDispatch (dispatch-service.ts)
// so dispatch, the refusal cascade (US-2.8) and later redispatch (E6) assemble the eligible pool +
// occupancy netting through the SAME code path: hard filters (active + horaires + capacity +
// targeting + zones), affluence (Ai), engaged broadcast SECONDS from OTHER allocations → residual
// F-budget → R_eff → facturable capacity. The exclusions are the only additions:
//   • excludeScreenhostIds — screenhosts removed from the candidates (the cascade excludes the
//     refuser(s); E6 will exclude dead screens). Empty/absent = the original behavior.
//   • excludeAllocationId / excludeAllocationIds — allocations removed from the ENGAGEMENT
//     netting (a refused/dead allocation will not air, so its seconds must not count). Absent =
//     the original behavior. (E6 passes the plural form for dead-screen allocations; belt-only
//     when their screenhosts are candidate-excluded anyway, since netting is per-candidate.)

// db or an open transaction — commit 2 (US-4.4) runs the assembly INSIDE the freeze tx under
// per-screenhost advisory locks, so the executor is caller-supplied.
export type DbExecutor = DrizzleDb | Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

export interface AssemblePoolOpts {
  excludeScreenhostIds?: string[];
  excludeAllocationId?: string;
  excludeAllocationIds?: string[];
  // US-4.4 — take a pg_advisory_xact_lock per candidate screenhost (SORTED ids — deadlock-free)
  // BEFORE reading engagement, so two allocating transactions over a shared screen serialize and
  // the second sees the first's committed engagement. Only meaningful when `executor` is an open
  // transaction (xact locks release at commit/rollback); the allocating callers (dispatch freeze,
  // refusal cascade) pass true, read-only assembly does not.
  lockOccupancy?: boolean;
}

// US-4.4 — keyspace 1 of pg_advisory_xact_lock(int4, int4) for per-screenhost occupancy; key 2 is
// hashtext(screenhost uuid). A hash collision over-locks (serializes two unrelated screens) which
// is safe; it can never under-lock.
export const OCCUPANCY_LOCK_NAMESPACE = 44_004;

export interface AssemblePoolInputs {
  s: number; // spot duration (seconds)
  t: number; // E1 attention index (duration-derived by the caller)
  fMaxSeconds: number; // F — hourly broadcast cap
}

// E5.1 — the NO_TARGETING refusal RETIRED (VF US-2.1): zero targeting lines = the whole network,
// so the pool always assembles; the matcher owns the empty-set semantics. The result collapses to
// the plain assembled shape.
export interface AssemblePoolResult {
  windowDays: WindowDay[];
  pool: PoolEntry[];
}

export const assemblePool = async (
  executor: DbExecutor,
  campaign: { id: string; startDate: string; endDate: string },
  inputs: AssemblePoolInputs,
  opts: AssemblePoolOpts = {},
): Promise<AssemblePoolResult> => {
  const lines = await executor
    .select({ categoryId: campaignTargeting.categoryId, class: campaignTargeting.class })
    .from(campaignTargeting)
    .where(eq(campaignTargeting.campaignId, campaign.id));

  const windowDays = buildWindowDays(campaign.startDate, campaign.endDate);

  // CF-Z1 — the campaign's targeted zones (VF US-2.1): none = whole network on that criterion.
  const zoneRows = await executor
    .select({ zoneId: campaignZones.zoneId })
    .from(campaignZones)
    .where(eq(campaignZones.campaignId, campaign.id));
  const campaignZoneIds = zoneRows.map((z) => z.zoneId);

  const excluded = new Set(opts.excludeScreenhostIds ?? []);

  // Hard filters: active + horaires set + capacity present + matches targeting (category × class)
  // + in a targeted zone (CF-Z1 — with prod entirely Grand Tunis this changes nothing today).
  const candidates = (
    await executor
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
      !excluded.has(sh.id) &&
      sh.broadcastCapacity !== null &&
      broadcastableHours(sh.openingHour, sh.closingHour).length > 0 &&
      screenhostMatchesTargeting(
        { businessSectorId: sh.businessSectorId, class: sh.class },
        lines,
      ) &&
      screenhostMatchesZones(sh.zoneId, campaignZoneIds),
  );

  const candidateIds = candidates.map((c) => c.id);

  // US-4.4 — pessimistic occupancy locking: serialize on every candidate BEFORE the engagement
  // read below, in SORTED order so two overlapping pools can never deadlock (both acquire in the
  // same global order). Sequential on purpose: ordered acquisition is the deadlock-freedom
  // argument, and the candidates set is Grand-Tunis-sized.
  if (opts.lockOccupancy === true && candidateIds.length > 0) {
    const sortedIds = [...candidateIds].sort();
    for (const id of sortedIds) {
      await executor.execute(
        sql`select pg_advisory_xact_lock(${OCCUPANCY_LOCK_NAMESPACE}, hashtext(${id}))`,
      );
    }
  }

  // Affluence (Ai) for the candidates; engaged broadcast SECONDS (other plans' allocations) cap the
  // per-screen F-budget below.
  const affluenceRows = candidateIds.length
    ? await executor
        .select({
          screenhostId: screenhostAffluence.screenhostId,
          dayOfWeek: screenhostAffluence.dayOfWeek,
          hour: screenhostAffluence.hour,
          estimatedImpressions: screenhostAffluence.estimatedImpressions,
        })
        .from(screenhostAffluence)
        .where(inArray(screenhostAffluence.screenhostId, candidateIds))
    : [];
  const excludedAllocationIds = [
    ...(opts.excludeAllocationId === undefined ? [] : [opts.excludeAllocationId]),
    ...(opts.excludeAllocationIds ?? []),
  ];
  const engagementRows = candidateIds.length
    ? await executor
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
        .where(
          excludedAllocationIds.length === 0
            ? inArray(campaignDispatchAllocation.screenhostId, candidateIds)
            : and(
                inArray(campaignDispatchAllocation.screenhostId, candidateIds),
                notInArray(campaignDispatchAllocation.id, excludedAllocationIds),
              ),
        )
    : [];

  const affByKey = new Map<string, number>();
  for (const a of affluenceRows)
    affByKey.set(`${a.screenhostId}:${a.dayOfWeek}:${a.hour}`, a.estimatedImpressions);
  // Engaged broadcast SECONDS/hour per screen = Σ other campaigns' (r_i × their spot duration S).
  // (At dispatch time this campaign has no allocations yet — ALREADY_DISPATCHED is rejected
  // upstream. At CASCADE time it does, and they count: a retained screenhost's own allocation
  // consumes its budget, so its residual is genuinely what it can still absorb.) Seconds, not
  // impressions: the cross-campaign cap is the 300s/hour broadcast budget, and a 30s spot and a
  // 10s spot cost it differently — impression accounting can't see that.
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
    const residualSeconds = Math.max(0, inputs.fMaxSeconds - (engagedSecondsById.get(sh.id) ?? 0));
    const rEff = computeR(inputs.s, residualSeconds); // PHYSICAL MIN[3600/S, ⌊residual/S⌋]
    // E1 (VF) — Ii = Ii_brut × T: the pool carries FACTURABLE capacity (what the screen is worth
    // to the campaign), floored to whole impressions; the physical rep ceiling stays in repsCap.
    const capacite = Math.floor(
      facturableFromPhysical(capaciteUtile(avgAffluence, hours, rEff), inputs.t),
    );
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

  return { windowDays, pool };
};
