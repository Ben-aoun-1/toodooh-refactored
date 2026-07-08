import { describe, expect, it } from 'vitest';

import { downloadPeriodReport, periodReportFilename, periodReportPath } from './period-report';

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
