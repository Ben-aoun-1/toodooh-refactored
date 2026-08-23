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
  screenhostAffluence,
  screenhostMonthlyStats,
  screenhosts,
} from '../../db/schema.js';
import { getDispatchConfig } from '../dispatch/config.js';
import { displayImpressionsSettled } from '../impressions-display.js';
import { measuredDays, measuredTotal } from '../monthly-audience.js';
import { computeSps } from '../sps-score.js';

import {
  type AudienceKpis,
  type DailyImpressionsPoint,
  type DateRange,
  type DemographicBreakdown,
  type MeasuredHourlyPoint,
  type ReportEarningsLine,
  type VenueRatios,
  audienceKpis,
  campaignStatut,
  categoryLabel,
  dailyAudienceWithin,
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
  measuredLevel,
  measuredScale,
  openHoursPerDay,
  periodWeekGrid,
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
  statut: 'Active' | 'Passée';
  impressionsLabel: string;
  revenueLabel: string;
}

export interface ReportData {
  venueName: string;
  category: string;
  range: DateRange;
  /** DD/MM/YYYY of the render day — the masthead's "Généré le". */
  generatedLabel: string;
  hostHasData: boolean;
  castHasData: boolean;
  kpis: AudienceKpis;
  /** 7×14 levels for the 8h–21h grid; 0 = hachure (closed hour OR no data). */
  heatLevels: number[][];
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

const typeLabelFr = (raw: string): string =>
  raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '—';

const numOrNull = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * 7×14 hachure/ramp levels over the MEASURED period grid, exactly like the page (US-P.5): level 0
 * is a closed hour OR a cell with no measure; 1–5 ramp linearly over the period's own min/max.
 */
export function heatmapLevels(
  grid: (number | null)[][],
  openingHour: number | null,
  closingHour: number | null,
): number[][] {
  const closed = (hour: number): boolean => {
    if (openingHour === null || closingHour === null) return false;
    return hour < openingHour || hour >= closingHour;
  };
  const visible: (number | null)[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (const hour of HEATMAP_HOURS) {
      if (!closed(hour)) visible.push(grid[day]?.[hour] ?? null);
    }
  }
  const scale = measuredScale(visible);
  return Array.from({ length: 7 }, (_, day) =>
    HEATMAP_HOURS.map((hour) =>
      closed(hour) ? 0 : measuredLevel(grid[day]?.[hour] ?? null, scale),
    ),
  );
}

/** All six ratio columns or null — a partial row never leaks (the C3 all-or-null contract). */
function ratiosOrNull(venue: {
  genderMalePct: string | null;
  genderFemalePct: string | null;
  age17To30Pct: string | null;
  age31To45Pct: string | null;
  age46To60Pct: string | null;
  age60PlusPct: string | null;
}): VenueRatios | null {
  const male = numOrNull(venue.genderMalePct);
  const female = numOrNull(venue.genderFemalePct);
  const a17 = numOrNull(venue.age17To30Pct);
  const a31 = numOrNull(venue.age31To45Pct);
  const a46 = numOrNull(venue.age46To60Pct);
  const a60 = numOrNull(venue.age60PlusPct);
  if (
    male === null ||
    female === null ||
    a17 === null ||
    a31 === null ||
    a46 === null ||
    a60 === null
  ) {
    return null;
  }
  return {
    gender_male_pct: male,
    gender_female_pct: female,
    age_17_30_pct: a17,
    age_31_45_pct: a31,
    age_46_60_pct: a46,
    age_60_plus_pct: a60,
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
      genderMalePct: screenhosts.genderMalePct,
      genderFemalePct: screenhosts.genderFemalePct,
      age17To30Pct: screenhosts.age17To30Pct,
      age31To45Pct: screenhosts.age31To45Pct,
      age46To60Pct: screenhosts.age46To60Pct,
      age60PlusPct: screenhosts.age60PlusPct,
    })
    .from(screenhosts)
    .leftJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    .where(eq(screenhosts.id, venueId))
    .limit(1);
  if (!venue) return null;

  // 2) monthly stats (month desc) — mirror of GET /:id/monthly-stats, MEASURED DAYS ONLY.
  // AMENDMENT 2026-08-20 (US-P.0): Pers_atteintes is a sensor measure — an estimated day never
  // feeds an audience figure. The stored row keeps both kinds; this read drops the estimates so
  // every KPI below (Ai, moyennes, Pic) is measured by construction.
  const monthRows = await db
    .select({
      month: screenhostMonthlyStats.month,
      totalAudience: screenhostMonthlyStats.totalAudience,
      daily: screenhostMonthlyStats.daily,
    })
    .from(screenhostMonthlyStats)
    .where(eq(screenhostMonthlyStats.screenhostId, venueId))
    .orderBy(desc(screenhostMonthlyStats.month));
  const months = monthRows.map((row) => ({
    month: row.month,
    totalAudience: measuredTotal(row.daily),
    daily: measuredDays(row.daily),
  }));

  // 3) affluence slots → zero-filled 7×24 grid — mirror of GET /:id/affluence.
  const slots = await db
    .select({
      dayOfWeek: screenhostAffluence.dayOfWeek,
      hour: screenhostAffluence.hour,
      estimatedImpressions: screenhostAffluence.estimatedImpressions,
    })
    .from(screenhostAffluence)
    .where(eq(screenhostAffluence.screenhostId, venueId));
  const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const slot of slots) {
    const row = grid[slot.dayOfWeek - 1];
    if (row && slot.hour >= 0 && slot.hour <= 23) row[slot.hour] = slot.estimatedImpressions;
  }

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

  const periodAudience = dailyAudienceWithin(months, range);

  // S02's ONLY legitimate source (US-P.5): MEASURED Ai_jh — persons the audience sensor counted in
  // a given (calendar day, hour). NOTHING WRITES SUCH ROWS TODAY: the hub pushes an ESTIMATE grid
  // (screenhost_affluence, weekday × hour) and MEASURED per-DAY totals (screenhost_monthly_stats),
  // neither of which is a measured day×hour series. Per the amendment an estimate may never colour
  // a cell, so the list stays empty and every cell is hachured until a sensor ingest exists —
  // THE one seam to wire when it does.
  const measuredHourly: MeasuredHourlyPoint[] = [];
  const kpis = audienceKpis(periodAudience, openHoursPerDay(venue.openingHour, venue.closingHour));

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
    const { sps, variables } = await computeSps(venueId);
    // PERF-QA2 — each criterion carries its KEY: Piste 03 names the weakest weighted variable and
    // proposes the lever that moves THAT variable, and a lever must never be matched on a label
    // string (a reworded label would silently swap the advice).
    spsBlock = {
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
    generatedLabel: formatDateFr(todayIso),
    hostHasData: hostFlag,
    castHasData: castFlag,
    kpis,
    heatLevels: heatmapLevels(
      periodWeekGrid(measuredHourly, range),
      venue.openingHour,
      venue.closingHour,
    ),
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
        typeLabel: typeLabelFr(l.campaign_type),
        statut: campaignStatut(l, todayIso),
        impressionsLabel: formatIntFr(l.display_imp),
        revenueLabel: formatTndCellFr(l.earnings_tnd),
      })),
    },
  };
}
