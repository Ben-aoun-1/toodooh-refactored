import { pathToFileURL } from 'node:url';

import { eq } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import { screenhostMonthlyReports, screenhosts } from '../src/db/schema.js';
import { assembleReportData } from '../src/lib/report/assemble.js';
import { pistesForReport } from '../src/lib/report/recommendations.js';
import { renderPdf, resolveChromiumPath } from '../src/lib/report/render.js';
import { renderReportHtml } from '../src/lib/report/template.js';
import { storage } from '../src/storage/s3-storage.js';

// One-shot restyle regeneration (R1.5): re-render EVERY stored monthly report with the current
// document template, overwriting the MinIO object at its EXISTING storage_key and bumping
// generated_at. Deliberately NOT the month-end job: the job's no-row-exists guard is untouched
// and no notification is inserted here — owners must not be re-notified for a restyle. Operator-
// run on the box at deploy (usage: pnpm reports:regenerate [--dry-run]).
//
// Caveat (operator-accepted): the S02 heatmap reads the venue's CURRENT affluence window, so a
// regenerated report reflects the regeneration date's rolling window, not the original one.

export interface RegenTarget {
  screenhostId: string;
  venueName: string;
  month: string; // 'YYYY-MM'
  storageKey: string;
}

export interface RegenResult {
  scanned: number;
  regenerated: number;
  failed: number;
  /** What a --dry-run would (or a real run did) target, in stable month/name order. */
  targets: RegenTarget[];
}

/** Minimal pino-shaped seam so tests stay silent and the CLI logs via console. */
export interface RegenLog {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

/** Inclusive day bounds of a stored report's 'YYYY-MM' month (UTC-safe: fixed fields). */
export function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Regenerate every stored monthly report. Failure isolation mirrors the sweep: one venue's
 * assemble/render/store failure logs + continues. Dry-run only lists (no chromium needed).
 */
export async function regenerateStoredReports(
  log: RegenLog,
  opts: { dryRun?: boolean } = {},
): Promise<RegenResult> {
  const rows = await db
    .select({
      id: screenhostMonthlyReports.id,
      screenhostId: screenhostMonthlyReports.screenhostId,
      month: screenhostMonthlyReports.month,
      storageKey: screenhostMonthlyReports.storageKey,
      venueName: screenhosts.name,
    })
    .from(screenhostMonthlyReports)
    .innerJoin(screenhosts, eq(screenhosts.id, screenhostMonthlyReports.screenhostId))
    .orderBy(screenhostMonthlyReports.month, screenhosts.name);

  const result: RegenResult = {
    scanned: rows.length,
    regenerated: 0,
    failed: 0,
    targets: rows.map(({ screenhostId, venueName, month, storageKey }) => ({
      screenhostId,
      venueName,
      month,
      storageKey,
    })),
  };
  if (opts.dryRun) return result;

  if (rows.length > 0 && resolveChromiumPath() === null) {
    throw new Error('no chromium executable (set CHROMIUM_PATH or PUPPETEER_EXECUTABLE_PATH)');
  }

  for (const row of rows) {
    try {
      const data = await assembleReportData(row.screenhostId, monthBounds(row.month));
      if (!data) throw new Error('venue vanished mid-run');
      // R2 — same frozen seam as the month-end job (uncached; consistent with restyle-in-place).
      const aiPistes = await pistesForReport(row.screenhostId, data).catch(() => null);
      const pdf = await renderPdf(renderReportHtml(data, { aiPistes }));

      // SAME key on purpose — S3/MinIO PUT overwrites in place; nothing else moves.
      const uploaded = await storage.upload({
        key: row.storageKey,
        body: pdf,
        contentType: 'application/pdf',
      });
      if ('error' in uploaded) throw new Error(`storage upload failed: ${uploaded.error}`);

      // By row id — a venue can hold several stored months; only THIS one was regenerated.
      await db
        .update(screenhostMonthlyReports)
        .set({ generatedAt: new Date() })
        .where(eq(screenhostMonthlyReports.id, row.id));
      result.regenerated += 1;
      log.info(
        { screenhostId: row.screenhostId, month: row.month, key: row.storageKey },
        'report regenerated',
      );
    } catch (err) {
      result.failed += 1;
      log.warn(
        { err, screenhostId: row.screenhostId, month: row.month },
        'report regeneration failed',
      );
    }
  }
  return result;
}

// Side-effecting entry guarded so the module is importable by tests without running.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  regenerateStoredReports(console, { dryRun })
    .then(async (result) => {
      if (dryRun) {
        console.info(`dry-run: ${result.scanned} stored report(s) would regenerate`);
        for (const t of result.targets) {
          console.info(`  ${t.month}  ${t.venueName}  →  ${t.storageKey}`);
        }
      } else {
        console.info(
          `done: ${result.regenerated}/${result.scanned} regenerated, ${result.failed} failed`,
        );
      }
      await sql.end();
      process.exit(result.failed > 0 ? 1 : 0);
    })
    .catch(async (err) => {
      console.error('regenerate-monthly-reports failed', err instanceof Error ? err.message : err);
      await sql.end();
      process.exit(1);
    });
}
