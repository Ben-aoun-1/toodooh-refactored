import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OUT_OF_WINDOW,
  ReportDownloadError,
  type SaveDom,
  clampRangeForReport,
  fetchPeriodReport,
  periodReportFilename,
  periodReportPath,
  reportErrorMessageFr,
  savePreparedReport,
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

describe('fetchPeriodReport (PERF-DL1 phase 1 — fetch + prepare, no save)', () => {
  const range = { from: '2025-07-04', to: '2026-08-07' };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a malformed range WITHOUT fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchPeriodReport('abc-123', { from: 'juin', to: '2026-06-30' })).rejects.toThrow(
      /invalid range/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('derives the filename from the api content-disposition (venue slug + from_to range)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Blob(['%PDF-period'], { type: 'application/pdf' }), {
            status: 200,
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': 'inline; filename="rapport-fffrfr-2025-07-04_2026-08-07.pdf"',
            },
          }),
      ),
    );
    const prepared = await fetchPeriodReport('abc-123', range);
    expect(prepared.filename).toBe('rapport-fffrfr-2025-07-04_2026-08-07.pdf');
    expect(await prepared.blob.text()).toBe('%PDF-period');
  });

  it('falls back to the range-only filename when the header is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['%PDF-x']), { status: 200 })),
    );
    const prepared = await fetchPeriodReport('abc-123', range);
    expect(prepared.filename).toBe('rapport-2025-07-04_2026-08-07.pdf');
  });

  // INV-1 rule, force-throw pin: a failing api SURFACES as a typed error — never a silent result.
  it('throws ReportDownloadError carrying the api error code on a non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'REPORT_RENDER_FAILED', message: 'nope' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const failure = fetchPeriodReport('abc-123', range);
    await expect(failure).rejects.toBeInstanceOf(ReportDownloadError);
    await expect(fetchPeriodReport('abc-123', range)).rejects.toMatchObject({
      code: 'REPORT_RENDER_FAILED',
      status: 503,
    });
  });

  it('a network-level failure propagates untouched (no swallow)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(fetchPeriodReport('abc-123', range)).rejects.toThrow('Failed to fetch');
  });
});

describe('savePreparedReport (PERF-DL1 phase 2 — the gesture-fresh anchor save)', () => {
  const prepared = { blob: new Blob(['%PDF-x']), filename: 'rapport-fffrfr-2026-07.pdf' };

  const fakeDom = () => {
    const calls: string[] = [];
    const dom: SaveDom = {
      createObjectUrl: vi.fn(() => {
        calls.push('create');
        return 'blob:fake-url';
      }),
      revokeObjectUrl: vi.fn(() => {
        calls.push('revoke');
      }),
      clickAnchor: vi.fn(() => {
        calls.push('click');
      }),
    };
    return { calls, dom };
  };

  it('creates the object URL, clicks the anchor with the prepared filename, then revokes', () => {
    const { calls, dom } = fakeDom();
    savePreparedReport(prepared, dom);
    expect(calls).toEqual(['create', 'click', 'revoke']);
    expect(dom.clickAnchor).toHaveBeenCalledWith({
      url: 'blob:fake-url',
      filename: 'rapport-fffrfr-2026-07.pdf',
    });
  });

  // INV-1 rule, force-throw pin: a save failure SURFACES to the caller; the URL is still revoked.
  it('a throwing save propagates the error AND revokes the object URL', () => {
    const { dom } = fakeDom();
    vi.mocked(dom.clickAnchor).mockImplementation(() => {
      throw new Error('anchor exploded');
    });
    expect(() => savePreparedReport(prepared, dom)).toThrow('anchor exploded');
    expect(dom.revokeObjectUrl).toHaveBeenCalledWith('blob:fake-url');
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
