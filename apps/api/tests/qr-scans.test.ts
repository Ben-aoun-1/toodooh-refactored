import { describe, expect, it } from 'vitest';

import { summarizeScans, visitorHash } from '../src/lib/qr-scans.js';

describe('QR-SCAN1 — the QR scan summary (pure)', () => {
  it('the visitor key changes with the Tunis day, the IP and the browser, never shows them', () => {
    const at = new Date('2026-02-10T20:00:00Z');
    const k = visitorHash('s'.repeat(32), at, '197.0.0.7', 'UA');
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorHash('s'.repeat(32), new Date('2026-02-10T22:59:00Z'), '197.0.0.7', 'UA')).toBe(
      k,
    );
    // 23:00 UTC = 00:00 Tunis: a new day, a new key.
    expect(
      visitorHash('s'.repeat(32), new Date('2026-02-10T23:00:00Z'), '197.0.0.7', 'UA'),
    ).not.toBe(k);
    expect(visitorHash('s'.repeat(32), at, '197.0.0.8', 'UA')).not.toBe(k);
    expect(visitorHash('t'.repeat(32), at, '197.0.0.7', 'UA')).not.toBe(k);
  });

  it('no scan → zeros, 24 empty hours; no impression → no rate', () => {
    const s = summarizeScans([], 0);
    expect(s).toMatchObject({ scans: 0, uniqueVisitors: 0, per1000Impressions: null, byDay: [] });
    expect(s.byHour.every((h) => h.scans === 0)).toBe(true);
  });
});
