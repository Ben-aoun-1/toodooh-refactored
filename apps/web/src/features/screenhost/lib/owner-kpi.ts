import { sumLineImpressions } from './impressions-display';
import type { PerformanceEarningsLine } from './performance-derive';

/**
 * PERF-QA1 R11 — the owner Dashboard's KPI tiles, derived from REAL wires (the constant-zero
 * memo era is over): campagnes diffusées + impressions from the earnings lines (impressions
 * through the R10 single home), durée totale from the playout summary (all-time Σ
 * played_duration_ms — cumulative, consistent with the Revenus tile).
 */
export interface OwnerKpi {
  campaignsDiffused: number;
  impressions: number;
  totalDurationSeconds: number;
}

export function ownerKpiFrom(
  lines: Pick<PerformanceEarningsLine, 'campaign_id' | 'delivered_imp'>[],
  totalPlayedMs: number,
): OwnerKpi {
  return {
    // One campaign across several of my venues is ONE campaign diffused.
    campaignsDiffused: new Set(lines.map((l) => l.campaign_id)).size,
    impressions: sumLineImpressions(lines),
    totalDurationSeconds: Math.floor(Math.max(0, totalPlayedMs) / 1000),
  };
}
