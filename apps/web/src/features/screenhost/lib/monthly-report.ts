/**
 * Monthly-report download — pure month logic + the imperative PDF fetch.
 *
 * The owner dashboard lets a screenhost owner download the branded monthly-report PDF for one of
 * their venues. The backend (GET /api/screenhosts/:id/monthly-report?month=YYYY-MM) is owner-scoped
 * server-side (WHERE ownerId = session.user.id) and streams a `application/pdf` body, so this module
 * must bypass the JSON-only apiClient (which JSON.parses every 2xx body and would corrupt the PDF)
 * and use a RAW credentialed fetch + object-URL, mirroring the invoice-PDF download.
 *
 * `lastCompleteMonth` is pure and unit-tested; `downloadMonthlyReport` does the fetch and is
 * exercised by build + logic only (no web render harness).
 */

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * The last *complete* calendar month as 'YYYY-MM' — i.e. the previous calendar month relative to
 * `now`. The current (in-progress) month is never complete, so the hub may have pushed no stats row
 * for it yet; defaulting to the previous month maximises the chance a report already exists.
 *
 * PURE. Uses LOCAL calendar fields consistently (matches a native `<input type="month">`, whose
 * value is the user's local YYYY-MM). January rolls back to the previous year's December.
 */
export function lastCompleteMonth(now: Date = new Date()): string {
  const year = now.getFullYear();
  const monthIndex = now.getMonth(); // 0 = January … 11 = December (the *current* month)
  const prevYear = monthIndex === 0 ? year - 1 : year;
  const prevMonthIndex = monthIndex === 0 ? 11 : monthIndex - 1; // 0..11
  const mm = String(prevMonthIndex + 1).padStart(2, '0');
  return `${prevYear}-${mm}`;
}

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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Only ever createObjectURL on a 2xx body — never on a 404/error JSON body.
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapport-${month}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return 'ok';
}
