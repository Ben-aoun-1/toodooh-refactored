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
// unref'd interval; NO cron dependency): every tick generates the missing monthly reports
// for each venue with any data, stores them in MinIO (reports/<venueId>/<YYYY-MM>.pdf), inserts
// the screenhost_monthly_reports row and notifies the owner (type 'monthly_report_ready' — the
// banked notifications hook). Idempotent: the UNIQUE (screenhost, month) row is checked up front
// AND enforced on insert (onConflictDoNothing), so a second tick — or a concurrent one — is a
// no-op. PERF-QA1 R2 — bounded catch-up: each tick considers the LAST 3 CLOSED MONTHS (same
// idempotency per month), so a month the sweep missed (api down over a month boundary, chromium
// absent…) self-heals within the window instead of being lost forever.
// R2 AMENDMENT (ratified 2026-08-05) — catch-up must not burst: only the PREVIOUS CLOSED month
// notifies; older catch-up months generate SILENTLY (they surface in the reports listing with
// their real generated_at — nobody gets a « rapport de mai est prêt » in August) and ONLY when
// the venue has MONTH-SCOPED data for that month (a hub-pushed stats row, or ≥1 proof inside the
// month's Tunis bounds) — no fabricated near-empty backdated PDFs. The previous-closed-month
// path keeps the ruled LIFETIME candidate gates + its notification, unchanged.

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
  /** The closed months this tick considered, newest first (PERF-QA1 R2 bounded catch-up). */
  months: string[];
  generated: number;
  skipped: number;
  failed: number;
  /** INV-1 — expensive-path entries this tick (assemble + AI + render), successes AND failures. */
  attempts: number;
  /** INV-1 — true when the attempt cap ended the tick early; idempotency resumes next tick. */
  capped: boolean;
}

/** R2 — how far back a tick self-heals: the last 3 closed months. */
export const CATCH_UP_MONTHS = 3;

/**
 * INV-1 — hard per-tick bound on the EXPENSIVE path (assemble + AI pistes + chromium render +
 * upload), counted per venue×month the moment it passes the exists/gate checks, success or
 * failure alike. Unbounded, a first catch-up tick over a fleet of back-months renders for tens
 * of minutes on the colocated box (the 2026-08-07 degradation window), and a permanently-failing
 * item would re-burn its 30 s render ceiling EVERY tick. Deferred items are NOT failures — the
 * exists-check resumes them on the next hourly tick.
 */
export const MAX_SWEEP_ATTEMPTS_PER_TICK = 8;

/** The last `count` closed months relative to `now`, newest first (Tunis month close). */
export function lastClosedMonths(now: Date, count: number): ClosedMonth[] {
  const months: ClosedMonth[] = [previousClosedMonth(now)];
  while (months.length < count) {
    const prev = months[months.length - 1];
    if (!prev) break;
    const year = Number(prev.month.slice(0, 4));
    const monthNum = Number(prev.month.slice(5, 7));
    const backYear = monthNum === 1 ? year - 1 : year;
    const backMonth = monthNum === 1 ? 12 : monthNum - 1;
    months.push(monthBounds(`${backYear}-${String(backMonth).padStart(2, '0')}`));
  }
  return months;
}

/**
 * R2 amendment — the catch-up gate: a NON-current month only generates over REAL month-scoped
 * data (a hub-pushed monthly_stats row for that month, or at least one proof_of_play received
 * inside the month's TUNIS bounds — the reconcile calendar). The previous closed month never
 * goes through this gate.
 */
async function hasMonthScopedData(
  venueId: string,
  month: string,
  from: string,
  to: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .where(
      and(
        eq(screenhosts.id, venueId),
        sql`(EXISTS (SELECT 1 FROM screenhost_monthly_stats s
              WHERE s.screenhost_id = ${screenhosts.id} AND s.month = ${month})
          OR EXISTS (SELECT 1 FROM proof_of_play pp
              WHERE pp.screenhost_id = ${screenhosts.id}
              AND to_char(pp.received_at at time zone 'Africa/Tunis', 'YYYY-MM-DD')
                BETWEEN ${from} AND ${to}))`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * One sweep tick over the last CATCH_UP_MONTHS closed months. Failure isolation: a venue×month's
 * assemble/render/store failure logs + continues — one broken venue never starves the fleet, and
 * a broken month never blocks the next one. When NO chromium exists on the machine, the sweep
 * warns once and bails (nothing would render).
 */
export async function runMonthlyReportSweep(
  log: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<SweepResult> {
  const startedAt = Date.now();
  const months = lastClosedMonths(now, CATCH_UP_MONTHS);
  const result: SweepResult = {
    months: months.map((m) => m.month),
    generated: 0,
    skipped: 0,
    failed: 0,
    attempts: 0,
    capped: false,
  };
  // INV-1 amendment — the tick summary is UNCONDITIONAL, on every path including early returns:
  // the 2026-08-07 incident tick left ZERO log lines, so its failure mode was invisible.
  const summarize = (candidates: number): void => {
    log.info(
      { ...result, candidates, durationMs: Date.now() - startedAt },
      'monthly report sweep done',
    );
  };

  if (resolveChromiumPath() === null) {
    log.warn('monthly report sweep skipped: no chromium executable on this machine');
    summarize(0);
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

  const currentMonth = months[0]?.month;
  sweep: for (const venue of candidates) {
    for (const { month, from, to } of months) {
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

        // R2 amendment — a catch-up month (anything but the previous closed month) generates
        // only over REAL month-scoped data; no fabricated backdated PDFs.
        if (month !== currentMonth && !(await hasMonthScopedData(venue.id, month, from, to))) {
          result.skipped += 1;
          continue;
        }

        // INV-1 — the expensive path is capped per tick; anything past the cap waits for the
        // next tick rather than extending this one.
        if (result.attempts >= MAX_SWEEP_ATTEMPTS_PER_TICK) {
          result.capped = true;
          break sweep;
        }
        result.attempts += 1;

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

        // R2 amendment — only the PREVIOUS CLOSED month notifies; a caught-up older month
        // surfaces in the listing (real generated_at) SILENTLY.
        if (month === currentMonth && venue.ownerId) {
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
  }

  summarize(candidates.length);
  return result;
}

let sweepInFlight = false;

/**
 * INV-1 — reentrancy guard around one tick: a sweep that outlives the hour must not overlap the
 * next interval firing (overlapping sweeps compound chromium + query load on the shared box —
 * correctness survives via the UNIQUE row, load does not). Returns null when the tick is skipped.
 */
export async function runGuardedSweep(log: FastifyBaseLogger): Promise<SweepResult | null> {
  if (sweepInFlight) {
    log.warn('monthly report sweep still running — tick skipped');
    return null;
  }
  sweepInFlight = true;
  try {
    return await runMonthlyReportSweep(log);
  } finally {
    sweepInFlight = false;
  }
}

/** Boot + hourly unref'd interval (the sweepUnexported pattern) — never holds the process open. */
export function startMonthlyReportJob(log: FastifyBaseLogger): void {
  void runGuardedSweep(log).catch((err: unknown) =>
    log.warn({ err }, 'monthly report boot sweep failed'),
  );
  const timer = setInterval(
    () => {
      void runGuardedSweep(log).catch((err: unknown) =>
        log.warn({ err }, 'monthly report sweep failed'),
      );
    },
    60 * 60 * 1000,
  );
  timer.unref();
}
