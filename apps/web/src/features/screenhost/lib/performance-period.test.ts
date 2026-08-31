import { describe, expect, it } from 'vitest';

import {
  ALL_TIME_FROM,
  formatCompactPeriod,
  formatDateFr,
  formatGeneratedAtFr,
  formatTablePeriod,
  inRange,
  monthLabelFr,
  peakObservedLabel,
  resolvePeriodRange,
  tunisTodayIso,
  DEFAULT_PERIOD_SELECTION,
  parsePeriodSelection,
  writePeriodSelection,
} from './performance-period';

const TODAY = new Date(2026, 6, 7); // 2026-07-07 (local)

describe('resolvePeriodRange', () => {
  it('7d / 28d are inclusive windows ending today', () => {
    expect(resolvePeriodRange('7d', TODAY)).toEqual({ from: '2026-07-01', to: '2026-07-07' });
    expect(resolvePeriodRange('28d', TODAY)).toEqual({ from: '2026-06-10', to: '2026-07-07' });
  });

  it('3m / 12m subtract calendar months', () => {
    expect(resolvePeriodRange('3m', TODAY)).toEqual({ from: '2026-04-07', to: '2026-07-07' });
    expect(resolvePeriodRange('12m', TODAY)).toEqual({ from: '2025-07-07', to: '2026-07-07' });
  });

  it('"Depuis le début" uses the all-time floor', () => {
    expect(resolvePeriodRange('all', TODAY)).toEqual({ from: ALL_TIME_FROM, to: '2026-07-07' });
  });

  it('custom uses the pair, swaps a reversed pair, and falls back to 28d when incomplete', () => {
    expect(resolvePeriodRange('custom', TODAY, { from: '2026-06-05', to: '2026-07-03' })).toEqual({
      from: '2026-06-05',
      to: '2026-07-03',
    });
    expect(resolvePeriodRange('custom', TODAY, { from: '2026-07-03', to: '2026-06-05' })).toEqual({
      from: '2026-06-05',
      to: '2026-07-03',
    });
    expect(resolvePeriodRange('custom', TODAY, { from: '2026-06-05', to: '' })).toEqual(
      resolvePeriodRange('28d', TODAY),
    );
    expect(resolvePeriodRange('custom', TODAY)).toEqual(resolvePeriodRange('28d', TODAY));
  });
});

describe('inRange', () => {
  const range = { from: '2026-06-01', to: '2026-06-30' };
  it('is inclusive on both bounds', () => {
    expect(inRange('2026-06-01', range)).toBe(true);
    expect(inRange('2026-06-30', range)).toBe(true);
    expect(inRange('2026-05-31', range)).toBe(false);
    expect(inRange('2026-07-01', range)).toBe(false);
  });
});

describe('formatters', () => {
  it('formatDateFr → DD/MM/YYYY; malformed → em dash', () => {
    expect(formatDateFr('2026-06-14')).toBe('14/06/2026');
    expect(formatDateFr('nonsense')).toBe('—');
  });

  it('monthLabelFr → French month + year', () => {
    expect(monthLabelFr('2026-06')).toBe('Juin 2026');
    expect(monthLabelFr('2026-02')).toBe('Février 2026');
    expect(monthLabelFr('26-6')).toBe('—');
  });

  it('formatGeneratedAtFr renders the REAL generation timestamp, never a derived date (R1)', () => {
    expect(formatGeneratedAtFr('2026-08-01T06:30:00.000Z')).toBe('01/08/2026');
    expect(formatGeneratedAtFr('junk')).toBe('—');
  });

  it('compact + table period formats degrade gracefully on null dates', () => {
    expect(formatCompactPeriod('2026-06-05', '2026-06-18')).toBe('05/06 – 18/06');
    expect(formatCompactPeriod(null, '2026-06-18')).toBe('18/06');
    expect(formatCompactPeriod(null, null)).toBe('—');
    expect(formatTablePeriod('2026-06-05', '2026-06-18')).toBe('05/06 – 18/06/2026');
    expect(formatTablePeriod(null, '2026-06-18')).toBe('18/06/2026');
    expect(formatTablePeriod(null, null)).toBe('—');
  });
});

describe('tunisTodayIso / the R8 Tunis anchor', () => {
  it('anchors on the Africa/Tunis calendar day, whatever the runner timezone', () => {
    // 23:30Z is ALREADY July 1st in Tunis (UTC+1, no DST since 2008)…
    expect(tunisTodayIso(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    // …one hour earlier it is still June 30 — the server's impressions bucket and the page's
    // curve day must flip together (the confirmed 26/06 class of bug).
    expect(tunisTodayIso(new Date('2026-06-30T22:30:00Z'))).toBe('2026-06-30');
  });
});

describe('peakObservedLabel (GREEN2 item 8a — no mockup token on screen)', () => {
  it('renders the real peak date, and an honest « — » when no peak exists', () => {
    expect(peakObservedLabel({ date: '2026-07-26' })).toBe('26/07/2026');
    expect(peakObservedLabel(null)).toBe('—');
    expect(peakObservedLabel(undefined)).toBe('—');
  });
});

// MEJ-4 (Mejri 31/08 pt 4) — the période survives a reload because it lives in the URL. Before
// this it was component state alone: a refresh snapped back to « 28 derniers jours » without the
// owner touching anything, which is how a coherent « aujourd'hui » reading became the estimated
// 28-day one reported as fictitious data.
describe('parsePeriodSelection — the URL is the période', () => {
  const parse = (qs: string) => parsePeriodSelection(new URLSearchParams(qs));

  it('reads a pill key back verbatim', () => {
    expect(parse('periode=7d')).toEqual({ period: '7d' });
    expect(parse('periode=all')).toEqual({ period: 'all' });
  });

  it('reads a custom range from du/au', () => {
    expect(parse('periode=custom&du=2026-08-01&au=2026-08-15')).toEqual({
      period: 'custom',
      custom: { from: '2026-08-01', to: '2026-08-15' },
    });
  });

  it('falls back to the 28-day default on anything unusable — never a half-range', () => {
    expect(parse('')).toEqual(DEFAULT_PERIOD_SELECTION);
    expect(parse('periode=42j')).toEqual(DEFAULT_PERIOD_SELECTION);
    expect(parse('periode=custom')).toEqual(DEFAULT_PERIOD_SELECTION); // no bounds
    expect(parse('periode=custom&du=2026-08-01')).toEqual(DEFAULT_PERIOD_SELECTION); // half
    expect(parse('periode=custom&du=01/08/2026&au=15/08/2026')).toEqual(DEFAULT_PERIOD_SELECTION);
    expect(DEFAULT_PERIOD_SELECTION.period).toBe('28d'); // the documented default, unchanged
  });
});

describe('writePeriodSelection — a shareable link, other params untouched', () => {
  const write = (qs: string, selection: Parameters<typeof writePeriodSelection>[1]) =>
    writePeriodSelection(new URLSearchParams(qs), selection).toString();

  it('writes the pill key', () => {
    expect(write('', { period: '3m' })).toBe('periode=3m');
  });

  it('writes both custom bounds', () => {
    expect(write('', { period: 'custom', custom: { from: '2026-08-01', to: '2026-08-15' } })).toBe(
      'periode=custom&du=2026-08-01&au=2026-08-15',
    );
  });

  it('drops stale bounds when leaving the custom pill', () => {
    expect(write('periode=custom&du=2026-08-01&au=2026-08-15', { period: '7d' })).toBe(
      'periode=7d',
    );
  });

  it('drops an incomplete custom pair instead of writing half a range', () => {
    expect(write('', { period: 'custom' })).toBe('periode=custom');
  });

  it('preserves every other query param', () => {
    expect(write('lieu=abc', { period: '12m' })).toBe('lieu=abc&periode=12m');
  });

  it('round-trips: what is written parses back identically', () => {
    for (const selection of [
      { period: '7d' as const },
      { period: 'all' as const },
      { period: 'custom' as const, custom: { from: '2026-01-02', to: '2026-03-04' } },
    ]) {
      const written = writePeriodSelection(new URLSearchParams(), selection);
      expect(parsePeriodSelection(written)).toEqual(selection);
    }
  });
});
