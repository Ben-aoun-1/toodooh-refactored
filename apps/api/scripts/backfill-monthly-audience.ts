import { pathToFileURL } from 'node:url';

import { addMonths, format, parseISO } from 'date-fns';
import { and, eq, inArray, min } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import {
  type MonthlyStatsDaily,
  screenhostAffluence,
  screenhostMonthlyStats,
  screenhosts,
} from '../src/db/schema.js';
import { gridPeaks, mergeMonthlyAudience } from '../src/lib/monthly-audience.js';
import { PLAYOUT_TZ } from '../src/lib/reconcile/delivered-slots.js';

// PERF-QA2 — the monthly-audience backfill. The ingest merges every NEW hub push against the
// venue's affluence grid (measured day wins, estimate otherwise); this walks BACKWARD over
// history so « Personnes touchées » stops reading 0 on data already in the database.
//
// A JOB, NOT A MIGRATION (ruled 2026-08-20): prod migrations run on service start, and an
// audience rewrite must never ride a deploy unseen. So this follows the SETTLE1 idiom — DRY-RUN
// by default, printing the full per-venue before/after inventory and writing nothing; --execute
// performs the writes.
//
// SCOPE: venues that have an affluence grid. Per the same ruling, a MISSING venue-month row is
// created (source-stamped estimated) rather than skipped — under the one-source contract the
// estimate IS the data, and a missing row only means the hub job never ran for that month. The
// walk is bounded to the venue's GRID LIFETIME: from the Tunis month of the earliest
// screenhost_affluence row (the month the hub first knew this venue's pattern) through the
// current Tunis month. Nothing is invented before the grid existed.
//
// IDEMPOTENT: mergeMonthlyAudience keeps measured days and recomputes estimated days from the
// same grid, so a second run over a closed month reports `unchanged` and writes nothing. The
// current month legitimately grows by one day per day — that is the rule working, not drift.
//
// Usage:  pnpm --filter @toodooh/api audience:backfill
//         pnpm --filter @toodooh/api audience:backfill -- --execute
//         ... -- --venue <screenhost-uuid>

export type RowAction = 'create' | 'update' | 'unchanged';

/** The report's counter for an action — the plural key, so the totals read as English. */
const COUNTER: Record<RowAction, 'created' | 'updated' | 'unchanged'> = {
  create: 'created',
  update: 'updated',
  unchanged: 'unchanged',
};

export interface BackfillRow {
  screenhostId: string;
  venueName: string;
  month: string;
  action: RowAction;
  /** Stored total before this run (null when no row exists yet). */
  beforeTotal: number | null;
  afterTotal: number;
  measuredDays: number;
  estimatedDays: number;
}

export interface BackfillReport {
  today: string;
  venuesScanned: number;
  rows: BackfillRow[];
  totals: { created: number; updated: number; unchanged: number };
}

/** The Tunis calendar date (YYYY-MM-DD) of an instant — the reconcile convention. */
const tunisDateOf = (instant: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: PLAYOUT_TZ }).format(instant);

/** Every 'YYYY-MM' from `from` through `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  if (from > to) return [];
  const months: string[] = [];
  let cursor = parseISO(`${from}-01`);
  for (let guard = 0; guard < 600; guard += 1) {
    const month = format(cursor, 'yyyy-MM');
    if (month > to) break;
    months.push(month);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

const sameDaily = (a: MonthlyStatsDaily[], b: MonthlyStatsDaily[]): boolean =>
  a.length === b.length &&
  a.every((entry, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      other.date === entry.date &&
      other.audience === entry.audience &&
      other.source === entry.source
    );
  });

/**
 * The inventory (and, with `execute`, the writes). One venue at a time, one month at a time — a
 * venue with a broken grid can never poison another's numbers.
 */
export async function runMonthlyAudienceBackfill(
  now: Date = new Date(),
  opts: { execute?: boolean; onlyVenue?: string } = {},
): Promise<BackfillReport> {
  const today = tunisDateOf(now);
  const currentMonth = today.slice(0, 7);

  // Venues WITH a grid, and the month their grid first appeared (its lifetime start).
  const gridStarts = await db
    .select({
      screenhostId: screenhostAffluence.screenhostId,
      firstSeen: min(screenhostAffluence.createdAt),
    })
    .from(screenhostAffluence)
    .groupBy(screenhostAffluence.screenhostId);
  const scoped = opts.onlyVenue
    ? gridStarts.filter((g) => g.screenhostId === opts.onlyVenue)
    : gridStarts;

  const report: BackfillReport = {
    today,
    venuesScanned: scoped.length,
    rows: [],
    totals: { created: 0, updated: 0, unchanged: 0 },
  };
  if (scoped.length === 0) return report;

  const names = new Map(
    (
      await db
        .select({ id: screenhosts.id, name: screenhosts.name })
        .from(screenhosts)
        .where(
          inArray(
            screenhosts.id,
            scoped.map((g) => g.screenhostId),
          ),
        )
    ).map((v) => [v.id, v.name]),
  );

  for (const venue of scoped) {
    const slots = await db
      .select({
        dayOfWeek: screenhostAffluence.dayOfWeek,
        hour: screenhostAffluence.hour,
        estimatedImpressions: screenhostAffluence.estimatedImpressions,
      })
      .from(screenhostAffluence)
      .where(eq(screenhostAffluence.screenhostId, venue.screenhostId));
    const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const slot of slots) {
      const row = grid[slot.dayOfWeek - 1];
      if (row && slot.hour >= 0 && slot.hour <= 23) row[slot.hour] = slot.estimatedImpressions;
    }

    const existing = await db
      .select({
        month: screenhostMonthlyStats.month,
        totalAudience: screenhostMonthlyStats.totalAudience,
        daily: screenhostMonthlyStats.daily,
      })
      .from(screenhostMonthlyStats)
      .where(eq(screenhostMonthlyStats.screenhostId, venue.screenhostId));
    const stored = new Map(existing.map((row) => [row.month, row]));

    const firstSeen = venue.firstSeen instanceof Date ? venue.firstSeen : new Date();
    const startMonth = tunisDateOf(firstSeen).slice(0, 7);
    // A stored month OLDER than the grid's first sighting still gets refreshed: the grid is the
    // venue's pattern, and a hub row that already exists is in scope by definition.
    const oldestStored = existing.map((r) => r.month).sort()[0];
    const from = oldestStored && oldestStored < startMonth ? oldestStored : startMonth;

    for (const month of monthsBetween(from, currentMonth)) {
      const row = stored.get(month);
      const merged = mergeMonthlyAudience({
        month,
        measured: row?.daily ?? [],
        grid,
        todayIso: today,
      });
      // Never CREATE an empty row: a venue-month the estimate values at zero carries no
      // information the absence of a row does not already carry.
      if (!row && merged.totalAudience === 0) continue;

      // SURGICAL SCOPE: a stored month no estimate can improve — every day measured, or a grid
      // that values the gaps at zero — is LEFT EXACTLY AS THE HUB WROTE IT, total included. This
      // walk replaces missing measurements with estimates; it does not recompute the hub's own
      // arithmetic, so the banked DATA1 summarize-mismatch (a hub total differing from Σ of its
      // own days) stays observable instead of being silently normalised here.
      const substituted = merged.daily.some((d) => d.source === 'estimated' && d.audience > 0);
      if (row && !substituted) {
        report.rows.push({
          screenhostId: venue.screenhostId,
          venueName: names.get(venue.screenhostId) ?? '—',
          month,
          action: 'unchanged',
          beforeTotal: row.totalAudience,
          afterTotal: row.totalAudience,
          measuredDays: merged.daily.filter((d) => d.source === 'measured').length,
          estimatedDays: merged.daily.filter((d) => d.source === 'estimated').length,
        });
        report.totals.unchanged += 1;
        continue;
      }

      const unchanged =
        row !== undefined &&
        row.totalAudience === merged.totalAudience &&
        sameDaily(row.daily, merged.daily);
      const action: RowAction = unchanged ? 'unchanged' : row ? 'update' : 'create';
      report.rows.push({
        screenhostId: venue.screenhostId,
        venueName: names.get(venue.screenhostId) ?? '—',
        month,
        action,
        beforeTotal: row?.totalAudience ?? null,
        afterTotal: merged.totalAudience,
        measuredDays: merged.daily.filter((d) => d.source === 'measured').length,
        estimatedDays: merged.daily.filter((d) => d.source === 'estimated').length,
      });
      report.totals[COUNTER[action]] += 1;

      if (!opts.execute || unchanged) continue;
      if (row) {
        await db
          .update(screenhostMonthlyStats)
          .set({
            totalAudience: merged.totalAudience,
            daily: merged.daily,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(screenhostMonthlyStats.screenhostId, venue.screenhostId),
              eq(screenhostMonthlyStats.month, month),
            ),
          );
      } else {
        const peaks = gridPeaks(grid);
        await db
          .insert(screenhostMonthlyStats)
          .values({
            screenhostId: venue.screenhostId,
            month,
            totalAudience: merged.totalAudience,
            daily: merged.daily,
            peakDayOfWeek: peaks.peakDayOfWeek,
            peakHour: peaks.peakHour,
          })
          .onConflictDoUpdate({
            target: [screenhostMonthlyStats.screenhostId, screenhostMonthlyStats.month],
            set: {
              totalAudience: merged.totalAudience,
              daily: merged.daily,
              updatedAt: new Date(),
            },
          });
      }
    }
  }
  return report;
}

// ── CLI (console permitted under scripts/) ────────────────────────────────────────────────────
const printReport = (report: BackfillReport, execute: boolean): void => {
  console.info(
    `PERF-QA2 monthly-audience backfill — Tunis today ${report.today} · venues with a grid: ${report.venuesScanned}`,
  );
  for (const row of report.rows) {
    console.info(
      `  [${row.action}] ${row.venueName} (${row.screenhostId}) ${row.month}: ` +
        `${row.beforeTotal ?? '—'} → ${row.afterTotal} pers. ` +
        `(${row.measuredDays} j mesurés / ${row.estimatedDays} j estimés)`,
    );
  }
  console.info(
    `Σ ${execute ? 'written' : 'would write'} — create ${report.totals.created} · update ${report.totals.updated} · unchanged ${report.totals.unchanged}`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const venueIdx = args.indexOf('--venue');
  const onlyVenue = venueIdx >= 0 ? args[venueIdx + 1] : undefined;

  (async () => {
    const report = await runMonthlyAudienceBackfill(new Date(), { execute, onlyVenue });
    printReport(report, execute);
    if (!execute) {
      console.info('DRY-RUN — nothing written. Re-run with --execute to persist.');
    }
    await sql.end();
    process.exit(0);
  })().catch(async (err) => {
    console.error('audience:backfill failed:', err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
}
