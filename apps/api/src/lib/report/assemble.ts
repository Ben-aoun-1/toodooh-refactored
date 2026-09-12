import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { and, desc, eq, gte, lte, count as sqlCount, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  businessSectors,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  events,
  proofOfPlay,
  screenhostMonthlyStats,
  screenhosts,
} from '../../db/schema.js';
import { getDispatchConfig } from '../dispatch/config.js';
import { SLOTS_PER_DAY, hourOfSlot } from '../half-hour-slots.js';
import { displayImpressionsSettled } from '../impressions-display.js';
import { isOpenAt } from '../opening-hours.js';
import { loadBackupGrid, loadPeriodAudienceInput } from '../period-audience-source.js';
import { periodAudience, weekGridFromCells } from '../period-audience.js';
import { computeSps, spsComputable } from '../sps-score.js';

import {
  type AffluenceSource,
  type ProvenanceKind,
  affluenceEmpty,
  provenanceGrid,
} from './affluence-provenance.js';
import {
  type AudienceKpis,
  type CampaignStatut,
  type DailyImpressionsPoint,
  type DateRange,
  type DemographicBreakdown,
  type ReportEarningsLine,
  type VenueRatios,
  audienceKpis,
  campaignStatut,
  campaignTypeLabel,
  categoryLabel,
  demographicBreakdown,
  formatCompactPeriod,
  formatDateFr,
  formatIntFr,
  formatTablePeriod,
  formatTndCellFr,
  formatTndFr,
  hasCastData,
  hasHostData,
  lineInPeriod,
  heatmapLevel,
  heatmapScale,
  openHoursPerDay,
  zeroFillDays,
} from './derive.js';
import type { SpsBlock, UpcomingEvents } from './pistes.js';

// One data truth: this module runs the SAME queries the owner reads use (screenhosts.ts —
// profile / monthly-stats / affluence / impressions-daily / earnings) and derives the template's
// inputs with the api-side mirror of the web derivations. Owner-scoping is the CALLER's job
// (the route resolves ownership; the month-end job iterates its own venue list).

/** The mockups' visible hour columns — 8h through 21h (mirror of the page heatmap). */
export const HEATMAP_HOURS = Array.from({ length: 14 }, (_, i) => i + 8);

/**
 * Slice C — the same window in SLOTS: 8h00 … 21h30, two columns per hour, 28 in all. The PDF
 * follows the DESKTOP rendering (a document has no width constraint to collapse for), so it draws
 * both halves and never collapses an hour; each column is one half-hour slot's peak (PEAK-MAX1).
 */
export const HEATMAP_SLOTS = HEATMAP_HOURS.flatMap((hour) => [hour * 2, hour * 2 + 1]);

/**
 * PERF-QA2 — the Piste 01 teaser window: events kicking off within this many days of the render
 * day (Tunis calendar, inclusive of today). RULED 14 days on 2026-08-20: long enough that a venue
 * with one match a fortnight still sees a teaser, short enough that « cette semaine / ces
 * prochains jours » stays true. The number never reaches the copy — only the words do.
 */
export const EVENT_TEASER_DAYS = 14;

export interface ReportRevenueRow {
  name: string;
  period: string;
  amountLabel: string;
}

export interface ReportCampaignRow {
  name: string;
  period: string;
  typeLabel: string;
  statut: CampaignStatut;
  impressionsLabel: string;
  revenueLabel: string;
}

export interface ReportData {
  venueName: string;
  category: string;
  range: DateRange;
  /**
   * RPT-COV1 — days of the analysed period that CARRY DATA (the merge's own days). The
   * denominator is derived from `range` by both surfaces, so there is one rule for each half.
   */
  coverageDays: number;
  /** DD/MM/YYYY of the render day — the masthead's "Généré le". */
  generatedLabel: string;
  hostHasData: boolean;
  castHasData: boolean;
  kpis: AudienceKpis;
  /** 7×14 levels for the 8h–21h grid; 0 = hachure (closed hour OR no data). */
  heatLevels: number[][];
  /** AFF1 — 7×14 provenance per cell (measured / backup = estimation / none); closed hours read
   * as none. The template layers the estimation treatment over the level from this. */
  heatKinds: ProvenanceKind[][];
  /** MEJ-12 — the merged values behind the levels, for ranking créneaux by size. */
  heatValues: number[][];
  /** AFF1 — the explanatory empty state: no measured, no backup AND no data (the page's rule). */
  heatEmpty: boolean;
  /** Zero-filled period days once castHasData; [] before the first CAST data. */
  days: DailyImpressionsPoint[];
  breakdown: DemographicBreakdown | null;
  revenue: { totalLabel: string; count: number; rows: ReportRevenueRow[] };
  campaignsBlock: {
    count: number;
    cumulativeImpressions: number;
    top3: string[];
    rows: ReportCampaignRow[];
  };
  /** E4 — the venue's SPS breakdown (computed live at assembly; null only on a compute failure). */
  sps: SpsBlock | null;
  /**
   * PERF-QA2 — the S07 Piste 01 teaser input: OFFICIAL, non-cancelled events whose kickoff falls
   * in the EVENT_TEASER_DAYS window after the render day. null = nothing upcoming (the honest
   * no-events variant). Suggested and past events never reach here.
   */
  upcomingEvents: UpcomingEvents | null;
}

const numOrNull = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// HOURS-X1 — the window may wrap past midnight. No hours set → nothing is closed (legacy rows).
const closedAt =
  (openingHour: number | null, closingHour: number | null) =>
  (hour: number): boolean => {
    if (openingHour === null || closingHour === null) return false;
    return !isOpenAt(hour, openingHour, closingHour);
  };

/**
 * AFF1 — 7×28 hachure/ramp levels (14 hours × 2 halves) over the MERGED typical-week grid, exactly like the page:
 * level 0 is a closed hour OR a cell with no data (kind none); 1–5 ramp linearly over the grid's
 * own min/max across open cells that carry data — measured AND estimated share ONE scale, the
 * provenance rides separately (heatmapKinds) as the estimation treatment.
 */
export function heatmapLevels(
  grid: number[][],
  sources: (AffluenceSource | null)[][],
  openingHour: number | null,
  closingHour: number | null,
): number[][] {
  const closed = closedAt(openingHour, closingHour);
  const kinds = provenanceGrid(grid, sources);
  const valueAt = (day: number, slot: number): number | null =>
    kinds[day]?.[slot] === 'none' ? null : (grid[day]?.[slot] ?? null);
  const visible: (number | null)[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (const slot of HEATMAP_SLOTS) {
      if (!closed(hourOfSlot(slot))) visible.push(valueAt(day, slot));
    }
  }
  const scale = heatmapScale(visible);
  return Array.from({ length: 7 }, (_, day) =>
    HEATMAP_SLOTS.map((slot) =>
      closed(hourOfSlot(slot)) ? 0 : heatmapLevel(valueAt(day, slot), scale),
    ),
  );
}

/** AFF1 — the 7×28 provenance beside heatmapLevels (closed hours read as none). */
export function heatmapKinds(
  grid: number[][],
  sources: (AffluenceSource | null)[][],
  openingHour: number | null,
  closingHour: number | null,
): ProvenanceKind[][] {
  const closed = closedAt(openingHour, closingHour);
  const kinds = provenanceGrid(grid, sources);
  return Array.from({ length: 7 }, (_, day) =>
    HEATMAP_SLOTS.map((slot) =>
      closed(hourOfSlot(slot)) ? 'none' : (kinds[day]?.[slot] ?? 'none'),
    ),
  );
}

/**
 * MEJ-12 — the 7×28 merged VALUES beside heatmapLevels, on the same hour window. The levels are a
 * coarse 1–5 bucket, so several cells share the top one; ranking créneaux needs the real numbers
 * to name the busiest slot rather than the earliest one that reached the bucket.
 */
export function heatmapValues(
  grid: number[][],
  sources: (AffluenceSource | null)[][],
  openingHour: number | null,
  closingHour: number | null,
): number[][] {
  const closed = closedAt(openingHour, closingHour);
  const kinds = provenanceGrid(grid, sources);
  return Array.from({ length: 7 }, (_, day) =>
    HEATMAP_SLOTS.map((slot) =>
      closed(hourOfSlot(slot)) || kinds[day]?.[slot] === 'none' ? 0 : (grid[day]?.[slot] ?? 0),
    ),
  );
}

/**
 * Every ratio column or null — a partial row never leaks (the C3 all-or-null contract).
 *
 * CLS-AGE1 — the gate is over the THREE bands. It used to require the two retired columns too, so
 * a class the hub pushed in the new three-bucket shape (46–60 and 60+ both NULL) would have failed
 * it and rendered S04 « en attente » FOREVER, on the page and the PDF, with no error — looking
 * exactly like a class the hub had never pushed. The columns are retained but must not be required.
 */
function ratiosOrNull(venue: {
  genderMalePct: string | null;
  genderFemalePct: string | null;
  age17To30Pct: string | null;
  age31To45Pct: string | null;
  age46PlusPct: string | null;
}): VenueRatios | null {
  const male = numOrNull(venue.genderMalePct);
  const female = numOrNull(venue.genderFemalePct);
  const a17 = numOrNull(venue.age17To30Pct);
  const a31 = numOrNull(venue.age31To45Pct);
  const a46 = numOrNull(venue.age46PlusPct);
  if (male === null || female === null || a17 === null || a31 === null || a46 === null) {
    return null;
  }
  return {
    gender_male_pct: male,
    gender_female_pct: female,
    age_17_30_pct: a17,
    age_31_45_pct: a31,
    age_46_plus_pct: a46,
  };
}

/**
 * Assemble everything the template needs for one venue over one inclusive [from, to] range.
 * Returns null when the venue does not exist. `todayIso` parameterizes the S06 statut + masthead
 * (testability); defaults to the render day.
 */
export async function assembleReportData(
  venueId: string,
  range: DateRange,
  todayIso: string = format(new Date(), 'yyyy-MM-dd'),
): Promise<ReportData | null> {
  // 1) profile (identity card + ratios) — mirror of GET /:id/profile.
  const [venue] = await db
    .select({
      name: screenhosts.name,
      sectorName: businessSectors.name,
      class: screenhosts.class,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
      // MEJ-R1 — the venue's onboarding day; the backup grid may not answer for earlier days.
      createdAt: screenhosts.createdAt,
      genderMalePct: screenhosts.genderMalePct,
      genderFemalePct: screenhosts.genderFemalePct,
      age17To30Pct: screenhosts.age17To30Pct,
      age31To45Pct: screenhosts.age31To45Pct,
      age46PlusPct: screenhosts.age46PlusPct,
    })
    .from(screenhosts)
    .leftJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    .where(eq(screenhosts.id, venueId))
    .limit(1);
  if (!venue) return null;

  // 2) monthly stats (month desc) — PERF-R1 (operator 2026-08-30, supersedes US-P.5): the
  // stored rows are read WHOLE; lib/period-audience.ts merges per day (PAX measure first, the
  // affluence grid otherwise) so S01 mirrors the page's /audience read — same helper, same
  // numbers, never a zero because the sensor was silent.
  const monthRows = await db
    .select({
      month: screenhostMonthlyStats.month,
      totalAudience: screenhostMonthlyStats.totalAudience,
      daily: screenhostMonthlyStats.daily,
    })
    .from(screenhostMonthlyStats)
    .where(eq(screenhostMonthlyStats.screenhostId, venueId))
    .orderBy(desc(screenhostMonthlyStats.month));
  const months = monthRows;

  // 3) the venue's BACKUP grid. It no longer feeds S02 directly (see below) — it is the
  //    stand-in source the merge reads, and the HOST first-data flag's second half.
  const backupGrid = await loadBackupGrid(venueId);
  const grid = backupGrid.values;

  // 4) delivered impressions per Tunis-local day in range — mirror of GET /:id/impressions-daily.
  const tunisDay = sql<string>`to_char(${proofOfPlay.receivedAt} at time zone 'Africa/Tunis', 'YYYY-MM-DD')`;
  const dayRows = await db
    .select({ date: tunisDay, impressions: sqlCount() })
    .from(proofOfPlay)
    .where(
      and(
        eq(proofOfPlay.screenhostId, venueId),
        eq(proofOfPlay.eventType, 'VIDEO_ENDED'),
        gte(tunisDay, range.from),
        lte(tunisDay, range.to),
      ),
    )
    .groupBy(tunisDay)
    .orderBy(tunisDay);
  const rangeDays: DailyImpressionsPoint[] = dayRows.map((r) => ({
    date: r.date,
    impressions: r.impressions,
  }));

  // 5) earnings lines for THIS venue — mirror of GET /screenhosts/earnings, venue-scoped.
  const lineRows = await db
    .select({
      campaignName: campaigns.name,
      expectedImp: campaignScreenhostPayout.expectedImp,
      deliveredImp: campaignScreenhostPayout.deliveredImp,
      earningsTnd: campaignScreenhostPayout.earningsTnd, // numeric → string
      reconciledAt: campaignReconciliation.reconciledAt,
      campaignStart: campaigns.startDate,
      campaignEnd: campaigns.endDate,
      campaignType: campaigns.campaignType,
      campaignStatus: campaigns.status,
    })
    .from(campaignScreenhostPayout)
    .innerJoin(campaigns, eq(campaigns.id, campaignScreenhostPayout.campaignId))
    .innerJoin(
      campaignReconciliation,
      eq(campaignReconciliation.id, campaignScreenhostPayout.reconciliationId),
    )
    .where(eq(campaignScreenhostPayout.screenhostId, venueId))
    .orderBy(desc(campaignReconciliation.reconciledAt));
  const lines: ReportEarningsLine[] = lineRows.map((r) => ({
    campaign_name: r.campaignName,
    delivered_imp: r.deliveredImp,
    // NET-IMP1 — the document's « Impressions générées » figures route through the ONE display
    // home (settled rows converge to delivered by reconcile's identity).
    display_imp: displayImpressionsSettled({
      expectedImp: r.expectedImp,
      deliveredImp: r.deliveredImp,
    }),
    earnings_tnd: Number(r.earningsTnd),
    reconciled_at:
      r.reconciledAt instanceof Date ? r.reconciledAt.toISOString() : String(r.reconciledAt),
    campaign_start: r.campaignStart,
    campaign_end: r.campaignEnd,
    campaign_type: r.campaignType,
    campaign_status: r.campaignStatus,
  }));

  // ── derivations (the page's semantics, api-side mirror) ─────────────────────────────────────
  const hostFlag = hasHostData(months, grid);
  const castFlag = hasCastData(lines, rangeDays);

  // AUD-HOURLY1-C — S01 AND S02 both come out of THE merge (lib/period-audience.ts), the same
  // helper the page's /audience and /affluence reads serve: per (date, hour), PAX first, the
  // admin's grid as backup, the MEJ-2 floor bounding backup only. S02 is the période's own cells
  // folded into weekday × hour — no longer the hub's rolling typical week with a weekday mask.
  const merged = periodAudience(
    await loadPeriodAudienceInput({
      venueId,
      range,
      todayIso,
      // MEJ-7b — the floor is NOT passed any more: the loader derives it, once, for every surface.
      // This line used to read `tunisDateOf(venue.createdAt)`, one of THREE independent copies,
      // which is how a venue created before its sensor kept getting backup for days that had no
      // sensor. A caller that cannot state the floor cannot disagree about it.
    }),
  );
  const kpis = audienceKpis(
    merged.days,
    openHoursPerDay(venue.openingHour, venue.closingHour),
    merged.estimatedPct, // the VALUE-WEIGHTED share (slice C), the same number the page's wire carries
  );

  const week = weekGridFromCells(merged.cells);
  const heatGrid: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: SLOTS_PER_DAY }, () => 0),
  );
  const heatSources: (AffluenceSource | null)[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: SLOTS_PER_DAY }, () => null),
  );
  const heatCounts = { measured: 0, backup: 0 };
  let heatFilled = 0;
  for (let row = 0; row < 7; row += 1) {
    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
      const cell = week[row]![slot]!;
      if (cell.value === null || cell.source === null) continue;
      heatGrid[row]![slot] = cell.value;
      heatSources[row]![slot] = cell.source;
      heatCounts[cell.source] += 1;
      heatFilled += 1;
    }
  }
  const heatHasData = heatFilled > 0;

  const ratios = ratiosOrNull(venue);
  const periodLines = lines.filter((l) => lineInPeriod(l, range));
  const top3 = [...periodLines]
    .sort((a, b) => b.display_imp - a.display_imp)
    .slice(0, 3)
    .map((l) => l.campaign_name);

  // E4 — the S08 card's live breakdown: the four ruled variables with the CONFIG weights.
  // A compute hiccup degrades to null (the card keeps its wait-state) — a report render must
  // never fail on the score.
  let spsBlock: ReportData['sps'] = null;
  try {
    const cfg = await getDispatchConfig();
    const { sps, variables, observations } = await computeSps(venueId);
    // MEJ-14b — the PDF's S08 and Piste 03 follow the SAME predicate as the page: a score made
    // entirely of empty-set defaults (90/100 for a never-connected venue) is not shown at all.
    // Leaving spsBlock null is what both already do for a compute hiccup — S08 renders « À venir »
    // and piste03 falls to its wait body, so a hidden score on the page can never be paired with
    // « votre score est de 90/100 » in the piste text.
    //
    // PERF-QA2 — each criterion carries its KEY: Piste 03 names the weakest weighted variable and
    // proposes the lever that moves THAT variable, and a lever must never be matched on a label
    // string (a reworded label would silently swap the advice).
    spsBlock = !spsComputable(observations)
      ? null
      : {
          score: sps,
          criteria: [
            {
              key: 'acceptation',
              label: "Taux d'acceptation des campagnes",
              weight: cfg.spsWeightAcceptation,
              value: variables.acceptation,
            },
            {
              key: 'respect_evenements',
              label: 'Respect des événements acceptés',
              weight: cfg.spsWeightRespectEvenements,
              value: variables.respect_evenements,
            },
            {
              key: 'activite',
              label: "Activité de l'écran",
              weight: cfg.spsWeightActivite,
              value: variables.activite,
            },
            {
              key: 'remplissage',
              label: 'Taux de remplissage',
              weight: cfg.spsWeightRemplissage,
              value: variables.remplissage,
            },
          ],
        };
  } catch {
    spsBlock = null;
  }

  // PERF-QA2 — Piste 01's teaser input: OFFICIAL, non-cancelled events whose kickoff falls in the
  // EVENT_TEASER_DAYS window after the render day, bucketed on the TUNIS calendar (the reconcile
  // convention). Suggested events (source = 'suggested') and cancelled ones can never reach an
  // owner's report — the teaser must only ever promise what the catalogue actually holds.
  const eventDay = sql<string>`to_char(${events.kickoffAt} at time zone 'Africa/Tunis', 'YYYY-MM-DD')`;
  const windowEnd = format(addDays(parseISO(todayIso), EVENT_TEASER_DAYS), 'yyyy-MM-dd');
  const [eventAgg] = await db
    .select({ n: sqlCount(), soonest: sql<string | null>`min(${eventDay})` })
    .from(events)
    .where(
      and(
        eq(events.source, 'official'),
        eq(events.annule, false),
        gte(eventDay, todayIso),
        lte(eventDay, windowEnd),
      ),
    );
  const upcomingEvents =
    eventAgg && eventAgg.n > 0 && eventAgg.soonest
      ? {
          count: eventAgg.n,
          soonestInDays: differenceInCalendarDays(parseISO(eventAgg.soonest), parseISO(todayIso)),
        }
      : null;

  return {
    venueName: venue.name,
    category: categoryLabel(venue.sectorName, venue.class),
    range,
    // RPT-COV1 — the merge's days ARE the days that carry data: a date with no cell never becomes
    // a data point. Whether they are measured or estimated is disclosed separately by
    // « dont N % estimés », so it is deliberately not folded in here.
    coverageDays: merged.days.length,
    generatedLabel: formatDateFr(todayIso),
    hostHasData: hostFlag,
    castHasData: castFlag,
    kpis,
    heatLevels: heatmapLevels(heatGrid, heatSources, venue.openingHour, venue.closingHour),
    heatKinds: heatmapKinds(heatGrid, heatSources, venue.openingHour, venue.closingHour),
    heatValues: heatmapValues(heatGrid, heatSources, venue.openingHour, venue.closingHour),
    heatEmpty: affluenceEmpty({ has_data: heatHasData, counts: heatCounts }),
    days: castFlag ? zeroFillDays(rangeDays, range) : [],
    breakdown: ratios ? demographicBreakdown(ratios, kpis.global) : null,
    revenue: {
      totalLabel: formatTndFr(periodLines.reduce((s, l) => s + l.earnings_tnd, 0)),
      count: periodLines.length,
      rows: periodLines.map((l) => ({
        name: l.campaign_name,
        period: formatCompactPeriod(l.campaign_start, l.campaign_end),
        amountLabel: `${formatTndFr(l.earnings_tnd)} TND`,
      })),
    },
    sps: spsBlock,
    upcomingEvents,
    campaignsBlock: {
      count: periodLines.length,
      cumulativeImpressions: periodLines.reduce((s, l) => s + l.display_imp, 0),
      top3,
      rows: periodLines.map((l) => ({
        name: l.campaign_name,
        period: formatTablePeriod(l.campaign_start, l.campaign_end),
        typeLabel: campaignTypeLabel(l.campaign_type),
        statut: campaignStatut(l, todayIso),
        impressionsLabel: formatIntFr(l.display_imp),
        revenueLabel: formatTndCellFr(l.earnings_tnd),
      })),
    },
  };
}
