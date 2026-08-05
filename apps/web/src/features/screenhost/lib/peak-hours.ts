/**
 * PERF-QA1 R7 — the peak-hours section's HONEST semantics, in one pure home (apps/web has no
 * render harness — a rule that lives in a component is unpinnable).
 */

/**
 * BYTE-IDENTICAL twin of the api's PEAK_HOURS_LEAD (apps/api/src/lib/report/template.ts). Each
 * side pins the exact literal in its own test, so neither the page nor the PDF can be reworded
 * without the other — the two surfaces must never disagree on what this grid means. Do not
 * reword one without the other.
 */
export const PEAK_HOURS_LEAD =
  "Audience moyenne de votre semaine type (moyenne glissante sur les 4 dernières semaines), croisant les jours de la semaine et les heures d'ouverture. Plus la couleur est vive, plus l'audience est élevée. Les zones rayées correspondent à vos heures de fermeture ou aux créneaux sans données mesurées.";

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
