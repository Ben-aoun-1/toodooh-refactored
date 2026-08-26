import { affluenceEmpty } from './affluence-provenance';

/**
 * PERF-QA1 R7 — the peak-hours section's HONEST semantics, in one pure home (apps/web has no
 * render harness — a rule that lives in a component is unpinnable).
 */

/**
 * BYTE-IDENTICAL twin of the api's PEAK_HOURS_LEAD (apps/api/src/lib/report/template.ts). Each
 * side pins the exact literal in its own test, so neither the page nor the PDF can be reworded
 * without the other — the two surfaces must never disagree on what this grid means. Do not
 * reword one without the other.
 *
 * AFF1 (ruling 2026-08-26) — back to PERF-QA1 R7's semantics: the grid is the venue's TYPICAL
 * WEEK (the hub's 4-week rolling merge), NOT period-scoped, shown WITH provenance (solid =
 * measured by the sensor, dotted = estimation, hachure = closed or no data at all). The PERF-QA2
 * « measured-only over the period » reading is superseded: no measured day×hour source exists,
 * and the operator ruled the merged grid IS the truth as long as provenance is marked.
 */
export const PEAK_HOURS_LEAD =
  "Audience moyenne de votre semaine type (moyenne glissante sur les 4 dernières semaines), croisant les jours de la semaine et les heures d'ouverture. Plus la couleur est vive, plus l'audience est élevée. Les cases pleines sont mesurées par votre capteur, les cases en pointillé sont des estimations. Les zones rayées correspondent à vos heures de fermeture ou aux créneaux sans aucune donnée.";

/** AFF1 amendment — the S02 empty-state title. S02 is the typical week, not a period, so the
 * copy names no period; pinned here because the component itself is unpinnable. */
export const PEAK_HOURS_EMPTY_TITLE = "Pas encore de mesure d'audience";

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

/** The grid's own observed min/max over cells that CARRY data (measured or estimated; null =
 * no data) — the colour scale's bounds. */
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
 * values are all equal reads at the neutral middle instead of pretending to a peak.
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

/**
 * AFF1 — the explanatory empty state ONLY when no measured, no backup AND no data (a
 * NULL-source-only venue has data: it renders as estimation). Web-only: the PDF renders its
 * hachured grid under the same lead, a document has no interactive state to fall back to.
 */
export function peakHoursEmpty(input: {
  has_data: boolean;
  counts: { measured: number; backup: number };
}): boolean {
  return affluenceEmpty(input);
}
