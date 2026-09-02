import { and, eq, gte, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';

import { type DrizzleDb } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaignZones,
  campaigns,
  hourReservations,
  screenhostAffluence,
  screenhostUnavailability,
  screenhosts,
} from '../../db/schema.js';
import { NOOP_TRACE, type EngineTrace } from '../engine-journal/trace.js';
import { collapseHalvesSql } from '../half-hour-slots.js';
import { SPS_NEUTRAL, spsComputable, spsObservationsFor } from '../sps-score.js';

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
  // LOG1 — observe-only journal collector (buffers in memory; flushed by the run's owner AFTER
  // the tx). Absent = NOOP: the assembly's behavior AND its query count are byte-unchanged (the
  // one extra inactive-venue read below is gated on trace.enabled).
  trace?: EngineTrace;
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
  /** CF-HF4 — candidates that matched targeting/zones/hours BEFORE capacity/day exclusions.
   *  0 = the targeting matches nothing; > 0 with an empty pool = saturated inventory. */
  candidateCount: number;
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
  const trace = opts.trace ?? NOOP_TRACE;

  // Hard filters: active + horaires set + capacity present + matches targeting (category × class)
  // + in a targeted zone (CF-Z1 — with prod entirely Grand Tunis this changes nothing today).
  const activeRows = await executor
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
    .where(eq(screenhosts.isActive, true));
  const candidates = activeRows.filter(
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

  // LOG1 — observe-only exclusion journaling: re-evaluate the SAME pure predicates on the rows
  // the filter rejected (first failing reason wins; the filter itself is untouched). The
  // inactive-venue set needs one EXTRA read — gated on trace.enabled so the default path keeps
  // its exact query count; only inactive venues that would OTHERWISE match (targeting + zone) are
  // reported, the operator-relevant set.
  if (trace.enabled) {
    const kept = new Set(candidates.map((c) => c.id));
    for (const sh of activeRows) {
      if (kept.has(sh.id)) continue;
      const reason = excluded.has(sh.id)
        ? 'excluded'
        : sh.broadcastCapacity === null
          ? 'capacity_missing'
          : broadcastableHours(sh.openingHour, sh.closingHour).length === 0
            ? 'hours_missing'
            : !screenhostMatchesTargeting(
                  { businessSectorId: sh.businessSectorId, class: sh.class },
                  lines,
                )
              ? 'targeting_mismatch'
              : 'zone_mismatch';
      trace.event('venue_excluded', { reason }, sh.id);
    }
    const inactiveRows = await executor
      .select({
        id: screenhosts.id,
        businessSectorId: screenhosts.businessSectorId,
        class: screenhosts.class,
        zoneId: screenhosts.zoneId,
      })
      .from(screenhosts)
      .where(eq(screenhosts.isActive, false));
    for (const sh of inactiveRows) {
      if (
        screenhostMatchesTargeting(
          { businessSectorId: sh.businessSectorId, class: sh.class },
          lines,
        ) &&
        screenhostMatchesZones(sh.zoneId, campaignZoneIds)
      ) {
        trace.event('venue_excluded', { reason: 'inactive' }, sh.id);
      }
    }
  }

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
  // ⚠️ THIS COLLAPSE IS PERMANENT — do NOT "finish the half-hour migration" by deleting it.
  //
  // You are looking at a GROUP BY on `hour` over a table keyed by `slot`, and it looks like a
  // leftover from slice B. It is not. Ai is defined per CLOCK HOUR: `affByKey` is keyed on it and the
  // broadcastableHours loop walks integer hours from opening to closing.
  // The half-hour grid is the storage; an hour is what THIS consumer means. `round(avg(halves))`
  // is its correct input, and it returns the old value exactly whenever the halves agree.
  // (Slice C removed the collapse from the READ paths that went slot-shaped — period-audience and
  // the /affluence wire. This one, event-pricing's A_max and monthly-audience stay by design.)
  const affluenceRows = candidateIds.length
    ? await executor
        .select({
          screenhostId: screenhostAffluence.screenhostId,
          dayOfWeek: screenhostAffluence.dayOfWeek,
          hour: screenhostAffluence.hour,
          estimatedImpressions: collapseHalvesSql(screenhostAffluence.estimatedImpressions),
        })
        .from(screenhostAffluence)
        .where(inArray(screenhostAffluence.screenhostId, candidateIds))
        .groupBy(
          screenhostAffluence.screenhostId,
          screenhostAffluence.dayOfWeek,
          screenhostAffluence.hour,
        )
    : [];
  const excludedAllocationIds = [
    ...(opts.excludeAllocationId === undefined ? [] : [opts.excludeAllocationId]),
    ...(opts.excludeAllocationIds ?? []),
  ];
  // E2 (VF jours_dispo_i) — the candidates' owner-declared unavailable days inside the window.
  // ONE day source: the per-venue filtered days drive capacity (Hi), avgAffluence AND créneaux
  // (PoolEntry.days is what buildCreneaux consumers iterate), so they can never diverge.
  const windowStart = windowDays[0]?.date ?? campaign.startDate;
  const windowEnd = windowDays[windowDays.length - 1]?.date ?? campaign.endDate;
  const unavailabilityRows = candidateIds.length
    ? await executor
        .select({
          screenhostId: screenhostUnavailability.screenhostId,
          day: screenhostUnavailability.day,
        })
        .from(screenhostUnavailability)
        .where(
          and(
            inArray(screenhostUnavailability.screenhostId, candidateIds),
            gte(screenhostUnavailability.day, windowStart),
            lte(screenhostUnavailability.day, windowEnd),
          ),
        )
    : [];
  const unavailableBySh = new Map<string, Set<string>>();
  for (const u of unavailabilityRows) {
    const set = unavailableBySh.get(u.screenhostId) ?? new Set<string>();
    set.add(u.day);
    unavailableBySh.set(u.screenhostId, set);
  }

  // EV1 — hour_reservations: venue-hours held by SOMETHING ELSE (whatever writes the table —
  // the engine is deliberately blind to what; no event semantics here). A reserved (day, hour)
  // cell drops out of Hi and its affluence out of the venue's total below, shrinking capacity and
  // C_max by exactly that hour's worth. With the table empty this fetch returns nothing and the
  // cell loop is arithmetically identical to pre-EV1 (pinned byte-identical in tests).
  const reservationRows = candidateIds.length
    ? await executor
        .select({
          screenhostId: hourReservations.screenhostId,
          day: hourReservations.day,
          hour: hourReservations.hour,
        })
        .from(hourReservations)
        .where(
          and(
            inArray(hourReservations.screenhostId, candidateIds),
            gte(hourReservations.day, windowStart),
            lte(hourReservations.day, windowEnd),
          ),
        )
    : [];
  const reservedBySh = new Map<string, Set<string>>();
  for (const r of reservationRows) {
    const set = reservedBySh.get(r.screenhostId) ?? new Set<string>();
    set.add(`${r.day}:${r.hour}`);
    reservedBySh.set(r.screenhostId, set);
  }

  // CF-HF4 — the engagement query is WINDOW-OVERLAP-AWARE and terminal-releasing. As found it
  // had NO filter at all: every allocation ever written (any statut incl. REFUSE, any campaign
  // status incl. completed, ANY window) engaged forever — accumulated history collapsed every
  // venue's residual and produced the r_i=1 anti-concentration fingerprint (a September draft
  // priced against July engagements). Now an allocation engages iff:
  //   - its campaign's [start, end] INTERSECTS the priced window (per-WINDOW granularity: a
  //     partial overlap engages its full r_i×S for the whole window — per-day engagement would
  //     need per-day R_eff plumbing through the fill loop, out of this lane's charter; the
  //     per-window read is conservative, never overselling);
  //   - the allocation is not REFUSE (a refusal is terminal — it will never air);
  //   - the campaign is not ended/settled (completed/rejected engage nothing forward — the
  //     belt over the overlap test for early-completed campaigns).
  // EN_ATTENTE within-window still engages (the as-found rule, kept: an undecided allocation
  // may yet air, so its seconds stay held).
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
        .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
        .where(
          and(
            inArray(campaignDispatchAllocation.screenhostId, candidateIds),
            ne(campaignDispatchAllocation.statutAcceptation, 'REFUSE'),
            notInArray(campaigns.status, ['completed', 'rejected']),
            lte(campaigns.startDate, windowEnd),
            gte(campaigns.endDate, windowStart),
            ...(excludedAllocationIds.length === 0
              ? []
              : [notInArray(campaignDispatchAllocation.id, excludedAllocationIds)]),
          ),
        )
    : [];

  // SPS-DISPATCH1 — which candidates have a score that rests on anything. Batched: calling
  // computeSps per candidate would be six queries a venue on the hot path.
  const spsObservations = await spsObservationsFor(candidateIds);

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

  const pool: PoolEntry[] = [];
  for (const sh of candidates) {
    // E2 — jours_dispo_i: this venue's window days MINUS its declared unavailability. Zero
    // available days = ineligible for the whole window → out of the pool (US-2.1); a partial
    // declaration shrinks Hi (and so capacity and C_max) exactly proportionally.
    const declared = unavailableBySh.get(sh.id);
    const days = declared ? windowDays.filter((d) => !declared.has(d.date)) : windowDays;
    if (days.length === 0) {
      trace.event('venue_excluded', { reason: 'no_available_days' }, sh.id);
      continue;
    }
    const venueWeekdays = [...new Set(days.map((d) => d.dayOfWeek))];
    const bHours = broadcastableHours(sh.openingHour, sh.closingHour);
    const slots = venueWeekdays.flatMap((dow) =>
      bHours.map((hour) => ({
        dayOfWeek: dow,
        hour,
        affluence: affByKey.get(`${sh.id}:${dow}:${hour}`) ?? 0,
      })),
    );
    // Hi — broadcastable slots over the AVAILABLE days, minus any reserved (day, hour) cells
    // (EV1 seam — with no reservations this counts exactly days.length × bHours.length as before).
    const reserved = reservedBySh.get(sh.id);
    let hours = 0;
    let totalAffluence = 0;
    for (const day of days) {
      for (const hour of bHours) {
        if (reserved?.has(`${day.date}:${hour}`)) continue;
        hours += 1;
        totalAffluence += affByKey.get(`${sh.id}:${day.dayOfWeek}:${hour}`) ?? 0;
      }
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
    if (residualCapacity <= 0) {
      // No residual broadcast budget (or zero affluence) → skip.
      trace.event(
        'venue_excluded',
        {
          reason: 'no_residual_capacity',
          engagedSeconds: engagedSecondsById.get(sh.id) ?? 0,
          avgAffluence,
        },
        sh.id,
      );
      continue;
    }
    // SPS-DISPATCH1 (ruled 2026-09-01) — an unscored venue does NOT carry its defaults-90 into the
    // ordering. Three of the four SPS variables answer 100 to an empty set, so a never-connected
    // venue scores 90 and outranked venues live for months. It ranks at the NEUTRAL midpoint
    // instead: « we do not know yet » is not a claim in either direction.
    //
    // DISPLAY-ONLY ELSEWHERE, ORDERING-ONLY HERE: `screenhosts.sps` still stores the real 90, the
    // daily job still writes it, C_max and capacité are untouched (they read affluence, never the
    // score), and the owner still sees « À venir » via MEJ-14b. The ONE thing that changes is this
    // number's use as a sort key — and it is the SAME predicate the owner surfaces use, so the two
    // can never disagree about whether a venue is scored.
    const observations = spsObservations.get(sh.id);
    const scored = observations !== undefined && spsComputable(observations);
    pool.push({
      id: sh.id,
      sps: scored ? Number(sh.sps) : SPS_NEUTRAL,
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
      days,
    });
  }

  trace.event('pool_assembled', {
    poolSize: pool.length,
    windowDays: windowDays.length,
    windowStart,
    windowEnd,
  });
  return { windowDays, pool, candidateCount: candidates.length };
};
