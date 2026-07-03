import { describe, expect, it } from 'vitest';

import { formatDurationClock, formatUiDate, inclusiveDayCount } from './campaign-summary';

describe('inclusiveDayCount', () => {
  it('counts both endpoints (matches the engine fenêtre — eachDayOfInterval)', () => {
    // 28/12/2025 → 03/01/2026 spans 7 calendar days inclusive (28,29,30,31,1,2,3).
    expect(inclusiveDayCount('2025-12-28', '2026-01-03')).toBe(7);
  });

  it('is 1 for a same-day campaign', () => {
    expect(inclusiveDayCount('2026-07-01', '2026-07-01')).toBe(1);
  });

  it('returns null when a date is missing', () => {
    expect(inclusiveDayCount(null, '2026-07-01')).toBeNull();
    expect(inclusiveDayCount('2026-07-01', null)).toBeNull();
  });

  it('returns null when the range is inverted', () => {
    expect(inclusiveDayCount('2026-07-15', '2026-07-01')).toBeNull();
  });
});

describe('formatUiDate', () => {
  it('formats a date-only string as dd/MM/yyyy', () => {
    expect(formatUiDate('2025-12-28')).toBe('28/12/2025');
    expect(formatUiDate('2026-01-03')).toBe('03/01/2026');
  });

  it('renders an em dash for a missing/invalid date', () => {
    expect(formatUiDate(null)).toBe('—');
    expect(formatUiDate('not-a-date')).toBe('—');
  });
});

describe('formatDurationClock', () => {
  it('formats whole seconds as mm:ss', () => {
    expect(formatDurationClock(15)).toBe('00:15');
    expect(formatDurationClock(90)).toBe('01:30');
    expect(formatDurationClock(600)).toBe('10:00');
  });

  it('renders an em dash for a null/invalid duration', () => {
    expect(formatDurationClock(null)).toBe('—');
    expect(formatDurationClock(undefined)).toBe('—');
    expect(formatDurationClock(-5)).toBe('—');
  });
});
