import { and, asc, eq, gte, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignRedispatchRounds,
  campaigns,
  hourReservations,
  screenhostUnavailability,
  screenhosts,
} from '../db/schema.js';

import { campaignsOnVenue, hourStatuses, isElapsed } from './admin-testing-status.js';
import { tunisDateOf } from './campaign-dates.js';
import { getDispatchConfig } from './dispatch/config.js';
import { broadcastableHours } from './dispatch/eligibility.js';
import { computeAmax } from './event-pricing/pricing.js';
import { tunisSlotOf } from './half-hour-slots.js';
import {
  estimationFloor,
  firstMeasuredDay,
  loadPeriodAudienceInput,
} from './period-audience-source.js';
import { periodAudience, periodHours, weekGridFromCells } from './period-audience.js';
import { loadDeliveredSlots } from './reconcile/delivered-slots.js';
import {
  ACCEPTATION_WINDOW_DAYS,
  ACTIVITE_WINDOW_DAYS,
  RESPECT_WINDOW_DAYS,
  spsObservationsInRange,
} from './sps-observations.js';
import { SPS_NEUTRAL, computeSps, spsComputable } from './sps-score.js';
import { SCREEN_SECONDS_PER_HOUR } from './vf-constants.js';

// ADM-OBS1 — the « Tests » report, extracted VERBATIM from routes/admin-testing.ts (SIM-5,
// 2026-09-16) so the same report can be read on a simulation's VIRTUAL clock. The only change is
// that « now » is a parameter: the product route passes the wall clock, the simulator passes
// virtual_now. Everything the report derives from « now » — today, the current half-hour slot,
// the elapsed hours, the live SPS — follows it.
//
// ADM-OBS2 (Mejri 17/09, rulings of 2026-09-18) — the page's second pass:
//  - « Tout l'historique » is a web button; nothing here changes for it.
//  - the période carries the venue's CREATION day and its FIRST SENSOR READING (ruling B) — the
//    estimation floor is only the later of the two, so it stays in the JSON but is no longer shown;
//  - the audience statistics are taken over HOURS (FLOW-4 rule 1, `periodHours`), not over
//    half-hour cells: a half-hour is a reading, the hour is the unit (item 4);
//  - each day row says how many of its half-hours were measured and how many came from the grid,
//    so an « estimated » day shows WHY on the page itself (item 5, « Jours de la période »);
//  - A_max moves into the audience block and the dispatch inputs (CPM, T, lead) leave the page
//    (items 7 and 8) — the full config stays in the raw JSON;
//  - the per-hour status is split into the elapsed hours of the période and the hours still to
//    come on this venue, whatever « Au » says (ruling E); see admin-testing-status for ruling D.
// ADM-OBS2 (Mejri 19/09, R10) — the four SPS evidence counts the page SHOWS follow the période
// (`sps.observations_period`); the score, its variables and `computable` keep the fixed windows.

/** The next ISO calendar day. */
const nextDay = (iso: string): string => {
  const next = new Date(`${iso}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

/** Inclusive ISO day list, capped (a runaway range must not build an unbounded table). */
const MAX_DAYS = 400;
const daysBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < MAX_DAYS; d = nextDay(d)) out.push(d);
  return out;
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

const stats = (values: readonly number[]) =>
  values.length === 0
    ? { n: 0, min: null, max: null, mean: null, median: null }
    : {
        n: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        mean: round2(values.reduce((a, b) => a + b, 0) / values.length),
        median: median(values),
      };

/** The Tests page picker: every screenhost, lightest possible row. */
export const listTestingScreenhosts = async () => {
  const rows = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
      sps: screenhosts.sps,
      createdAt: screenhosts.createdAt,
    })
    .from(screenhosts)
    .orderBy(asc(screenhosts.name));
  return {
    screenhosts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      opening_hour: r.openingHour,
      closing_hour: r.closingHour,
      sps_stored: Number(r.sps),
      created_at: r.createdAt,
      created_date: tunisDateOf(r.createdAt), // where « Tout l'historique » starts
    })),
  };
};

export interface TestingReportInput {
  id: string;
  from: string;
  to: string;
  now: Date;
}

/** The whole report, or null when the screenhost does not exist. */
export const buildTestingReport = async ({ id, from, to, now }: TestingReportInput) => {
  const [venue] = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
      sps: screenhosts.sps,
      createdAt: screenhosts.createdAt,
    })
    .from(screenhosts)
    .where(eq(screenhosts.id, id));
  if (!venue) return null;

  const todayIso = tunisDateOf(now);

  // Unavailable days and event reservations are read from the earlier of « Du » and today with no
  // upper bound: the « À venir » table runs past « Au » (ruling E).
  const readFrom = from < todayIso ? from : todayIso;
  const [input, floor, firstReading, sps, spsPeriod, aMax, config, unavailable, reservations] =
    await Promise.all([
      loadPeriodAudienceInput({
        venueId: id,
        range: { from, to },
        todayIso,
        nowSlot: tunisSlotOf(now),
      }),
      estimationFloor(id),
      firstMeasuredDay(id),
      computeSps(id, now),
      spsObservationsInRange(id, from, to, now),
      computeAmax(id),
      getDispatchConfig(),
      db
        .select({ day: screenhostUnavailability.day })
        .from(screenhostUnavailability)
        .where(
          and(
            eq(screenhostUnavailability.screenhostId, id),
            gte(screenhostUnavailability.day, readFrom),
          ),
        )
        .orderBy(asc(screenhostUnavailability.day)),
      db
        .select({ day: hourReservations.day, hour: hourReservations.hour })
        .from(hourReservations)
        .where(and(eq(hourReservations.screenhostId, id), gte(hourReservations.day, readFrom))),
    ]);

  const merged = periodAudience(input);
  const week = weekGridFromCells(merged.cells);

  // Slice B — the venue's allocations whose créneaux can touch the période, the proofs that
  // delivered them, and the redispatch rounds that moved shares from or to this venue.
  const allocationRows = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignStatus: campaigns.status,
      statutAcceptation: campaignDispatchAllocation.statutAcceptation,
      rI: campaignDispatchAllocation.rI,
      creneaux: campaignDispatchAllocation.creneaux,
      sSpotSeconds: campaignDispatchPlan.sSpotSeconds,
      fMaxSeconds: campaignDispatchPlan.fMaxSeconds,
      cpm: campaignDispatchPlan.cpm,
      t: campaignDispatchPlan.tTierCoef,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .where(eq(campaignDispatchAllocation.screenhostId, id));
  const allocations = allocationRows.map((r) => ({
    ...r,
    cpm: Number(r.cpm),
    t: Number(r.t),
  }));
  const campaignIds = [...new Set(allocations.map((a) => a.campaignId))];
  const deliveredKeys = new Map<string, ReadonlySet<string>>();
  for (const campaignId of campaignIds) {
    const bySh = await loadDeliveredSlots(campaignId);
    deliveredKeys.set(campaignId, bySh.get(id) ?? new Set<string>());
  }
  const roundRows = campaignIds.length
    ? await db
        .select({
          campaignId: campaignRedispatchRounds.campaignId,
          missedFrom: campaignRedispatchRounds.missedFrom,
          placedTo: campaignRedispatchRounds.placedTo,
        })
        .from(campaignRedispatchRounds)
        .where(inArray(campaignRedispatchRounds.campaignId, campaignIds))
    : [];
  const currentHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Tunis',
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
  const unavailableSet = new Set(unavailable.map((u) => u.day));
  const reservedSet = new Set(reservations.map((r) => `${r.day}:${r.hour}`));
  const hours = broadcastableHours(venue.openingHour, venue.closingHour);
  const openDays = merged.days.length;
  const openHours = openDays * hours.length;

  // Ruling E — « Historique » = the elapsed hours of the période; « À venir » = from the current
  // hour to the last day anything is planned on this venue (a créneau or an event reservation).
  const pastDays = daysBetween(from, to < todayIso ? to : todayIso);
  let lastPlanned = todayIso;
  for (const a of allocations) {
    for (const c of a.creneaux) if (c.date > lastPlanned) lastPlanned = c.date;
  }
  for (const r of reservations) if (r.day > lastPlanned) lastPlanned = r.day;
  const futureDays = daysBetween(todayIso, lastPlanned);
  const statusOf = (days: readonly string[]) =>
    // CAP-F1 — an hour is « plein » when the SCREEN hour is (3600 s); F caps each campaign only.
    hourStatuses(days, hours, unavailableSet, reservedSet, allocations, SCREEN_SECONDS_PER_HOUR);

  // Item 4 — the hour values FLOW-4 sums into the day; item 5 — each day's cells by source.
  const hourValues = periodHours(merged.cells);
  const cellsByDate = new Map<string, { measured: number; backup: number }>();
  for (const c of merged.cells) {
    const n = cellsByDate.get(c.date) ?? { measured: 0, backup: 0 };
    if (c.source === 'measured') n.measured += 1;
    else n.backup += 1;
    cellsByDate.set(c.date, n);
  }

  return {
    screenhost: {
      id: venue.id,
      name: venue.name,
      opening_hour: venue.openingHour,
      closing_hour: venue.closingHour,
      created_at: venue.createdAt,
      sps_stored: Number(venue.sps),
      broadcastable_hours: hours,
    },
    periode: {
      from,
      to,
      today: todayIso,
      created_date: tunisDateOf(venue.createdAt),
      first_reading: firstReading,
      estimation_floor: floor,
      unavailable_days: unavailable.map((u) => u.day).filter((d) => d >= from && d <= to),
    },
    audience: {
      // Item 8 — A_max sits with the audience KPIs: it IS an audience figure (the busiest hour).
      a_max: aMax,
      total: merged.total,
      measured_days: merged.measuredDays,
      estimated_days: merged.estimatedDays,
      estimated_pct: merged.estimatedPct,
      // The same denominators « Mes performances » uses: days with data, opening hours per day.
      mean_per_day: openDays > 0 ? round2(merged.total / openDays) : null,
      // FLOW-4 — the day is Σ of its HOUR values, so « / heure » divides by the opening HOURS.
      mean_per_hour: openHours > 0 ? round2(merged.total / openHours) : null,
      days: stats(merged.days.map((d) => d.audience)),
      hours: stats(hourValues.map((h) => h.value)),
      measured_hours: stats(hourValues.filter((h) => h.backupCells === 0).map((h) => h.value)),
      estimated_hours: stats(hourValues.filter((h) => h.backupCells > 0).map((h) => h.value)),
      day_rows: merged.days.map((d) => ({
        date: d.date,
        audience: d.audience,
        source: d.source,
        has_measured: d.hasMeasured,
        // Day-granularity history (monthly_stats) has no cells: both counts stay 0.
        measured_cells: cellsByDate.get(d.date)?.measured ?? 0,
        backup_cells: cellsByDate.get(d.date)?.backup ?? 0,
      })),
      cell_rows: merged.cells.map((c) => ({
        date: c.date,
        slot: c.slot,
        value: c.value,
        source: c.source,
      })),
      // PEAK-MAX1 grid, weekday (Mon=0) × slot (0–47): the S02 « Vos peak hours » cell.
      week,
    },
    sps: {
      live: sps.sps,
      stored: Number(venue.sps),
      computable: spsComputable(sps.observations),
      neutral: SPS_NEUTRAL,
      variables: sps.variables,
      // `observations` (trailing windows) drives `computable`; the page shows the période's (R10).
      observations: sps.observations,
      observations_period: spsPeriod,
      weights: {
        acceptation: config.spsWeightAcceptation,
        respect_evenements: config.spsWeightRespectEvenements,
        activite: config.spsWeightActivite,
        remplissage: config.spsWeightRemplissage,
      },
      windows_days: {
        acceptation: ACCEPTATION_WINDOW_DAYS,
        activite: ACTIVITE_WINDOW_DAYS,
        respect_evenements: RESPECT_WINDOW_DAYS,
      },
    },
    // Slice B — status per open hour and the campaigns on this venue over the période.
    status_hours: {
      past: statusOf(pastDays).filter((h) => isElapsed(h.date, h.hour, todayIso, currentHour)),
      future: statusOf(futureDays).filter((h) => !isElapsed(h.date, h.hour, todayIso, currentHour)),
    },
    campaigns: campaignsOnVenue(
      id,
      allocations,
      from,
      to,
      todayIso,
      currentHour,
      deliveredKeys,
      roundRows,
      {
        sh: config.pctSh,
        toodooh: config.pctToodooh,
        agentSh: config.pctAgentSh,
        agentSc: config.pctAgentSc,
      },
    ),
    config,
  };
};

export type TestingReport = NonNullable<Awaited<ReturnType<typeof buildTestingReport>>>;
