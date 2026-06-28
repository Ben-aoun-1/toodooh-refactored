import { describe, expect, it } from 'vitest';

import { lastCompleteMonth } from './monthly-report';

// `new Date(year, monthIndex, day)` builds a LOCAL date with the given fields; lastCompleteMonth
// reads getFullYear()/getMonth() (also local), so the pairing is consistent — no TZ flakiness.
describe('lastCompleteMonth', () => {
  it('returns the previous calendar month, mid-year', () => {
    expect(lastCompleteMonth(new Date(2026, 5, 28))).toBe('2026-05'); // June → May
  });

  it('rolls January back to the previous December (year boundary)', () => {
    expect(lastCompleteMonth(new Date(2026, 0, 1))).toBe('2025-12'); // Jan → prev-year Dec
  });

  it('zero-pads a single-digit previous month', () => {
    expect(lastCompleteMonth(new Date(2026, 1, 15))).toBe('2026-01'); // Feb → Jan
  });

  it('emits a two-digit previous month without padding regressions', () => {
    expect(lastCompleteMonth(new Date(2026, 11, 31))).toBe('2026-11'); // Dec → Nov
  });

  it('is independent of the day-of-month', () => {
    expect(lastCompleteMonth(new Date(2026, 6, 1))).toBe('2026-06'); // July 1st → June
    expect(lastCompleteMonth(new Date(2026, 6, 31))).toBe('2026-06'); // July 31st → June
  });

  it('produces a YYYY-MM string for the default (now) argument', () => {
    expect(lastCompleteMonth()).toMatch(/^\d{4}-\d{2}$/);
  });
});
