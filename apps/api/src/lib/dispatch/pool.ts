import { and, eq, gte, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';

import { type DrizzleDb } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaignTypicalWeek,
  campaignZones,
  campaigns,
  hourReservations,
  screenhostAffluence,
  screenhostUnavailability,
  screenhosts,
} from '../../db/schema.js';
import { ownerApprovedSql } from '../approved-owner.js';
import { NOOP_TRACE, type EngineTrace } from '../engine-journal/trace.js';
import { collapseHalvesSql, inEffectSql } from '../half-hour-slots.js';
import { venueHasInstalledScreenSql } from '../installed-screen.js';
import { addIsoDays, openingHours, shiftDayOfWeek } from '../opening-hours.js';
import { spsObservationsFor } from '../sps-observations.js';
import { SPS_NEUTRAL, spsComputable } from '../sps-score.js';
import { frozenVenueIds, hasTypicalWeekFreeze } from '../typical-week-freeze.js';
import { SCREEN_SECONDS_PER_HOUR } from '../vf-constants.js';

import {
  capaciteUtile,
  computeR,
  facturableFromPhysical,
  screenhostMatchesTargeting,
  screenhostMatchesZones,
} from './eligibility.js';
import { poolExclusionReason } from './exclusion-reason.js';
import { type PoolEntry, type WindowDay } from './plan.js';
import { availableWindowDays, buildWindowDays } from './window.js';

// E3 — the ONE pool-assembly authority. Extracted VERBATIM from runDispatch (dispatch-service.ts)
// so dispatch, the refusal cascade (US-2.8) and later redispatch (E6) assemble the eligible pool +
// occupancy netting through the SAME code path: hard filters (active + ./exclusion-reason.ts),
// affluence (Ai), engaged broadcast SECONDS from OTHER allocations → residual F-budget → R_eff →
// facturable capacity. The exclusions are the only additions:
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
  fMaxSeconds: number; // F — this campaign's hourly broadcast cap on a screen (CAP-F1: per campaign)
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

/**
 * E2 — the owner-declared unavailable days of `screenhostIds` inside [windowStart, windowEnd]
 * (inclusive, Tunis calendar dates), keyed by venue. The pool's ONE read of the declarations,
 * shared with the coverage map (MAP-4) so both see the same days.
 */
export const loadUnavailableDays = async (
  executor: DbExecutor,
  screenhostIds: string[],
  windowStart: string,
  windowEnd: string,
): Promise<Map<string, Set<string>>> => {
  const rows = screenhostIds.length
    ? await executor
        .select({
          screenhostId: screenhostUnavailability.screenhostId,
          day: screenhostUnavailability.day,
        })
        .from(screenhostUnavailability)
        .where(
          and(
            inArray(screenhostUnavailability.screenhostId, screenhostIds),
            gte(screenhostUnavailability.day, windowStart),
            lte(screenhostUnavailability.day, windowEnd),
          ),
        )
    : [];
  const bySh = new Map<string, Set<string>>();
  for (const u of rows) {
    const set = bySh.get(u.screenhostId) ?? new Set<string>();
    set.add(u.day);
    bySh.set(u.screenhostId, set);
  }
  return bySh;
};

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

  // Hard filters on the active venues: ONE ordered list (./exclusion-reason.ts) decides both
  // membership and the journaled reason, so the two never disagree. ELIG-2 / MAP-TV1 — the owner
  // and installed-screen gates are SELECTED rather than filtered in SQL so the journal can name them.
  const activeRows = await executor
    .select({
      id: screenhosts.id,
      ownerApproved: ownerApprovedSql(),
      installedScreen: venueHasInstalledScreenSql(),
      sps: screenhosts.sps,
      businessSectorId: screenhosts.businessSectorId,
      class: screenhosts.class,
      zoneId: screenhosts.zoneId,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
    })
    .from(screenhosts)
    .where(eq(screenhosts.isActive, true));
  // TW-SNAP — a campaign frozen at cart add prices and places on THAT week: its venues bound the
  // candidates (Q2 B) and its cells replace the live grid below. No freeze = the live week.
  const frozenVenues = (await hasTypicalWeekFreeze(executor, campaign.id))
    ? await frozenVenueIds(executor, campaign.id)
    : null;
  const filterContext = { lines, zoneIds: campaignZoneIds, excluded, frozenVenues };
  const verdicts = activeRows.map((sh) => ({ sh, reason: poolExclusionReason(sh, filterContext) }));
  const candidates = verdicts.flatMap(({ sh, reason }) => (reason === null ? [sh] : []));

  // LOG1 — observe-only exclusion journaling: every rejected active venue under its FIRST failing
  // reason. The inactive-venue set needs one EXTRA read — gated on trace.enabled so the default
  // path keeps its exact query count; only inactive venues that would OTHERWISE match (targeting +
  // zone) are reported, the operator-relevant set.
  if (trace.enabled) {
    for (const { sh, reason } of verdicts) {
      if (reason !== null) trace.event('venue_excluded', { reason }, sh.id);
    }
    const inactiveRows = await executor
      .select({
        id: screenhosts.id,
        ownerApproved: ownerApprovedSql(),
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
        trace.event(
          'venue_excluded',
          { reason: sh.ownerApproved ? 'inactive' : 'owner_not_approved' },
          sh.id,
        );
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
  const affluenceRows = !candidateIds.length
    ? []
    : frozenVenues
      ? // TW-SNAP — the frozen copy, read through the SAME in-effect filter and collapse.
        await executor
          .select({
            screenhostId: campaignTypicalWeek.screenhostId,
            dayOfWeek: campaignTypicalWeek.dayOfWeek,
            hour: campaignTypicalWeek.hour,
            estimatedImpressions: collapseHalvesSql(campaignTypicalWeek.estimatedImpressions),
          })
          .from(campaignTypicalWeek)
          .where(
            and(
              eq(campaignTypicalWeek.campaignId, campaign.id),
              inArray(campaignTypicalWeek.screenhostId, candidateIds),
              inEffectSql(campaignTypicalWeek.inEffect),
            ),
          )
          .groupBy(
            campaignTypicalWeek.screenhostId,
            campaignTypicalWeek.dayOfWeek,
            campaignTypicalWeek.hour,
          )
      : await executor
          .select({
            screenhostId: screenhostAffluence.screenhostId,
            dayOfWeek: screenhostAffluence.dayOfWeek,
            hour: screenhostAffluence.hour,
            estimatedImpressions: collapseHalvesSql(screenhostAffluence.estimatedImpressions),
          })
          .from(screenhostAffluence)
          // OFF-1 — a suspended manual cell is ABSENT for Ai. Filtered HERE, before the collapse.
          .where(
            and(
              inArray(screenhostAffluence.screenhostId, candidateIds),
              inEffectSql(screenhostAffluence.inEffect),
            ),
          )
          .groupBy(
            screenhostAffluence.screenhostId,
            screenhostAffluence.dayOfWeek,
            screenhostAffluence.hour,
          );
  const excludedAllocationIds = [
    ...(opts.excludeAllocationId === undefined ? [] : [opts.excludeAllocationId]),
    ...(opts.excludeAllocationIds ?? []),
  ];
  // E2 (VF jours_dispo_i) — the candidates' owner-declared unavailable days inside the window.
  // ONE day source: the per-venue filtered days drive capacity (Hi), avgAffluence AND créneaux
  // (PoolEntry.days is what buildCreneaux consumers iterate), so they can never diverge.
  const windowStart = windowDays[0]?.date ?? campaign.startDate;
  const windowEnd = windowDays[windowDays.length - 1]?.date ?? campaign.endDate;
  const unavailableBySh = await loadUnavailableDays(executor, candidateIds, windowStart, windowEnd);

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
          campaignId: campaignDispatchPlan.campaignId,
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
  // impressions: a 30s spot and a 10s spot cost the screen hour differently — impression
  // accounting can't see that. CAP-F1: they are read against the SCREEN's physical hour (3600 s),
  // not against F — F is each campaign's own cap.
  const engagedSecondsById = new Map<string, number>();
  // CAP-F1 — THIS campaign's own engaged seconds per screen (non-zero at cascade / boost time):
  // they count against its OWN F as well as the screen hour.
  const ownSecondsById = new Map<string, number>();
  for (const e of engagementRows) {
    const seconds = e.rI * e.spotSeconds;
    engagedSecondsById.set(e.screenhostId, (engagedSecondsById.get(e.screenhostId) ?? 0) + seconds);
    if (e.campaignId === campaign.id)
      ownSecondsById.set(e.screenhostId, (ownSecondsById.get(e.screenhostId) ?? 0) + seconds);
  }

  const pool: PoolEntry[] = [];
  for (const sh of candidates) {
    // E2 — jours_dispo_i: this venue's window days MINUS its declared unavailability. Zero
    // available days = ineligible for the whole window → out of the pool (US-2.1); a partial
    // declaration shrinks Hi (and so capacity and C_max) exactly proportionally.
    const days = availableWindowDays(windowDays, unavailableBySh.get(sh.id));
    if (days.length === 0) {
      trace.event('venue_excluded', { reason: 'no_available_days' }, sh.id);
      continue;
    }
    const venueWeekdays = [...new Set(days.map((d) => d.dayOfWeek))];
    // HOURS-X1 — an overnight window's post-midnight hours belong to the NEXT weekday / calendar
    // day: their affluence cell and their reservation cell are read there (a proof at 00:30 on
    // Tuesday is Tuesday's cell, even though it is Monday's opening day).
    const oHours = openingHours(sh.openingHour, sh.closingHour);
    const slots = venueWeekdays.flatMap((dow) =>
      oHours.map(({ hour, dayOffset }) => ({
        dayOfWeek: dow,
        hour,
        dayOffset,
        affluence: affByKey.get(`${sh.id}:${shiftDayOfWeek(dow, dayOffset)}:${hour}`) ?? 0,
      })),
    );
    // Hi — broadcastable slots over the AVAILABLE days, minus any reserved (day, hour) cells
    // (EV1 seam — with no reservations this counts exactly days.length × oHours.length as before).
    const reserved = reservedBySh.get(sh.id);
    let hours = 0;
    let totalAffluence = 0;
    for (const day of days) {
      for (const { hour, dayOffset } of oHours) {
        const cellDate = dayOffset ? addIsoDays(day.date, dayOffset) : day.date;
        if (reserved?.has(`${cellDate}:${hour}`)) continue;
        hours += 1;
        totalAffluence +=
          affByKey.get(`${sh.id}:${shiftDayOfWeek(day.dayOfWeek, dayOffset)}:${hour}`) ?? 0;
      }
    }
    const avgAffluence = hours > 0 ? totalAffluence / hours : 0;
    // Floor to whole impressions: capaciteUtile round-trips through FP (avgAffluence = total/hours
    // → ×hours), so non-uniform affluence yields e.g. 60030.0000000007. Flooring at the source keeps
    // residual/ai/couvert/ii_potentiel integers (the persisted columns are `integer`).
    // CAP-F1 (operator ruling 2026-09-24) — F is a PER-CAMPAIGN cap (pricing-model-v3: « caps spot
    // repetition rate per hour »): this campaign may use up to F seconds of the screen hour. The only
    // SHARED limit is the physical hour, 3600 s. So residual = min(F − own, 3600 − own − others):
    // at cascade / boost time this campaign's own allocations use up its own F first. Before, the 300 s was the screen's shared budget: one
    // campaign at 280 s left every other campaign one rep/hour (the prod « — » of 24/09).
    // engaged = every campaign's seconds on the screen, this one's included (own).
    const ownSeconds = ownSecondsById.get(sh.id) ?? 0;
    const screenFreeSeconds = Math.max(
      0,
      SCREEN_SECONDS_PER_HOUR - (engagedSecondsById.get(sh.id) ?? 0),
    );
    const residualSeconds = Math.min(
      Math.max(0, inputs.fMaxSeconds - ownSeconds),
      screenFreeSeconds,
    );
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
