import { describe, expect, it } from 'vitest';

import { isSelectableStartDate, startFloorHelperText } from './wizard-dates';

// CF-Q2 (spec §1.4) — StepBasics CONSUMES the server floor: week-ends are unselectable in the
// start picker and the French helper line renders the wire date. (The floor itself is computed
// and pinned server-side — the web never recomputes the J+2 rule.)

describe('isSelectableStartDate (the picker filterDate)', () => {
  it('allows Mon–Fri', () => {
    // 2026-07-13 (lundi) … 2026-07-17 (vendredi), local dates
    for (let day = 13; day <= 17; day += 1) {
      expect(isSelectableStartDate(new Date(2026, 6, day))).toBe(true);
    }
  });

  it('blocks samedi and dimanche', () => {
    expect(isSelectableStartDate(new Date(2026, 6, 18))).toBe(false);
    expect(isSelectableStartDate(new Date(2026, 6, 19))).toBe(false);
  });
});

describe('startFloorHelperText', () => {
  it('renders the French helper line from the wire ISO date', () => {
    expect(startFloorHelperText('2026-07-21')).toBe(
      'Premier départ possible : 21/07/2026 — les campagnes démarrent en jours ouvrés.',
    );
  });

  it('returns null while the config has not arrived (no line, no crash)', () => {
    expect(startFloorHelperText(undefined)).toBeNull();
    expect(startFloorHelperText('')).toBeNull();
  });
});
