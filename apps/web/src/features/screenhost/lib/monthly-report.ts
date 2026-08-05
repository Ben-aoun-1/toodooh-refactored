/**
 * Monthly-report download — the imperative PDF fetch.
 *
 * The owner dashboard lets a screenhost owner download the branded monthly-report PDF for one of
 * their venues. The backend (GET /api/screenhosts/:id/monthly-report?month=YYYY-MM) is owner-scoped
 * server-side (WHERE ownerId = session.user.id) and streams a `application/pdf` body, so this module
 * must bypass the JSON-only apiClient (which JSON.parses every 2xx body and would corrupt the PDF)
 * and use a RAW credentialed fetch + object-URL, mirroring the invoice-PDF download.
 *
 * PERF-QA1 R1 retired `lastCompleteMonth`: callers now pick a month from the generated-reports
 * LISTING (GET /:id/reports) instead of guessing the previous calendar month.
 */

import { filenameFromContentDisposition } from './download-filename';
import { ReportDownloadError } from './period-report';

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Download the monthly-report PDF for `screenhostId` / `month` (a 'YYYY-MM' string).
 *
 * - Triggers a raw, credentialed same-origin fetch so the better-auth `Lax` session cookie
 *   authenticates the owner-scoped endpoint; never uses apiClient (JSON-only — would corrupt a PDF).
 * - Returns `'no-data'` on 404 (no hub-pushed stats for that venue/month yet — the caller shows a
 *   friendly notice and we do NOT createObjectURL on the JSON error body).
 * - Returns `'ok'` after forcing a save via an `<a download>` + object-URL (revoked afterwards).
 * - Throws on any other non-2xx (or a malformed `month`, guarded client-side to avoid a wasted 400).
 *
 * Must be called only on an explicit user action (button click) — never on mount or selection change.
 */
export async function downloadMonthlyReport(
  screenhostId: string,
  month: string,
): Promise<'ok' | 'no-data'> {
  // <input type="month"> degrades to a plain text field on older Safari/Firefox; reject a malformed
  // month here so we never round-trip to a 400.
  if (!MONTH_RE.test(month)) {
    throw new Error(`invalid month: ${month}`);
  }

  const res = await fetch(
    `/api/screenhosts/${screenhostId}/monthly-report?month=${encodeURIComponent(month)}`,
    { credentials: 'include' },
  );

  if (res.status === 404) return 'no-data';
  if (!res.ok) {
    // PERF-QA1 R4 — surface the api's failure class (e.g. REPORT_STORAGE_UNAVAILABLE) so the
    // caller can show per-class copy instead of the one generic toast.
    let code: string | null = null;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'error' in body) {
        const raw = (body as { error: unknown }).error;
        code = typeof raw === 'string' ? raw : null;
      }
    } catch {
      code = null;
    }
    throw new ReportDownloadError(code ?? `HTTP_${res.status}`, res.status);
  }

  // PERF-QA1 R3 — the saved name comes from the api's content-disposition (it carries the venue
  // slug); the legacy month-only name is the fallback.
  const filename =
    filenameFromContentDisposition(res.headers.get('content-disposition')) ??
    `rapport-${month}.pdf`;
  // Only ever createObjectURL on a 2xx body — never on a 404/error JSON body.
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
