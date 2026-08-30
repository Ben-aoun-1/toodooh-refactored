import { format, isValid, parseISO } from 'date-fns';

/**
 * ADM-1 — the admin listings' date rendering (date-fns only, per the engineering rules; the
 * legacy pages called `toLocaleDateString` on a hand-built Date). An unparsable ISO string
 * renders as « — » rather than « Invalid Date ».
 */
function formatIso(iso: string, pattern: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, pattern) : '—';
}

/** « 30/08/2026 » */
export function formatAdminDate(iso: string): string {
  return formatIso(iso, 'dd/MM/yyyy');
}

/** « 30/08/2026 13:05 » */
export function formatAdminDateTime(iso: string): string {
  return formatIso(iso, 'dd/MM/yyyy HH:mm');
}
