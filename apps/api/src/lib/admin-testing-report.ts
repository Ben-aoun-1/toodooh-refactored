import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignRedispatchRounds,
  campaigns,
  screenhostUnavailability,
  screenhosts,
} from '../db/schema.js';

import { campaignsOnVenue, hourStatuses } from './admin-testing-status.js';
import { tunisDateOf } from './campaign-dates.js';
import { getDispatchConfig } from './dispatch/config.js';
import { broadcastableHours } from './dispatch/eligibility.js';
import { computeAmax } from './event-pricing/pricing.js';
import { HALVES_PER_HOUR, tunisSlotOf } from './half-hour-slots.js';
import { estimationFloor, loadPeriodAudienceInput } from './period-audience-source.js';
import { periodAudience, weekGridFromCells } from './period-audience.js';
import { loadDeliveredSlots } from './reconcile/delivered-slots.js';
import {
  ACCEPTATION_WINDOW_DAYS,
  ACTIVITE_WINDOW_DAYS,
  RESPECT_WINDOW_DAYS,
  SPS_NEUTRAL,
  computeSps,
  spsComputable,
} from './sps-score.js';

// ADM-OBS1 — the « Tests » report, extracted VERBATIM from routes/admin-testing.ts (SIM-5,
// 2026-09-16) so the same report can be read on a simulation's VIRTUAL clock. The only change is
// that « now » is a parameter: the product route passes the wall clock, the simulator passes
// virtual_now. Everything the report derives from « now » — today, the current half-hour slot,
// the elapsed hours, the live SPS — follows it.

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

  const [input, floor, sps, aMax, config, unavailable] = await Promise.all([
    loadPeriodAudienceInput({
      venueId: id,
      range: { from, to },
      todayIso,
      nowSlot: tunisSlotOf(now),
    }),
    estimationFloor(id),
    computeSps(id, now),
    computeAmax(id),
    getDispatchConfig(),
    db
      .select({ day: screenhostUnavailability.day })
      .from(screenhostUnavailability)
      .where(
        and(
          eq(screenhostUnavailability.screenhostId, id),
          gte(screenhostUnavailability.day, from),
          lte(screenhostUnavailability.day, to),
        ),
      )
      .orderBy(asc(screenhostUnavailability.day)),
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
  const periodDays: string[] = [];
  for (let d = from; d <= to; ) {
    periodDays.push(d);
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
    if (periodDays.length > 400) break;
  }
  const measuredCells = merged.cells.filter((c) => c.source === 'measured');
  const backupCells = merged.cells.filter((c) => c.source === 'backup');
  const hours = broadcastableHours(venue.openingHour, venue.closingHour);
  const openDays = merged.days.length;
  const openHours = openDays * hours.length;

  return {
    screenhost: {
      id: venue.id,
      name: venue.name,
      opening_hour: venue.openingHour,
      closing_hour: venue.closingHour,
      created_at: venue.createdAt,
      sps_stored: Number(venue.sps),
    },
    periode: { from, to, today: todayIso, estimation_floor: floor },
    audience: {
      total: merged.total,
      measured_days: merged.measuredDays,
      estimated_days: merged.estimatedDays,
      estimated_pct: merged.estimatedPct,
      // The same denominators « Mes performances » uses: days with data, opening hours per day.
      mean_per_day: openDays > 0 ? round2(merged.total / openDays) : null,
      // HOUR-AVG1 — an hour is the average of its two half-hours (the day is their sum).
      mean_per_hour: openHours > 0 ? round2(merged.total / (openHours * HALVES_PER_HOUR)) : null,
      days: stats(merged.days.map((d) => d.audience)),
      cells: stats(merged.cells.map((c) => c.value)),
      measured_cells: stats(measuredCells.map((c) => c.value)),
      backup_cells: stats(backupCells.map((c) => c.value)),
      day_rows: merged.days.map((d) => ({
        date: d.date,
        audience: d.audience,
        source: d.source,
        has_measured: d.hasMeasured,
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
      observations: sps.observations,
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
    status_hours: hourStatuses(
      periodDays,
      broadcastableHours(venue.openingHour, venue.closingHour),
      unavailableSet,
      allocations,
    ),
    campaigns: campaignsOnVenue(
      id,
      allocations,
      from,
      to,
      todayIso,
      currentHour,
      deliveredKeys,
      roundRows,
    ),
    pricing: {
      a_max: aMax,
      cpm_standard_tnd: config.standardCpmTnd,
      cpm_event_tnd: config.eventCpmTnd,
      t: { t10s: config.t10s, t20s: config.t20s, t30s: config.t30s },
      campaign_lead_working_days: config.campaignLeadWorkingDays,
      broadcastable_hours: hours,
      unavailable_days: unavailable.map((u) => u.day),
    },
    config,
  };
};

export type TestingReport = NonNullable<Awaited<ReturnType<typeof buildTestingReport>>>;
