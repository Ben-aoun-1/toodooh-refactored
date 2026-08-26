import { addDays, format, parseISO } from 'date-fns';

/**
 * Pure derivations for the R1 report — a deliberate API-SIDE MIRROR of the web lib
 * (apps/web/src/features/screenhost/lib/performance-derive.ts + performance-period.ts): the FE
 * package is not importable from here, so the minimal subset is reimplemented and its unit
 * fixtures pinned to the web tests (parity pinned; divergence risk accepted — a shared package
 * is a later refactor). Semantics follow the Mejri ruling exactly like the page.
 */

export interface DateRange {
  from: string; // inclusive ISO YYYY-MM-DD
  to: string; // inclusive ISO YYYY-MM-DD
}

/** Inclusive containment — ISO date strings compare lexicographically. */
export function inRange(dateIso: string, range: DateRange): boolean {
  return dateIso >= range.from && dateIso <= range.to;
}

export interface DailyAudiencePoint {
  date: string; // YYYY-MM-DD
  audience: number;
}

export interface DailyImpressionsPoint {
  date: string; // YYYY-MM-DD
  impressions: number;
}

/** The earnings line shape the report consumes (mirror of the owner earnings read). */
export interface ReportEarningsLine {
  campaign_name: string;
  delivered_imp: number;
  /** NET-IMP1 — « affichées = prédites − perdues » (lib/impressions-display, THE display home). */
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

const reconciledDate = (line: ReportEarningsLine): string => line.reconciled_at.slice(0, 10);

/** HOST first-data flag: any monthly-stats month OR any non-zero affluence cell. */
export function hasHostData(months: unknown[], affluenceGrid: number[][]): boolean {
  return months.length > 0 || affluenceGrid.some((row) => row.some((value) => value > 0));
}

/** CAST first-data flag: any earnings line OR any impressions-daily day. */
export function hasCastData(lines: ReportEarningsLine[], days: DailyImpressionsPoint[]): boolean {
  return lines.length > 0 || days.length > 0;
}

/** Daily open-hours span, `[opening, closing)`; 14h fallback (the mockups' 8h–21h span). */
export function openHoursPerDay(opening: number | null, closing: number | null): number {
  if (opening === null || closing === null) return 14;
  const span = closing - opening;
  return span > 0 ? span : 14;
}

export interface AudienceKpis {
  global: number;
  perDay: number | null;
  perHour: number | null;
  peak: { value: number; date: string } | null;
}

/** S01 — averages divide by DAYS WITH DATA (not calendar days); null slots when no data. */
export function audienceKpis(points: DailyAudiencePoint[], hoursPerDay: number): AudienceKpis {
  if (points.length === 0) return { global: 0, perDay: null, perHour: null, peak: null };
  let global = 0;
  let peak: { value: number; date: string } | null = null;
  for (const p of points) {
    global += p.audience;
    if (peak === null || p.audience > peak.value) peak = { value: p.audience, date: p.date };
  }
  // PERF-QA1 R9 — divide FIRST, round ONCE at the end (parity with the page's derive: an
  // intermediate perDay round shifted the /h figure, and the PDF must never disagree).
  const perDayRaw = global / points.length;
  const perDay = Math.round(perDayRaw);
  // One decimal (Mejri prod-test #3): 4 pers/day ÷ 14 h must read 0,3 — never a rounded 0.
  const perHour = hoursPerDay > 0 ? Math.round((perDayRaw / hoursPerDay) * 10) / 10 : null;
  return { global, perDay, perHour, peak };
}

/** All daily audience points of the given months flattened, filtered to the period. */
export function dailyAudienceWithin(
  months: { daily: DailyAudiencePoint[] }[],
  range: DateRange,
): DailyAudiencePoint[] {
  return months.flatMap((m) => m.daily).filter((p) => inRange(p.date, range));
}

/** A campaign line belongs to the period when its [start, end] window OVERLAPS it. */
export function lineInPeriod(line: ReportEarningsLine, range: DateRange): boolean {
  const start = line.campaign_start ?? reconciledDate(line);
  const end = line.campaign_end ?? start;
  return start <= range.to && end >= range.from;
}

export type CampaignStatut = 'À venir' | 'En cours' | 'Passée';

/**
 * S06 Statut — US-P.9's THREE date-derived states (amendment 2026-08-20), mirroring the page:
 * « À venir » before the window, « En cours » inside it, « Passée » after. « Active » is retired.
 * The document follows the page by rule — the same campaign must never read differently on the
 * screen and in the PDF.
 */
export function campaignStatut(line: ReportEarningsLine, todayIso: string): CampaignStatut {
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

/** S03 once hasCastData: every day of the range renders, 0 on days without data. */
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

export interface DemographicBand {
  key: keyof VenueRatios;
  label: string;
  count: number;
}

export interface DemographicBreakdown {
  femmes: number;
  hommes: number;
  /** DEVIATION (ruled, as on the page): only the four REAL bands. */
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

/** Venue category line: 'business_sector · Class' ('Café · Premium'); '—' without a sector. */
export function categoryLabel(
  sector: string | null,
  venueClass: 'populaire' | 'moyen' | 'premium' | null,
): string {
  if (!sector) return '—';
  if (!venueClass) return sector;
  const classLabel = venueClass.charAt(0).toUpperCase() + venueClass.slice(1);
  return `${sector} · ${classLabel}`;
}

// ── fr-FR formatting — HAND-ROLLED (deterministic across Node ICU builds), matching what the
// page's toLocaleString('fr-FR') produces in modern browsers: U+202F thousands grouping. ────────
const NNBSP = '\u202f';

export function formatIntFr(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return sign + grouped;
}

/** Money without decimals for the S05 total ('1 640'). */
export function formatTndFr(value: number): string {
  return formatIntFr(value);
}

/** Table cells add ',00 TND' ('412,00 TND'). */
export function formatTndCellFr(value: number): string {
  const fixed = Math.abs(value).toFixed(2);
  const [intPart = '0', decPart = '00'] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return `${value < 0 ? '-' : ''}${grouped},${decPart} TND`;
}

/** At most one comma decimal ('0,3'); whole numbers drop it ('4') — the moyenne/h display. */
export function formatDecimalFr(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return formatIntFr(rounded);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const intPart = Math.floor(abs);
  return `${sign}${formatIntFr(intPart)},${Math.round((abs - intPart) * 10)}`;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY'; '—' on malformed input. */
export function formatDateFr(dateIso: string): string {
  const d = parseISO(dateIso);
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'dd/MM/yyyy');
}

/** '05/06 – 18/06'-style compact period for S05 rows; year-less per the mockup. */
export function formatCompactPeriod(startIso: string | null, endIso: string | null): string {
  const compact = (value: string | null): string | null => {
    if (!value) return null;
    const d = parseISO(value);
    return Number.isNaN(d.getTime()) ? null : format(d, 'dd/MM');
  };
  const start = compact(startIso);
  const end = compact(endIso);
  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? '—';
}

/** '05/06 – 18/06/2026'-style period for the S06 table. */
export function formatTablePeriod(startIso: string | null, endIso: string | null): string {
  const start = startIso ? parseISO(startIso) : null;
  const end = endIso ? parseISO(endIso) : null;
  const startOk = start && !Number.isNaN(start.getTime()) ? start : null;
  const endOk = end && !Number.isNaN(end.getTime()) ? end : null;
  if (startOk && endOk) return `${format(startOk, 'dd/MM')} – ${format(endOk, 'dd/MM/yyyy')}`;
  if (endOk) return format(endOk, 'dd/MM/yyyy');
  if (startOk) return format(startOk, 'dd/MM/yyyy');
  return '—';
}

/** The grid's own observed min/max over cells that CARRY data (measured or estimated; null =
 * no data) — the colour scale's bounds. Twin of the web lib's heatmapScale. */
export function heatmapScale(cells: (number | null)[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of cells) {
    if (value === null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : { min, max };
}

/**
 * Level 0 = NO DATA → hachure. 1–5 = a linear ramp over the grid's own min/max, so the colour is
 * relative to what this venue's week holds and never to an absolute audience. A grid whose
 * values are all equal reads at the neutral middle instead of pretending to a peak. Twin of the
 * web lib's heatmapLevel.
 */
export function heatmapLevel(
  value: number | null,
  scale: { min: number; max: number } | null,
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (value === null || scale === null) return 0;
  if (scale.max <= scale.min) return 3;
  const level = Math.ceil(((value - scale.min) / (scale.max - scale.min)) * 5);
  return (level < 1 ? 1 : level > 5 ? 5 : level) as 1 | 2 | 3 | 4 | 5;
}
