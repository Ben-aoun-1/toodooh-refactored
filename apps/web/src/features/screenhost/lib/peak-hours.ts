import { getDay, parseISO } from 'date-fns';

import { type DateRange, inRange } from './performance-period';

/**
 * PERF-QA1 R7 — the peak-hours section's HONEST semantics, in one pure home (apps/web has no
 * render harness — a rule that lives in a component is unpinnable).
 */

/**
 * BYTE-IDENTICAL twin of the api's PEAK_HOURS_LEAD (apps/api/src/lib/report/template.ts). Each
 * side pins the exact literal in its own test, so neither the page nor the PDF can be reworded
 * without the other — the two surfaces must never disagree on what this grid means. Do not
 * reword one without the other. The PERF-QA2 amendment (US-P.5) reworded it: the grid describes
 * MEASURED audience over THE PERIOD; page and PDF are RULE-identical, byte-identity across
 * different windows is not expected.
 */
export const PEAK_HOURS_LEAD =
  "Audience mesurée par votre capteur, croisant les jours de la semaine et les heures d'ouverture sur la période analysée. Plus la couleur est vive, plus l'audience mesurée est élevée. Les zones rayées correspondent à vos heures de fermeture ou aux créneaux sans aucune mesure sur la période.";

/** The mockups' fallback window (8h–21h, 14 columns) — used ONLY when the hours are unknown. */
export const FALLBACK_HEATMAP_HOURS: readonly number[] = Array.from(
  { length: 14 },
  (_, i) => i + 8,
);

/**
 * R7 — the heatmap's hour columns come from the venue's REAL hours (`[opening, closing)`); the
 * 8h–21h mockup window is only the null / degenerate fallback (overnight semantics are deferred
 * engine-side, mirroring openHours).
 */
export function heatmapHours(openingHour: number | null, closingHour: number | null): number[] {
  if (openingHour === null || closingHour === null) return [...FALLBACK_HEATMAP_HOURS];
  const from = Math.max(0, Math.min(23, openingHour));
  const to = Math.max(0, Math.min(24, closingHour));
  if (to - from <= 0) return [...FALLBACK_HEATMAP_HOURS];
  return Array.from({ length: to - from }, (_, i) => from + i);
}

/**
 * PERF-QA2 (amendment 2026-08-20, US-P.5) — the S02 grid, built from MEASURED audience ONLY.
 *
 * WITHDRAWN RULE: the first cut of this lane spread each day's audience over the venue's
 * typical-week ESTIMATE profile. Mejri's « User Stories — Mes performances ScreenHost » makes
 * Pers_atteintes a sensor measure and US-P.5 explicit — « toute case sans aucune mesure sur la
 * période est affichée hachurée ». An estimate never colours a cell, so the estimate no longer
 * enters here AT ALL, and a cell with no measurement is `null` (hachure) rather than a 0 that
 * would read as « personne ».
 *
 * THE FORMULA (US-P.5): a filter of one week or less shows the RAW Ai_jh of that week; a longer
 * filter shows the MEAN over the covered weeks. Both collapse into ONE rule — the mean over the
 * occurrences of that (weekday, hour) which actually carry a measure — because a ≤ 1-week window
 * holds exactly one occurrence of each weekday. A week without a measurement contributes NOTHING:
 * counting it as 0 would invent a measurement of zero.
 *
 * The period scoping itself is unchanged from the first cut (ruling 2026-08-20: the page's
 * filters drive every section, S02 included); only the data source changed.
 */
export interface MeasuredHourlyPoint {
  /** YYYY-MM-DD — the Tunis calendar day of the measurement. */
  date: string;
  /** 0–23. */
  hour: number;
  /** Ai_jh — persons measured by the audience sensor during that hour. */
  audience: number;
}

/** 7×24, Monday-first. `null` = NO measure on the period → hachure, never a coloured 0. */
export function periodWeekGrid(
  points: MeasuredHourlyPoint[],
  range: DateRange,
): (number | null)[][] {
  const sums = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const counts = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const point of points) {
    if (!inRange(point.date, range)) continue;
    if (!Number.isInteger(point.hour) || point.hour < 0 || point.hour > 23) continue;
    const parsed = parseISO(point.date);
    if (Number.isNaN(parsed.getTime())) continue;
    const day = (getDay(parsed) + 6) % 7; // date-fns: 0 = Sunday → Monday-first rows
    const sumRow = sums[day];
    const countRow = counts[day];
    if (!sumRow || !countRow) continue;
    sumRow[point.hour] = (sumRow[point.hour] ?? 0) + point.audience;
    countRow[point.hour] = (countRow[point.hour] ?? 0) + 1;
  }
  return sums.map((row, day) =>
    row.map((sum, hour) => {
      const n = counts[day]?.[hour] ?? 0;
      if (n === 0) return null; // no measure → hachure
      if (n === 1) return sum; // ≤ 1 week: the RAW Ai_jh (the tooltip shows it exactly)
      return Math.round((sum / n) * 10) / 10; // > 1 week: the mean over the measured weeks
    }),
  );
}

/** The period's own observed min/max over MEASURED cells — the colour scale's bounds. */
export function measuredScale(cells: (number | null)[]): { min: number; max: number } | null {
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
 * Level 0 = NO MEASURE → hachure. 1–5 = a linear ramp over the PERIOD's own min/max, so the
 * colour is relative to what this period observed and never to an absolute audience. A period
 * whose measures are all equal reads at the neutral middle instead of pretending to a peak.
 */
export function measuredLevel(
  value: number | null,
  scale: { min: number; max: number } | null,
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (value === null || scale === null) return 0;
  if (scale.max <= scale.min) return 3;
  const level = Math.ceil(((value - scale.min) / (scale.max - scale.min)) * 5);
  return (level < 1 ? 1 : level > 5 ? 5 : level) as 1 | 2 | 3 | 4 | 5;
}

/**
 * No measured cell AT ALL on the period → the explanatory empty state, never a mute grid of
 * hachures the owner has to decode. (Web-only: the PDF renders its hachured grid under the same
 * lead, a document has no interactive state to fall back to.)
 */
export function gridHasNoMeasure(grid: (number | null)[][]): boolean {
  return grid.every((row) => row.every((value) => value === null));
}
