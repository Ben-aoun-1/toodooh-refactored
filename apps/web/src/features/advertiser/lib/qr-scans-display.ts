import type { QrScansWire } from '../services/performances.service';

// QR-SCAN1 — the wording and the shaping of the QR scans on « Mes performances ». The figures
// themselves come from the api (lib/qr-scans.ts, ONE home); this file only formats them.

/** « 1 scan » / « 12 scans ». */
export const scansLabel = (n: number): string =>
  `${n.toLocaleString('fr-FR')} scan${n > 1 ? 's' : ''}`;

/** « 0,5 » scans pour 1 000 impressions, « — » without impressions. */
export const qrRateLabel = (rate: number | null): string =>
  rate === null ? '—' : rate.toLocaleString('fr-FR');

/** « 21 h – 22 h ». */
export const hourRangeLabel = (hour: number): string =>
  `${String(hour).padStart(2, '0')} h – ${String(hour + 1).padStart(2, '0')} h`;

/** The hour with the most scans (the earliest on a tie), or null when nothing was scanned. */
export const peakHour = (byHour: QrScansWire['by_hour']): number | null => {
  let best: { hour: number; scans: number } | null = null;
  for (const h of byHour) if (h.scans > 0 && (best === null || h.scans > best.scans)) best = h;
  return best?.hour ?? null;
};

/** The days shown as bars: the last `max` days with a scan, oldest first. */
export const QR_DAY_ROWS = 14;
export const recentScanDays = (
  byDay: QrScansWire['by_day'],
  max: number = QR_DAY_ROWS,
): QrScansWire['by_day'] => byDay.slice(-max);

/** A bar's width in % of the largest value (0 when everything is 0). */
export const scanBarPct = (value: number, values: readonly number[]): number => {
  const top = Math.max(0, ...values);
  return top === 0 ? 0 : Math.round((value / top) * 1000) / 10;
};
