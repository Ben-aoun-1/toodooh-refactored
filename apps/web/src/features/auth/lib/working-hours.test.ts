import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLOSING_HOUR,
  DEFAULT_OPENING_HOUR,
  HOUR_OPTIONS,
  hoursPayload,
  isValidHoursWindow,
} from './working-hours';

// H1 (Mejri item 5) — the signup working-hours helpers: hour-granular single window
// [open, close) mirroring the API pair rule; skip = empty payload (NULL columns server-side).

describe('working-hours defaults + options', () => {
  it('prefills the ruled 08:00–22:00 default window', () => {
    expect(DEFAULT_OPENING_HOUR).toBe(8);
    expect(DEFAULT_CLOSING_HOUR).toBe(22);
    expect(isValidHoursWindow(DEFAULT_OPENING_HOUR, DEFAULT_CLOSING_HOUR)).toBe(true);
  });

  it('offers exactly the 24 hour-granular options, 00:00 … 23:00 (no minutes)', () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toEqual({ value: 0, label: '00:00' });
    expect(HOUR_OPTIONS[8]).toEqual({ value: 8, label: '08:00' });
    expect(HOUR_OPTIONS[23]).toEqual({ value: 23, label: '23:00' });
  });
});

describe('isValidHoursWindow (mirrors the API rule: ints 0–23, open < close)', () => {
  it('accepts ordered in-range windows, including the 0-open edge', () => {
    expect(isValidHoursWindow(0, 23)).toBe(true);
    expect(isValidHoursWindow(0, 1)).toBe(true);
    expect(isValidHoursWindow(22, 23)).toBe(true);
  });

  it('rejects unordered, zero-width, out-of-range and non-integer windows', () => {
    expect(isValidHoursWindow(22, 8)).toBe(false); // unordered (overnight deferred to L-disp)
    expect(isValidHoursWindow(9, 9)).toBe(false); // zero-width
    expect(isValidHoursWindow(-1, 22)).toBe(false);
    expect(isValidHoursWindow(8, 24)).toBe(false);
    expect(isValidHoursWindow(8.5, 22)).toBe(false);
    expect(isValidHoursWindow(Number.NaN, 22)).toBe(false);
  });
});

describe('hoursPayload (the « préciser plus tard » seam)', () => {
  it('skip → an EMPTY payload (both columns stay NULL server-side)', () => {
    expect(hoursPayload(true, 8, 22)).toEqual({});
  });

  it('captured → the full pair, 0 included', () => {
    expect(hoursPayload(false, 8, 22)).toEqual({ opening_hour: 8, closing_hour: 22 });
    expect(hoursPayload(false, 0, 23)).toEqual({ opening_hour: 0, closing_hour: 23 });
  });
});
