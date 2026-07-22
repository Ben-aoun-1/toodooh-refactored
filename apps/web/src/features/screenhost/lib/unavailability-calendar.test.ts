import { describe, expect, it } from 'vitest';

import {
  UNAVAILABILITY_CONSEQUENCE_COPY,
  isDayToggleable,
  isoOf,
  monthGrid,
} from './unavailability-calendar';

// E2 — the calendar's pure rules.

describe('isDayToggleable — FUTURE-only (the api PAST_OR_TODAY mirror)', () => {
  it('tomorrow toggles; today and the past are locked', () => {
    expect(isDayToggleable('2026-07-23', '2026-07-22')).toBe(true);
    expect(isDayToggleable('2026-07-22', '2026-07-22')).toBe(false);
    expect(isDayToggleable('2026-07-21', '2026-07-22')).toBe(false);
  });
});

describe('monthGrid — Monday-first, full weeks, neighbour padding', () => {
  it('July 2026 starts Wednesday: 2 lead cells, 31 days, padded to 5 weeks', () => {
    const cells = monthGrid(2026, 6);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    // Lead: Mon 29 + Tue 30 June (out of month), then Wed 1 July.
    expect(cells[0]).toEqual({ iso: '2026-06-29', dayOfMonth: 29, inMonth: false });
    expect(cells[2]).toEqual({ iso: '2026-07-01', dayOfMonth: 1, inMonth: true });
    // The tail pads into August up to the week boundary.
    expect(cells[cells.length - 1]?.iso).toBe('2026-08-02');
  });

  it('isoOf zero-pads', () => {
    expect(isoOf(2026, 0, 5)).toBe('2026-01-05');
    expect(isoOf(2026, 11, 31)).toBe('2026-12-31');
  });
});

describe('the consequence copy — the ruled wording, verbatim', () => {
  it('states the exclusion AND the frozen-plan immunity', () => {
    expect(UNAVAILABILITY_CONSEQUENCE_COPY).toBe(
      'Les jours indisponibles sont exclus des prochaines campagnes. Les campagnes déjà planifiées ne sont pas affectées.',
    );
  });
});
