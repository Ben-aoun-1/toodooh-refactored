import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import { notifications, screenhostMonthlyReports, screenhosts } from '../../db/schema.js';
import { storage } from '../../storage/s3-storage.js';

import { assembleReportData } from './assemble.js';
import { pistesForReport } from './recommendations.js';
import { resolveChromiumPath, renderPdf } from './render.js';
import { renderReportHtml } from './template.js';

// Month-end report job (R1) — the house job pattern (mirror of the wedooh sweepUnexported boot +
// unref'd interval; NO cron dependency): every tick generates the PREVIOUS CLOSED MONTH's report
// for each venue with any data that does not have one yet, stores it in MinIO
// (reports/<venueId>/<YYYY-MM>.pdf), inserts the screenhost_monthly_reports row and notifies the
// owner (type 'monthly_report_ready' — the banked notifications hook). Idempotent: the UNIQUE
// (screenhost, month) row is checked up front AND enforced on insert (onConflictDoNothing), so a
// second tick — or a concurrent one — is a no-op. Backfill is the previous closed month ONLY.

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

export interface ClosedMonth {
  month: string; // 'YYYY-MM'
  from: string; // first day, 'YYYY-MM-DD'
  to: string; // last day, 'YYYY-MM-DD'
}

/**
 * The previous CLOSED month relative to `now`, in Africa/Tunis local time (the reconcile
 * convention): a month closes at LOCAL midnight, so 2026-07-01T00:30 Tunis (= 06-30T23:30Z)
 * already closes June. January rolls back to the previous year's December.
 */
export function previousClosedMonth(now: Date): ClosedMonth {
  const tunisToday = formatInTimeZone(now, 'Africa/Tunis', 'yyyy-MM-dd');
  const year = Number(tunisToday.slice(0, 4));
  const monthNum = Number(tunisToday.slice(5, 7)); // 1–12, the CURRENT Tunis month
  const prevYear = monthNum === 1 ? year - 1 : year;
  const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
  const mm = String(prevMonth).padStart(2, '0');
  // Day 0 of the CURRENT month = the last day of the previous month (UTC-safe: fixed fields).
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  return {
    month: `${prevYear}-${mm}`,
    from: `${prevYear}-${mm}-01`,
    to: `${prevYear}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * The calendar bounds of a 'YYYY-MM' key — the same `from`/`to` `previousClosedMonth` returns for
 * that month, derived from the key alone rather than from a clock.
 *
 * REV2 commit 3 needs this: the sweep knows its window because it just computed it, but a facture
 * READ knows only the month stored on the row, and both must aggregate over exactly the same days
 * or the document and the screen could disagree.
 */
export function monthBounds(month: string): ClosedMonth {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return {
    month,
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** French month label ('2026-06' → 'juin 2026') — exported for the FCT2 billing documents. */
export const monthLabelFr = (month: string): string => {
  const name = MONTHS_FR[Number(month.slice(5, 7)) - 1] ?? month;
  return `${name} ${month.slice(0, 4)}`;
};

export interface SweepResult {
  month: string;
  generated: number;
  skipped: number;
  failed: number;
}

/**
 * One sweep tick. Failure isolation: a venue's assemble/render/store failure logs + continues —
 * one broken venue never starves the fleet. When NO chromium exists on the machine, the sweep
 * warns once and bails (nothing would render).
 */
export async function runMonthlyReportSweep(
  log: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<SweepResult> {
  const { month, from, to } = previousClosedMonth(now);
  const result: SweepResult = { month, generated: 0, skipped: 0, failed: 0 };

  if (resolveChromiumPath() === null) {
    log.warn('monthly report sweep skipped: no chromium executable on this machine');
    return result;
  }

  // "Each venue with any data": one EXISTS-driven scan — a venue qualifies when ANY of the four
  // data sources has at least one row for it (monthly stats / affluence / payouts / proofs).
  const candidates = await db
    .select({ id: screenhosts.id, ownerId: screenhosts.ownerId, name: screenhosts.name })
    .from(screenhosts)
    .where(
      sql`EXISTS (SELECT 1 FROM screenhost_monthly_stats s WHERE s.screenhost_id = ${screenhosts.id})
        OR EXISTS (SELECT 1 FROM screenhost_affluence a WHERE a.screenhost_id = ${screenhosts.id})
        OR EXISTS (SELECT 1 FROM campaign_screenhost_payout p WHERE p.screenhost_id = ${screenhosts.id})
        OR EXISTS (SELECT 1 FROM proof_of_play pp WHERE pp.screenhost_id = ${screenhosts.id})`,
    );

  for (const venue of candidates) {
    try {
      const [existing] = await db
        .select({ id: screenhostMonthlyReports.id })
        .from(screenhostMonthlyReports)
        .where(
          and(
            eq(screenhostMonthlyReports.screenhostId, venue.id),
            eq(screenhostMonthlyReports.month, month),
          ),
        )
        .limit(1);
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const data = await assembleReportData(venue.id, { from, to });
      if (!data) continue; // venue vanished mid-sweep
      // R2 — generated ONCE here and frozen into the stored PDF (no cache). A generator failure
      // of ANY kind resolves to null → the generic pistes; it can never fail the report.
      const aiPistes = await pistesForReport(data).catch(() => null);
      const pdf = await renderPdf(renderReportHtml(data, { aiPistes }));

      const key = `reports/${venue.id}/${month}.pdf`;
      const uploaded = await storage.upload({ key, body: pdf, contentType: 'application/pdf' });
      if ('error' in uploaded) throw new Error(`storage upload failed: ${uploaded.error}`);

      // UNIQUE(screenhost, month) makes a concurrent tick lose here — no row returned → no
      // duplicate notification either.
      const inserted = await db
        .insert(screenhostMonthlyReports)
        .values({ screenhostId: venue.id, month, storageKey: key })
        .onConflictDoNothing()
        .returning({ id: screenhostMonthlyReports.id });
      if (inserted.length === 0) {
        result.skipped += 1;
        continue;
      }

      if (venue.ownerId) {
        await db.insert(notifications).values({
          userId: venue.ownerId,
          type: 'monthly_report_ready',
          title: 'Votre rapport mensuel est disponible',
          body: `Le rapport de ${monthLabelFr(month)} pour « ${venue.name} » est prêt à consulter et télécharger.`,
        });
      }
      result.generated += 1;
    } catch (err) {
      result.failed += 1;
      log.warn({ err, screenhostId: venue.id, month }, 'monthly report generation failed');
    }
  }

  if (result.generated > 0 || result.failed > 0) {
    log.info(result, 'monthly report sweep done');
  }
  return result;
}

/** Boot + hourly unref'd interval (the sweepUnexported pattern) — never holds the process open. */
export function startMonthlyReportJob(log: FastifyBaseLogger): void {
  void runMonthlyReportSweep(log).catch((err: unknown) =>
    log.warn({ err }, 'monthly report boot sweep failed'),
  );
  const timer = setInterval(
    () => {
      void runMonthlyReportSweep(log).catch((err: unknown) =>
        log.warn({ err }, 'monthly report sweep failed'),
      );
    },
    60 * 60 * 1000,
  );
  timer.unref();
}
