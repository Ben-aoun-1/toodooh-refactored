import { describe, expect, it } from 'vitest';

import { buildWindowDays } from '../src/lib/dispatch/window.js';

describe('buildWindowDays — inclusive fenêtre → per-day (1=Mon … 7=Sun)', () => {
  it('expands an inclusive window with ISO weekdays', () => {
    expect(buildWindowDays('2024-01-01', '2024-01-03')).toEqual([
      { date: '2024-01-01', dayOfWeek: 1 }, // Monday
      { date: '2024-01-02', dayOfWeek: 2 },
      { date: '2024-01-03', dayOfWeek: 3 },
    ]);
  });

  it('a single-day window yields one day', () => {
    expect(buildWindowDays('2024-01-07', '2024-01-07')).toEqual([
      { date: '2024-01-07', dayOfWeek: 7 }, // Sunday
    ]);
  });

  it('returns empty when end precedes start', () => {
    expect(buildWindowDays('2024-01-03', '2024-01-01')).toEqual([]);
  });
});
