import { format, subDays } from 'date-fns';

import { filenameFromContentDisposition } from './download-filename';
import type { DateRange } from './performance-period';

/**
 * Period-report download (R1) — pure URL/filename/clamp logic + the imperative PDF fetch.
 *
 * The bottom "Télécharger le rapport (PDF)" button downloads the ON-DEMAND period report for the
 * page's ACTIVE filter range (GET /api/screenhosts/:id/report?from&to — owner-scoped server-side,
 * live chromium render, ephemeral). Mirrors the downloadMonthlyReport pattern: a RAW credentialed
 * fetch + object-URL (the JSON-only apiClient would corrupt a PDF body). The monthly card /
 * history buttons are UNTOUCHED — they keep hitting /monthly-report (the stored artifact).
 *
 * PERF-QA1 R4 — « Depuis le début » must WORK, honestly: the api bounds the range to 400 days,
 * so the request is CLAMPED to the newest 400 days client-side (the UI shows the clamped range)
 * instead of round-tripping to a guaranteed 400 rendered as a generic failure (the confirmed
 * Mejri repro). Every failure class then gets its own copy via reportErrorMessageFr.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The api's inclusive range bound (screenhosts.ts — spanDays ≤ 400). */
export const REPORT_MAX_SPAN_DAYS = 400;

/** PURE — the endpoint path for one venue/range (unit-tested; encodeURIComponent both ends). */
export function periodReportPath(screenhostId: string, range: DateRange): string {
  return `/api/screenhosts/${screenhostId}/report?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
}

/** PURE — the legacy fallback filename when the api sends no content-disposition. */
export function periodReportFilename(range: DateRange): string {
  return `rapport-${range.from}_${range.to}.pdf`;
}

/**
 * R4 — clamp a requested range to the api's 400-day bound, anchored on `today` (the Tunis
 * anchor). Returns the requestable range + whether it was clamped; null when the WHOLE period
 * is older than the window (nothing requestable — the caller shows the range copy, no fetch).
 */
export function clampRangeForReport(
  range: DateRange,
  today: Date,
): { range: DateRange; clamped: boolean } | null {
  const floor = format(subDays(today, REPORT_MAX_SPAN_DAYS - 1), 'yyyy-MM-dd');
  if (range.to < floor) return null;
  if (range.from >= floor) return { range, clamped: false };
  return { range: { from: floor, to: range.to }, clamped: true };
}

/** A typed download failure: `code` is the api's error code ('HTTP_<status>' when bodyless). */
export class ReportDownloadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`report download failed: ${code} (HTTP ${status})`);
    this.name = 'ReportDownloadError';
  }
}

/** Client-side code for a period entirely older than the api window (no fetch happens). */
export const OUT_OF_WINDOW = 'RANGE_OUT_OF_WINDOW';

/**
 * R4 — one FR message per failure class, replacing the single generic toast. Unknown codes keep
 * the generic copy (the honest default).
 */
export function reportErrorMessageFr(code: string | null): string {
  switch (code) {
    case OUT_OF_WINDOW:
      return 'Cette période est plus ancienne que la fenêtre de rapport (400 derniers jours).';
    case 'RANGE_TOO_WIDE':
      return 'La période demandée dépasse la fenêtre de rapport (400 jours). Réduisez la période.';
    case 'REPORT_RENDER_FAILED':
      return 'La génération du rapport est momentanément indisponible. Réessayez dans quelques instants.';
    case 'REPORT_STORAGE_UNAVAILABLE':
      return 'Le rapport est momentanément inaccessible. Réessayez dans quelques instants.';
    default:
      return 'Échec du téléchargement. Veuillez réessayer.';
  }
}

/** Best-effort error-code extraction from a non-2xx JSON body; null when unreadable. */
async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body) {
      const code = (body as { error: unknown }).error;
      return typeof code === 'string' ? code : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Download the period-report PDF for `screenhostId` over the inclusive `range`.
 *
 * - Rejects a malformed range client-side (never round-trips to a 400).
 * - Throws ReportDownloadError with the api's error CODE on any non-2xx — the caller maps it to
 *   per-class copy via reportErrorMessageFr.
 * - The saved filename comes from the api's content-disposition (R3 — it carries the venue
 *   slug); the legacy range-only name is the fallback.
 * - Forces a save via an `<a download>` + object-URL (revoked afterwards) on success.
 *
 * Must be called only on an explicit user action (button click) — never on mount or filter change.
 */
export async function downloadPeriodReport(screenhostId: string, range: DateRange): Promise<'ok'> {
  if (!DATE_RE.test(range.from) || !DATE_RE.test(range.to)) {
    throw new Error(`invalid range: ${range.from} – ${range.to}`);
  }

  const res = await fetch(periodReportPath(screenhostId, range), { credentials: 'include' });
  if (!res.ok)
    throw new ReportDownloadError((await errorCodeOf(res)) ?? `HTTP_${res.status}`, res.status);

  const filename =
    filenameFromContentDisposition(res.headers.get('content-disposition')) ??
    periodReportFilename(range);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return 'ok';
}
