import { describe, expect, it } from 'vitest';

import {
  OUT_OF_WINDOW,
  clampRangeForReport,
  downloadPeriodReport,
  periodReportFilename,
  periodReportPath,
  reportErrorMessageFr,
} from './period-report';

describe('periodReportPath', () => {
  it('builds the owner endpoint URL with both bounds encoded', () => {
    expect(periodReportPath('abc-123', { from: '2026-06-11', to: '2026-07-08' })).toBe(
      '/api/screenhosts/abc-123/report?from=2026-06-11&to=2026-07-08',
    );
  });
});

describe('periodReportFilename', () => {
  it("names the saved PDF after the range ('rapport-<from>_<to>.pdf')", () => {
    expect(periodReportFilename({ from: '2026-06-01', to: '2026-06-30' })).toBe(
      'rapport-2026-06-01_2026-06-30.pdf',
    );
  });
});

describe('downloadPeriodReport (client-side range guard)', () => {
  it('rejects a malformed range WITHOUT fetching', async () => {
    await expect(
      downloadPeriodReport('abc-123', { from: 'juin', to: '2026-06-30' }),
    ).rejects.toThrow(/invalid range/);
  });
});

describe('clampRangeForReport (R4 — « Depuis le début » must WORK, honestly)', () => {
  const today = new Date(2026, 7, 5); // 2026-08-05 local — the anchor is a local-midnight Date

  it('a range inside the 400-day window passes through unclamped', () => {
    expect(clampRangeForReport({ from: '2026-06-01', to: '2026-08-05' }, today)).toEqual({
      range: { from: '2026-06-01', to: '2026-08-05' },
      clamped: false,
    });
  });

  it('the confirmed Mejri repro: « Depuis le début » (2020-01-01) is CLAMPED, never a 400', () => {
    const clamped = clampRangeForReport({ from: '2020-01-01', to: '2026-08-05' }, today);
    expect(clamped?.clamped).toBe(true);
    // 399 days before 2026-08-05 = 2025-07-02: the newest 400 days, inclusive.
    expect(clamped?.range).toEqual({ from: '2025-07-02', to: '2026-08-05' });
  });

  it('a period ENTIRELY older than the window yields null (nothing requestable — no fetch)', () => {
    expect(clampRangeForReport({ from: '2020-01-01', to: '2021-01-01' }, today)).toBe(null);
  });
});

describe('reportErrorMessageFr (R4 — one copy per failure class)', () => {
  it('maps each class to its own copy; unknown codes keep the generic toast', () => {
    expect(reportErrorMessageFr('RANGE_TOO_WIDE')).toContain('400 jours');
    expect(reportErrorMessageFr(OUT_OF_WINDOW)).toContain('plus ancienne');
    expect(reportErrorMessageFr('REPORT_RENDER_FAILED')).toContain('génération');
    expect(reportErrorMessageFr('REPORT_STORAGE_UNAVAILABLE')).toContain('inaccessible');
    expect(reportErrorMessageFr('HTTP_500')).toBe('Échec du téléchargement. Veuillez réessayer.');
    expect(reportErrorMessageFr(null)).toBe('Échec du téléchargement. Veuillez réessayer.');
  });
});
