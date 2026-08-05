import type { PerformanceEarningsLine } from './performance-derive';

/**
 * PERF-QA1 R10 — THE single owner-side impressions display home. Every impressions figure an
 * owner surface derives from a campaign line routes through here. Today it returns
 * delivered_imp VERBATIM; the planned net-impressions lane swaps THIS function's body and
 * nothing else. Do NOT introduce any formula here in this lane.
 */
export function lineImpressions(line: Pick<PerformanceEarningsLine, 'delivered_imp'>): number {
  return line.delivered_imp;
}

/** Σ over lines, through the single home above. */
export function sumLineImpressions(
  lines: Pick<PerformanceEarningsLine, 'delivered_imp'>[],
): number {
  return lines.reduce((sum, line) => sum + lineImpressions(line), 0);
}
