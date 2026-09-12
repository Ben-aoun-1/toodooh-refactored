import { addDays, format, parseISO } from 'date-fns';

import { sectorDisplayName } from '@/features/advertiser/constants/sector-display-name';
import { hoursSpan } from '@/features/auth/lib/working-hours';

import { type DateRange, inRange } from './performance-period';

/**
 * Pure KPI derivations for the "Mes performances" page (Lane F). Every section's number is
 * computed here from the four owner reads (profile / monthly-stats / impressions-daily /
 * earnings) so the maths are unit-testable without a render harness.
 */

export interface DailyAudiencePoint {
  date: string; // YYYY-MM-DD
  audience: number;
  /** PERF-R1 — per-day provenance; an unmarked point counts as measured (legacy wires). */
  source?: 'measured' | 'estimated';
  /**
   * MEJ-R2 (architect 2026-09-01) — does this day hold AT LEAST ONE measured cell? That, not
   * "every cell measured", is what makes a day eligible to be the « Pic d'audience ». Unmarked
   * points (legacy wires) fall back to `source`, so nothing that predates this field changes.
   */
  hasMeasured?: boolean;
}

export interface DailyImpressionsPoint {
  date: string; // YYYY-MM-DD
  impressions: number;
}

/** GET /api/screenhosts/earnings line — Lane F additive keys included. */
export interface PerformanceEarningsLine {
  campaign_id: string;
  campaign_name: string;
  screenhost_id: string;
  screenhost_name: string;
  expected_imp: number;
  delivered_imp: number;
  /** NET-IMP1 — « affichées = prédites − perdues », computed api-side (the ONE display home). */
  display_imp: number;
  earnings_tnd: number;
  reconciled_at: string;
  campaign_start: string | null;
  campaign_end: string | null;
  campaign_type: string;
  campaign_status: string;
}

export interface VenueRatios {
  gender_male_pct: number;
  gender_female_pct: number;
  age_17_30_pct: number;
  age_31_45_pct: number;
  /** CLS-AGE1 — the last two buckets merged into one « 46 ans et plus » (Mejri, 03/09). */
  age_46_plus_pct: number;
}

/** ISO date of an earnings line's reconciliation timestamp (the fallback anchor). */
const reconciledDate = (line: PerformanceEarningsLine): string => line.reconciled_at.slice(0, 10);

/**
 * HOST first-data flag (Mejri ruling): the venue's AUDIENCE pipeline has delivered something —
 * any hub-pushed monthly-stats month OR any non-zero affluence cell. Once true, every HOST
 * metric shows real values (0 rendered as 0) instead of "En attente du premier deal".
 */
export function hasHostData(months: unknown[], affluenceGrid: number[][]): boolean {
  return months.length > 0 || affluenceGrid.some((row) => row.some((value) => value > 0));
}

/**
 * CAST first-data flag (Mejri ruling): the venue's CAMPAIGN/REVENUE/PROOF pipeline has delivered
 * something — any earnings line OR any impressions-daily day (the API omits zero days, so a day
 * row IS data). Once true, every CAST metric shows real values, 0 on dates/periods without data.
 * The two flags NEVER gate each other's sections.
 */
export function hasCastData(
  lines: PerformanceEarningsLine[],
  days: DailyImpressionsPoint[],
): boolean {
  return lines.length > 0 || days.length > 0;
}

/**
 * S03 once hasCastData: every day of the (already clamped) period renders, 0 on days the API
 * omitted. Inverted ranges produce []. ISO date arithmetic stays string-based on the day level.
 */
export function zeroFillDays(
  days: DailyImpressionsPoint[],
  range: DateRange,
): DailyImpressionsPoint[] {
  if (range.from > range.to) return [];
  const byDate = new Map(days.map((d) => [d.date, d.impressions]));
  const filled: DailyImpressionsPoint[] = [];
  for (
    let cursor = parseISO(range.from);
    !Number.isNaN(cursor.getTime()) && format(cursor, 'yyyy-MM-dd') <= range.to;
    cursor = addDays(cursor, 1)
  ) {
    const date = format(cursor, 'yyyy-MM-dd');
    filled.push({ date, impressions: byDate.get(date) ?? 0 });
  }
  return filled;
}

export interface OpenHoursInfo {
  hours: number;
  /** PERF-QA1 R9 — true when 14 is the null/degenerate FALLBACK, so the UI marks « estimation 14 h ». */
  estimated: boolean;
}

/**
 * Daily open-hours span from the venue profile, wrap included (HOURS-X1: 21 → 8 is 11 hours).
 * Falls back to 14 (the mockup's 8h–21h span) ONLY when either bound is null or the pair is
 * zero-width — and says so, instead of passing the guess off as measured.
 */
export function openHours(opening: number | null, closing: number | null): OpenHoursInfo {
  if (opening === null || closing === null) return { hours: 14, estimated: true };
  const span = hoursSpan(opening, closing);
  return span > 0 ? { hours: span, estimated: false } : { hours: 14, estimated: true };
}

export interface AudienceKpis {
  global: number;
  perDay: number | null;
  perHour: number | null;
  peak: { value: number; date: string } | null;
  /** PERF-R1 — how many of the période's data days carry a real measure. */
  measuredDays: number;
  /** PERF-R1 — % of the data days that are estimated (« dont N % estimés »); null = no data day. */
  estimatedPct: number | null;
}

/**
 * S01 — audience KPIs over the period's daily audience points. Averages divide by DAYS WITH DATA
 * (not calendar days), mirroring the mockup's "par jour d'ouverture"; null when no data.
 * PERF-QA1 R9 — divide FIRST, round ONCE at the end: rounding perDay before the /h divide
 * shifted the hourly figure (her 0,3 pers/h was computed off an already-rounded day average).
 */
/**
 * AUD-HOURLY1-C — `estimatedPct` is now supplied by the CALLER, not derived here. The merge counts
 * DATA POINTS (every merged cell, plus each day held only at day granularity), which this function
 * cannot see from `points` alone — it only receives the day totals. Required, not optional, so a
 * call site cannot silently fall back to the old day-share by omission (the MEJ-R1 precedent).
 */
export function audienceKpis(
  points: DailyAudiencePoint[],
  hoursPerDay: number,
  estimatedPct: number | null,
): AudienceKpis {
  if (points.length === 0)
    return {
      global: 0,
      perDay: null,
      perHour: null,
      peak: null,
      measuredDays: 0,
      estimatedPct,
    };
  let global = 0;
  let peak: { value: number; date: string } | null = null;
  for (const p of points) {
    global += p.audience;
    // MEJ-R2 (architect 2026-09-01, amending MEJ-R1) — the peak is the highest MERGED day total
    // among the days holding AT LEAST ONE measured cell. MEJ-R1's « every hour measured » reading
    // discarded a genuinely real day for one backup hour: Mejri's 31/08 measured 373 people, held
    // one grid-filled hour, and the tile named « 5 le 01/09 » instead. MEJ-R1's real target
    // survives — a day built ENTIRELY from the typical-week grid holds no measured cell and can
    // never be the peak, so « Pic 1 398 le 10/08 » on a venue onboarded 26/08 stays impossible
    // (and the MEJ-2 floor bounds the backup independently). The VALUE stays the merged day total
    // the page already sums, so the tile cannot contradict « Audience globale ».
    if (!(p.hasMeasured ?? p.source !== 'estimated')) continue;
    if (peak === null || p.audience > peak.value) peak = { value: p.audience, date: p.date };
  }
  const perDayRaw = global / points.length;
  const perDay = Math.round(perDayRaw);
  // One decimal (Mejri prod-test #3): 4 pers/day ÷ 14 h must read 0,3 — never a rounded 0.
  const perHour = hoursPerDay > 0 ? Math.round((perDayRaw / hoursPerDay) * 10) / 10 : null;
  const measuredCount = points.filter((p) => p.source !== 'estimated').length;
  return { global, perDay, perHour, peak, measuredDays: measuredCount, estimatedPct };
}

/** All daily audience points of the given months flattened, filtered to the period. */
export function dailyAudienceWithin(
  months: { daily: DailyAudiencePoint[] }[],
  range: DateRange,
): DailyAudiencePoint[] {
  return months.flatMap((m) => m.daily).filter((p) => inRange(p.date, range));
}

/** Σ impressions of the days that fall inside the period (S03/S06). */
export function impressionsWithin(days: DailyImpressionsPoint[], range: DateRange): number {
  return days.reduce((sum, d) => (inRange(d.date, range) ? sum + d.impressions : sum), 0);
}

/** Σ impressions of the days belonging to one 'YYYY-MM' month (the monthly-card tile). */
export function impressionsOfMonth(days: DailyImpressionsPoint[], month: string): number {
  return days.reduce((sum, d) => (d.date.startsWith(`${month}-`) ? sum + d.impressions : sum), 0);
}

/**
 * A campaign line belongs to the period when its [start, end] window OVERLAPS it. Null dates fall
 * back to the reconciliation date so a line can never silently vanish from every period.
 */
export function lineInPeriod(line: PerformanceEarningsLine, range: DateRange): boolean {
  const start = line.campaign_start ?? reconciledDate(line);
  const end = line.campaign_end ?? start;
  return start <= range.to && end >= range.from;
}

/** The monthly-card tile: lines whose campaign END falls inside 'YYYY-MM' (fallback: reconciled). */
export function linesEndingInMonth(
  lines: PerformanceEarningsLine[],
  month: string,
): PerformanceEarningsLine[] {
  return lines.filter((l) => (l.campaign_end ?? reconciledDate(l)).startsWith(`${month}-`));
}

export type CampaignStatut = 'À venir' | 'En cours' | 'Passée';

/**
 * US-P.9 (amendment 2026-08-20) — the statut is DATE-derived over the campaign's own window, in
 * THREE states: « À venir » before it starts, « En cours » inside it, « Passée » once it ends.
 * « Active » is retired — it said nothing about a campaign that had not started yet.
 * Null dates fall back to the reconciliation date, the same anchor lineInPeriod uses, so a line
 * can never land in an undefined state. campaign_status stays out of it: the enum has no terminal
 * value, and the dates are the truth the owner reads on the same row.
 */
export function campaignStatut(line: PerformanceEarningsLine, todayIso: string): CampaignStatut {
  const start = line.campaign_start ?? reconciledDate(line);
  const end = line.campaign_end ?? start;
  if (start > todayIso) return 'À venir';
  if (end < todayIso) return 'Passée';
  return 'En cours';
}

/** US-P.9 — the type column: event positionings read « Événement », everything else « Standard ». */
export function campaignTypeLabel(campaignType: string): string {
  if (campaignType === 'event') return 'Événement';
  return campaignType ? campaignType.charAt(0).toUpperCase() + campaignType.slice(1) : '—';
}

export interface CumulativePoint {
  date: string;
  cumulative: number;
}

/**
 * Hero charts — running total over date-stamped values (dates aggregated, then sorted asc).
 * Malformed/empty dates are dropped.
 */
export function cumulativeSeries(items: { date: string; value: number }[]): CumulativePoint[] {
  const byDate = new Map<string, number>();
  for (const item of items) {
    if (!item.date) continue;
    byDate.set(item.date, (byDate.get(item.date) ?? 0) + item.value);
  }
  const dates = [...byDate.keys()].sort();
  let running = 0;
  return dates.map((date) => {
    running += byDate.get(date) ?? 0;
    return { date, cumulative: running };
  });
}

/**
 * PERF-1b (Mejri 31/08 pt 4) — « Votre progression depuis le début », one point per REAL day.
 *
 * The hero used to plot `monthly_stats` keyed by MONTH, at `${month}-01`: after real data arrived
 * the curve showed the right value dated **01/08/2026** instead of the day it was measured. The
 * fix is not a label change — it is plotting the day-level series `periodAudience` already builds
 * (same helper as S01, same MEJ-2 onboarding floor, no new wire), so a point's date is the date
 * its audience happened.
 */
export function audienceCumulative(points: DailyAudiencePoint[]): CumulativePoint[] {
  return cumulativeSeries(points.map((p) => ({ date: p.date, value: p.audience })));
}

/**
 * PERF-1b — the hero's headline. It is Σ of the SAME points S01 sums, so « depuis le début » and
 * « Audience globale » can never disagree for the same range (`audienceKpis(...).global`).
 */
export function audienceTotal(points: DailyAudiencePoint[]): number {
  return points.reduce((sum, p) => sum + p.audience, 0);
}

/**
 * PERF-1b — one month's audience out of the day-level series (the monthly card + Historique).
 * Mirrors impressionsOfMonth. Replaces the raw `monthly_stats.total_audience` read, which was
 * measured-only and unfloored — so the card disagreed with the PDF it links to, which has run on
 * `periodAudience` since PERF-R1/MEJ-2.
 */
export function audienceOfMonth(points: DailyAudiencePoint[], month: string): number {
  return points.reduce((sum, p) => (p.date.startsWith(`${month}-`) ? sum + p.audience : sum), 0);
}

export interface DemographicBand {
  key: keyof VenueRatios;
  label: string;
  count: number;
}

export interface DemographicBreakdown {
  femmes: number;
  hommes: number;
  /** DEVIATION (ruled): only the four REAL bands — the mockup's 0–9 / 10–16 have no data source. */
  ages: DemographicBand[];
}

/** S04 — ratios × the period's global audience, as estimated person counts. */
export function demographicBreakdown(ratios: VenueRatios, audience: number): DemographicBreakdown {
  const persons = (pct: number): number => Math.round((audience * pct) / 100);
  return {
    femmes: persons(ratios.gender_female_pct),
    hommes: persons(ratios.gender_male_pct),
    ages: [
      { key: 'age_17_30_pct', label: '17 – 30 ans', count: persons(ratios.age_17_30_pct) },
      { key: 'age_31_45_pct', label: '31 – 45 ans', count: persons(ratios.age_31_45_pct) },
      { key: 'age_46_plus_pct', label: '46 ans et plus', count: persons(ratios.age_46_plus_pct) },
    ],
  };
}

/** fr-FR integer formatting ('191 400'), the mockups' number style. */
export function formatIntFr(value: number): string {
  return Math.round(value).toLocaleString('fr-FR');
}

/** fr-FR with at most one comma decimal ('0,3'); whole numbers drop it ('4') — the moyenne/h display. */
export function formatDecimalFr(value: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

/** fr-FR money without decimals for hero/S05 totals ('1 640'); table cells add ',00 TND'. */
export function formatTndFr(value: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatTndCellFr(value: number): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TND`;
}

/** Venue category line: 'business_sector · Class' ('Café · Premium'). */
export function categoryLabel(
  sector: string | null,
  venueClass: 'populaire' | 'moyen' | 'premium' | null,
): string {
  if (!sector) return '—';
  // UI-1 — the STORED name matched everything up to here; only the rendered string is mapped.
  const label = sectorDisplayName(sector);
  if (!venueClass) return label;
  const classLabel = venueClass.charAt(0).toUpperCase() + venueClass.slice(1);
  return `${label} · ${classLabel}`;
}

/** INV-1 — one per-venue read's lifecycle as the page consumes it (React Query v5 vocabulary). */
export interface VenueReadStatus {
  pending: boolean;
  error: boolean;
}

export type VenueReadsState = 'loading' | 'error' | 'ready';

/**
 * INV-1 — the gate over the per-venue reads feeding the performance surfaces: the sections and
 * their first-data flags (`hasHostData`/`hasCastData`) may only render from SETTLED data. A
 * failed or still-pending read otherwise collapses to `?? []` defaults and masquerades as
 * « En attente du premier deal » / « Aucun rapport généré » — the 2026-08-07 incident, where a
 * degraded api held the reads for minutes and both owner surfaces lied pre-first-data. Error
 * outranks loading so the retry affordance is never hidden behind a spinner.
 */
export function venueReadsState(reads: VenueReadStatus[]): VenueReadsState {
  if (reads.some((r) => r.error)) return 'error';
  if (reads.some((r) => r.pending)) return 'loading';
  return 'ready';
}
