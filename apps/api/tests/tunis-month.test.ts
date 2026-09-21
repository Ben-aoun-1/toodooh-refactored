import { describe, expect, it } from 'vitest';

import { tunisMonthOf } from '../src/lib/tunis-month.js';

// DASH-1 (R3) — « Revenu mensuel » counts the CURRENT month in Tunis time. The route used to take
// `new Date(year, month, 1)` in the container's zone (UTC, no TZ set), so the month opened at
// 01:00 Tunis and a settlement between 00:00 and 01:00 on the 1st landed in the previous month.
// Every instant below is named explicitly (UTC `Z`), never read from the wall clock.

describe('tunisMonthOf — the Tunis calendar month containing an instant', () => {
  it('mid-month: the month, its first instant and the next month’s first instant (+01:00)', () => {
    const m = tunisMonthOf(new Date('2026-10-15T09:00:00Z')); // Thu 15 Oct 2026, 10:00 Tunis
    expect(m.month).toBe('2026-10');
    expect(m.start.toISOString()).toBe('2026-09-30T23:00:00.000Z'); // 1 Oct 00:00 Tunis
    expect(m.end.toISOString()).toBe('2026-10-31T23:00:00.000Z'); // 1 Nov 00:00 Tunis
  });

  it('00:30 Tunis on the 1st is ALREADY the new month although UTC still says the 30th', () => {
    const m = tunisMonthOf(new Date('2026-09-30T23:30:00Z')); // Thu 1 Oct 2026, 00:30 Tunis
    expect(m.month).toBe('2026-10');
    expect(m.start.toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });

  it('23:30 Tunis on the last day is still that month', () => {
    const m = tunisMonthOf(new Date('2026-09-30T22:30:00Z')); // Wed 30 Sep 2026, 23:30 Tunis
    expect(m.month).toBe('2026-09');
    expect(m.start.toISOString()).toBe('2026-08-31T23:00:00.000Z'); // 1 Sep 00:00 Tunis
    expect(m.end.toISOString()).toBe('2026-09-30T23:00:00.000Z'); // 1 Oct 00:00 Tunis
  });

  it('rolls the year over in December, and handles February (28 days in 2026)', () => {
    const dec = tunisMonthOf(new Date('2026-12-31T22:59:59Z')); // Thu 31 Dec 2026, 23:59:59 Tunis
    expect(dec.month).toBe('2026-12');
    expect(dec.end.toISOString()).toBe('2026-12-31T23:00:00.000Z'); // 1 Jan 2027 00:00 Tunis

    const feb = tunisMonthOf(new Date('2026-02-10T12:00:00Z')); // Tue 10 Feb 2026
    expect(feb.month).toBe('2026-02');
    expect(feb.end.toISOString()).toBe('2026-02-28T23:00:00.000Z'); // 1 Mar 00:00 Tunis
  });
});
