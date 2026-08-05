import type { PerformanceEarningsLine } from './performance-derive';

/**
 * THE single owner-side impressions display home (built by PERF-QA1 R10 as this exact swap
 * point). NET-IMP1 (Mejri, ruled): « Impressions affichées = Impressions prédites − Impressions
 * perdues » — the api computes it in ITS one home (lib/impressions-display.ts, reconcile's own
 * identity) and serves it as `display_imp`; this function renders THAT field and nothing else.
 * Any future change to what owners see as « impressions générées » swaps THIS body only.
 */
export function lineImpressions(line: Pick<PerformanceEarningsLine, 'display_imp'>): number {
  return line.display_imp;
}

/** Σ over lines, through the single home above. */
export function sumLineImpressions(lines: Pick<PerformanceEarningsLine, 'display_imp'>[]): number {
  return lines.reduce((sum, line) => sum + lineImpressions(line), 0);
}
