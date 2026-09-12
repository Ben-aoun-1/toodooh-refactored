import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLOSING_HOUR,
  DEFAULT_OPENING_HOUR,
  HOUR_OPTIONS,
  hoursPayload,
  hoursSpan,
  isOpenAt,
  isValidHoursWindow,
  nextDayHint,
  openingHoursList,
} from './working-hours';

// H1 (Mejri item 5) — the signup working-hours helpers: hour-granular single window
// [open, close) mirroring the API pair rule. HOURS-M1: the pair is mandatory (no skip).

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

describe('isValidHoursWindow (mirrors the API rule: ints 0–23, opening ≠ closing)', () => {
  it('accepts ordered in-range windows, including the 0-open edge', () => {
    expect(isValidHoursWindow(0, 23)).toBe(true);
    expect(isValidHoursWindow(0, 1)).toBe(true);
    expect(isValidHoursWindow(22, 23)).toBe(true);
  });

  it('HOURS-X1: accepts an inverted pair — it closes the next day', () => {
    expect(isValidHoursWindow(22, 8)).toBe(true);
    expect(isValidHoursWindow(8, 1)).toBe(true);
  });

  it('rejects zero-width, out-of-range and non-integer windows', () => {
    expect(isValidHoursWindow(9, 9)).toBe(false); // zero-width
    expect(isValidHoursWindow(-1, 22)).toBe(false);
    expect(isValidHoursWindow(8, 24)).toBe(false);
    expect(isValidHoursWindow(8.5, 22)).toBe(false);
    expect(isValidHoursWindow(Number.NaN, 22)).toBe(false);
  });
});

// The SAME fixtures as apps/api/tests/opening-hours.test.ts — the api twin.
describe('wrap helpers (HOURS-X1 — twin of api lib/opening-hours.ts)', () => {
  it('hoursSpan is the clock distance, 0 for an equal pair', () => {
    expect(hoursSpan(8, 22)).toBe(14);
    expect(hoursSpan(8, 1)).toBe(17);
    expect(hoursSpan(23, 0)).toBe(1);
    expect(hoursSpan(9, 9)).toBe(0);
    expect(hoursSpan(0, 23)).toBe(23);
  });

  it('openingHoursList is in clock order across midnight', () => {
    expect(openingHoursList(22, 2)).toEqual([22, 23, 0, 1]);
    expect(openingHoursList(8, 12)).toEqual([8, 9, 10, 11]);
    expect(openingHoursList(null, 12)).toEqual([]);
    expect(openingHoursList(0, 23)).toHaveLength(23);
  });

  it('isOpenAt handles both shapes and refuses null / zero-width', () => {
    expect(isOpenAt(10, 8, 22)).toBe(true);
    expect(isOpenAt(22, 8, 22)).toBe(false);
    expect(isOpenAt(0, 8, 1)).toBe(true);
    expect(isOpenAt(1, 8, 1)).toBe(false);
    expect(isOpenAt(5, 8, 1)).toBe(false);
    expect(isOpenAt(23, 8, 1)).toBe(true);
    expect(isOpenAt(10, null, 22)).toBe(false);
    expect(isOpenAt(9, 9, 9)).toBe(false);
  });

  it('nextDayHint names the overnight case and stays silent otherwise', () => {
    expect(nextDayHint(8, 1)).toBe("Fermeture le lendemain — 17 h d'ouverture.");
    expect(nextDayHint(8, 22)).toBeNull();
  });
});

describe('hoursPayload (HOURS-M1 — always the pair, no skip)', () => {
  it('always sends the full pair, 0 included', () => {
    expect(hoursPayload(8, 22)).toEqual({ opening_hour: 8, closing_hour: 22 });
    expect(hoursPayload(0, 23)).toEqual({ opening_hour: 0, closing_hour: 23 });
  });
});
