import type { DateRange } from './performance-period';

/**
 * Period-report download (R1) — pure URL/filename logic + the imperative PDF fetch.
 *
 * The bottom "Télécharger le rapport (PDF)" button downloads the ON-DEMAND period report for the
 * page's ACTIVE filter range (GET /api/screenhosts/:id/report?from&to — owner-scoped server-side,
 * live chromium render, ephemeral). Mirrors the downloadMonthlyReport pattern: a RAW credentialed
 * fetch + object-URL (the JSON-only apiClient would corrupt a PDF body). The monthly card /
 * history buttons are UNTOUCHED — they keep hitting /monthly-report (the stored artifact).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** PURE — the endpoint path for one venue/range (unit-tested; encodeURIComponent both ends). */
export function periodReportPath(screenhostId: string, range: DateRange): string {
  return `/api/screenhosts/${screenhostId}/report?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
}

/** PURE — the saved filename ('rapport-2026-06-01_2026-06-30.pdf'). */
export function periodReportFilename(range: DateRange): string {
  return `rapport-${range.from}_${range.to}.pdf`;
}

/**
 * Download the period-report PDF for `screenhostId` over the inclusive `range`.
 *
 * - Rejects a malformed range client-side (never round-trips to a 400).
 * - Throws on any non-2xx (incl. the endpoint's explicit 503 REPORT_RENDER_FAILED) — the caller
 *   shows its retry toast.
 * - Forces a save via an `<a download>` + object-URL (revoked afterwards) on success.
 *
 * Must be called only on an explicit user action (button click) — never on mount or filter change.
 */
export async function downloadPeriodReport(screenhostId: string, range: DateRange): Promise<'ok'> {
  if (!DATE_RE.test(range.from) || !DATE_RE.test(range.to)) {
    throw new Error(`invalid range: ${range.from} – ${range.to}`);
  }

  const res = await fetch(periodReportPath(screenhostId, range), { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = periodReportFilename(range);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return 'ok';
}
