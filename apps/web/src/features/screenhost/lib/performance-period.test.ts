import { describe, expect, it } from 'vitest';

import {
  ALL_TIME_FROM,
  formatCompactPeriod,
  formatDateFr,
  formatGeneratedAtFr,
  formatTablePeriod,
  inRange,
  monthLabelFr,
  resolvePeriodRange,
  tunisTodayIso,
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
