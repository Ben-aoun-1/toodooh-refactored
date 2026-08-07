import { addDays, format, parseISO } from 'date-fns';

import { type DateRange, inRange } from './performance-period';

/**
 * Pure KPI derivations for the "Mes performances" page (Lane F). Every section's number is
 * computed here from the four owner reads (profile / monthly-stats / impressions-daily /
 * earnings) so the maths are unit-testable without a render harness.
 */

export interface DailyAudiencePoint {
  date: string; // YYYY-MM-DD
  audience: number;
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
  age_46_60_pct: number;
  age_60_plus_pct: number;
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
 * Daily open-hours span from the venue profile, `[opening, closing)`. Falls back to 14 (the
 * mockup's 8h–21h span) ONLY when either bound is null or the window is degenerate/overnight
 * (overnight semantics are deferred engine-side) — and says so, instead of passing the guess
 * off as measured.
 */
export function openHours(opening: number | null, closing: number | null): OpenHoursInfo {
  if (opening === null || closing === null) return { hours: 14, estimated: true };
  const span = closing - opening;
  return span > 0 ? { hours: span, estimated: false } : { hours: 14, estimated: true };
}

export interface AudienceKpis {
  global: number;
  perDay: number | null;
  perHour: number | null;
  peak: { value: number; date: string } | null;
  /** PERF-QA1 R9 — the divisor basis, surfaced as « sur N jours mesurés ». */
  measuredDays: number;
}

/**
 * S01 — audience KPIs over the period's daily audience points. Averages divide by DAYS WITH DATA
 * (not calendar days), mirroring the mockup's "par jour d'ouverture"; null when no data.
 * PERF-QA1 R9 — divide FIRST, round ONCE at the end: rounding perDay before the /h divide
 * shifted the hourly figure (her 0,3 pers/h was computed off an already-rounded day average).
 */
export function audienceKpis(points: DailyAudiencePoint[], hoursPerDay: number): AudienceKpis {
  if (points.length === 0)
    return { global: 0, perDay: null, perHour: null, peak: null, measuredDays: 0 };
  let global = 0;
  let peak: { value: number; date: string } | null = null;
  for (const p of points) {
    global += p.audience;
    if (peak === null || p.audience > peak.value) peak = { value: p.audience, date: p.date };
  }
  const perDayRaw = global / points.length;
  const perDay = Math.round(perDayRaw);
  // One decimal (Mejri prod-test #3): 4 pers/day ÷ 14 h must read 0,3 — never a rounded 0.
  const perHour = hoursPerDay > 0 ? Math.round((perDayRaw / hoursPerDay) * 10) / 10 : null;
  return { global, perDay, perHour, peak, measuredDays: points.length };
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

/**
 * S06 Statut pill — DATE-derived per the CF-9 #1 ruling: campaign_end strictly before today →
 * 'Passée', else 'Active'. campaign_status is only the secondary signal for the no-end-date case
 * (the enum has no closed state yet; the engine's future `completed` status re-binds this).
 */
export function campaignStatut(
  line: PerformanceEarningsLine,
  todayIso: string,
): 'Active' | 'Passée' {
  if (line.campaign_end) return line.campaign_end < todayIso ? 'Passée' : 'Active';
  return line.campaign_status === 'active' ? 'Active' : 'Passée';
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
      { key: 'age_46_60_pct', label: '46 – 60 ans', count: persons(ratios.age_46_60_pct) },
      { key: 'age_60_plus_pct', label: '60 ans et plus', count: persons(ratios.age_60_plus_pct) },
    ],
  };
}

/**
 * S02 heatmap — 5-step intensity levels bucketed by QUANTILES over the visible (open-hour) cell
 * values. The ramp only applies to cells WITH data.
 */
export function quantileThresholds(values: number[]): [number, number, number, number] {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [Infinity, Infinity, Infinity, Infinity];
  const at = (q: number): number =>
    positive[Math.min(positive.length - 1, Math.floor(q * positive.length))] ?? Infinity;
  return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

/**
 * Level 0 = NO DATA → the hachure treatment, not the ramp floor (Mejri ruling #1). The affluence
 * grid zero-fills, so a measured-true-zero cell is indistinguishable from an unmeasured one —
 * accepted approximation: 0 reads as no-data.
 */
export function intensityLevel(
  value: number,
  thresholds: [number, number, number, number],
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (value <= 0) return 0;
  if (value < thresholds[0]) return 1;
  if (value < thresholds[1]) return 2;
  if (value < thresholds[2]) return 3;
  if (value < thresholds[3]) return 4;
  return 5;
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

/** '17 – 30 ans' venue category line: 'business_sector · Class' ('Café · Premium'). */
export function categoryLabel(
  sector: string | null,
  venueClass: 'populaire' | 'moyen' | 'premium' | null,
): string {
  if (!sector) return '—';
  if (!venueClass) return sector;
  const classLabel = venueClass.charAt(0).toUpperCase() + venueClass.slice(1);
  return `${sector} · ${classLabel}`;
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
