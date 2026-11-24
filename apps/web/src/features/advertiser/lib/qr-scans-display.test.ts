import { describe, expect, it } from 'vitest';

import {
  hourRangeLabel,
  peakHour,
  qrRateLabel,
  recentScanDays,
  scanBarPct,
  scansLabel,
} from './qr-scans-display';

describe('QR-SCAN1 — QR scans display', () => {
  it('labels', () => {
    expect(scansLabel(1)).toBe('1 scan');
    expect(scansLabel(0)).toBe('0 scan');
    expect(scansLabel(1200)).toMatch(/^1\s200 scans$/);
    expect(qrRateLabel(null)).toBe('—');
    expect(qrRateLabel(0.5)).toBe('0,5');
    expect(hourRangeLabel(9)).toBe('09 h – 10 h');
  });

  it('the peak hour is the busiest, the earliest on a tie, null when no scan', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, scans: 0 }));
    expect(peakHour(hours)).toBeNull();
    hours[21] = { hour: 21, scans: 3 };
    hours[8] = { hour: 8, scans: 3 };
    expect(peakHour(hours)).toBe(8);
  });

  it('keeps the most recent days; bar widths against the largest', () => {
    const days = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, '0')}`,
      scans: i,
    }));
    expect(recentScanDays(days).map((d) => d.date)).toHaveLength(14);
    expect(recentScanDays(days)[0]?.date).toBe('2026-02-07');
    expect(scanBarPct(2, [2, 4])).toBe(50);
    expect(scanBarPct(0, [0, 0])).toBe(0);
  });
});
