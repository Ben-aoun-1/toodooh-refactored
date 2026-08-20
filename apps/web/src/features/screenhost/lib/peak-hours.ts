import { getDay, parseISO } from 'date-fns';

import type { DailyAudiencePoint } from './performance-derive';
import { type DateRange, inRange } from './performance-period';

/**
 * PERF-QA1 R7 — the peak-hours section's HONEST semantics, in one pure home (apps/web has no
 * render harness — a rule that lives in a component is unpinnable).
 */

/**
 * BYTE-IDENTICAL twin of the api's PEAK_HOURS_LEAD (apps/api/src/lib/report/template.ts). Each
 * side pins the exact literal in its own test, so neither the page nor the PDF can be reworded
 * without the other — the two surfaces must never disagree on what this grid means. Do not
 * reword one without the other. PERF-QA2 reworded it: the grid now describes THE PERIOD, and
 * page and PDF are RULE-identical (byte-identity across different windows is not expected).
 */
export const PEAK_HOURS_LEAD =
  "Audience moyenne par jour et par heure sur la période analysée, croisant les jours de la semaine et les heures d'ouverture. Plus la couleur est vive, plus l'audience est élevée. Les zones rayées correspondent à vos heures de fermeture ou aux créneaux sans données sur la période.";

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

/** R7 — the all-empty grid (no cell above 0) gets an explanatory state, never a mute grid. */
export function gridIsAllEmpty(grid: number[][]): boolean {
  return !grid.some((row) => row.some((value) => value > 0));
}

/**
 * PERF-QA2 — the S02 grid, SCOPED TO THE SELECTED PERIOD (PERF-QA1 R7's « rolling semaine type,
 * never the period » is SUPERSEDED, ruling 2026-08-20: the page's period filters drive EVERY
 * section, S02 included).
 *
 * Each in-period day's audience is spread over its weekday's hourly SHAPE (the typical-week
 * grid), then averaged over that weekday's occurrences in the period.
 *
 * SHAPE-BORROWING, stated plainly (accepted design note, 2026-08-20): measured audience exists
 * at DAY granularity only, so the hour-by-hour shape can only come from the typical week. This is
 * the best derivable answer until per-slot measurement exists — the period modulates the shape's
 * AMPLITUDE, never its profile.
 *
 * The identity property that makes this safe: for an estimate-derived day, audience(date) equals
 * Σ_h grid[weekday][h], so the cell reproduces the typical grid EXACTLY — a venue on estimates
 * sees no visual change. And a period with no daily audience at all yields an all-zero grid, so
 * gridIsAllEmpty fires and the explanatory empty state replaces the old coloured-heatmap-on-an-
 * empty-period defect. That defect is now structurally impossible, not merely fixed.
 */
export function periodWeekGrid(
  typicalGrid: number[][],
  daily: DailyAudiencePoint[],
  range: DateRange,
): number[][] {
  const sums = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const counts = Array.from({ length: 7 }, () => 0);
  for (const point of daily) {
    if (!inRange(point.date, range)) continue;
    const parsed = parseISO(point.date);
    if (Number.isNaN(parsed.getTime())) continue;
    const day = (getDay(parsed) + 6) % 7; // date-fns: 0 = Sunday → Monday-first rows
    const profile = typicalGrid[day];
    if (!profile) continue;
    const dayTotal = profile.reduce((sum, value) => sum + value, 0);
    // No hourly shape for that weekday → the day's audience cannot be placed in any hour. It is
    // DROPPED rather than smeared flat: an invented shape would read as measured.
    if (dayTotal <= 0) continue;
    counts[day] = (counts[day] ?? 0) + 1;
    const row = sums[day];
    if (!row) continue;
    for (let hour = 0; hour < 24; hour += 1) {
      row[hour] = (row[hour] ?? 0) + (point.audience * (profile[hour] ?? 0)) / dayTotal;
    }
  }
  // One decimal: a low-traffic measured day can land under 1 person/hour, and rounding that to 0
  // would hachure a cell that genuinely has data.
  return sums.map((row, day) => {
    const n = counts[day] ?? 0;
    return row.map((value) => (n > 0 ? Math.round((value / n) * 10) / 10 : 0));
  });
}
