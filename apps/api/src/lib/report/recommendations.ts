import { logger } from '../../logger.js';

import { type ReportData } from './assemble.js';
import { isPiste02Enabled, resetPiste02ClientForTests } from './piste02/generate.js';
import { ensureMonthPiste02, latestPiste02 } from './piste02/store.js';

const log = logger.child({ module: 'report-recommendations' });

// THE seam between the report surfaces and the Piste 02 generator — the month-end job, the
// regeneration script, the on-demand PDF and the page's /pistes read all come through here, and
// the tests mock exactly these names. PISTES-V2 (operator 2026-10-12) replaced the R3 haiku
// paragraph with the spec'd generator in ./piste02/ (docs/specs/piste-02-angles-morts.md),
// generated ONCE per completed month and stored. HARD CONTRACT unchanged: nothing here throws into
// a report path; every failure resolves to null and Piste 02 keeps its « À venir » wait state.

/** Whether the feature is on — the boot warning seam (mirrors isSyncEnabled). */
export const isRecommendationsEnabled = (): boolean => isPiste02Enabled();

/**
 * Frozen path (month-end job + regeneration script): the stored Piste 02 body of the report's
 * MONTH (data.range is a whole calendar month there), generated and stored on first use.
 */
export async function pistesForReport(venueId: string, data: ReportData): Promise<string | null> {
  try {
    const row = await ensureMonthPiste02(venueId, data.range.from.slice(0, 7), data);
    return row?.corps ?? null;
  } catch (err) {
    log.warn(
      { reason: err instanceof Error ? err.message : String(err) },
      'piste 02 unavailable — the wait state stays',
    );
    return null;
  }
}

/**
 * Display path (GET /:id/pistes, the on-demand GET /:id/report): the venue's LAST stored month,
 * whatever période the owner picked (Q10 A — the piste describes a complete month). Read-only:
 * the model never runs on a page load. The name predates PISTES-V2 and is kept for the mocks.
 */
export async function pistesForReportCached(venueId: string): Promise<string | null> {
  try {
    return (await latestPiste02(venueId))?.corps ?? null;
  } catch {
    return null;
  }
}

/** Test hook — drops the lazy client (mirrors closeReportBrowser). */
export function resetRecommendationsForTests(): void {
  resetPiste02ClientForTests();
}
