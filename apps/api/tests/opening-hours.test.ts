import { describe, expect, it } from 'vitest';

import {
  addIsoDays,
  broadcastableHours,
  hoursSpan,
  isOpenAt,
  isOpenSlot,
  openingHours,
  shiftDayOfWeek,
} from '../src/lib/opening-hours.js';

// HOURS-X1 — the one hours helper, wrap included. The web twin (working-hours.ts) pins the same
// fixtures; keep the two lists identical.
describe('opening-hours helper (HOURS-X1)', () => {
  it('hoursSpan is the clock distance, 0 for an equal pair', () => {
    expect(hoursSpan(8, 22)).toBe(14);
    expect(hoursSpan(8, 1)).toBe(17);
    expect(hoursSpan(23, 0)).toBe(1);
    expect(hoursSpan(9, 9)).toBe(0);
    expect(hoursSpan(0, 23)).toBe(23);
  });

  it('openingHours tags the post-midnight hours with dayOffset 1', () => {
    expect(openingHours(22, 2)).toEqual([
      { hour: 22, dayOffset: 0 },
      { hour: 23, dayOffset: 0 },
      { hour: 0, dayOffset: 1 },
      { hour: 1, dayOffset: 1 },
    ]);
    expect(openingHours(8, 12).every((h) => h.dayOffset === 0)).toBe(true);
    expect(openingHours(null, 12)).toEqual([]);
    expect(broadcastableHours(0, 23)).toHaveLength(23);
  });

  it('isOpenAt handles both shapes and refuses null / zero-width', () => {
    expect(isOpenAt(10, 8, 22)).toBe(true);
    expect(isOpenAt(22, 8, 22)).toBe(false);
    expect(isOpenAt(0, 8, 1)).toBe(true); // overnight: 00h is open
    expect(isOpenAt(1, 8, 1)).toBe(false); // closes at 01h
    expect(isOpenAt(5, 8, 1)).toBe(false);
    expect(isOpenAt(23, 8, 1)).toBe(true);
    expect(isOpenAt(10, null, 22)).toBe(false);
    expect(isOpenAt(9, 9, 9)).toBe(false);
  });

  it('addIsoDays / shiftDayOfWeek roll over month, year and week ends', () => {
    expect(addIsoDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addIsoDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDayOfWeek(7, 1)).toBe(1);
    expect(shiftDayOfWeek(1, 1)).toBe(2);
    expect(shiftDayOfWeek(3, 0)).toBe(3);
  });

  // LEARN-1 §3 — the learned-affluence rule, mirrored by the hub's isOpenSlot (keep the fixtures
  // identical on both sides). Unlike isOpenAt, NO hours means OPEN everywhere.
  it('LEARN-1: isOpenSlot — a slot is open when its clock hour is; NULL hours = all 48 open', () => {
    expect(isOpenSlot(16, 8, 22)).toBe(true); // 08h00
    expect(isOpenSlot(43, 8, 22)).toBe(true); // 21h30
    expect(isOpenSlot(44, 8, 22)).toBe(false); // 22h00 — closing is exclusive
    expect(isOpenSlot(15, 8, 22)).toBe(false); // 07h30
    expect(isOpenSlot(1, 8, 1)).toBe(true); // 00h30 — overnight 08 → 01
    expect(isOpenSlot(2, 8, 1)).toBe(false); // 01h00
    expect(isOpenSlot(47, 8, 1)).toBe(true); // 23h30
    expect(isOpenSlot(0, null, null)).toBe(true);
    expect(isOpenSlot(47, null, 22)).toBe(true); // either side null = no hours = open
    expect(isOpenSlot(20, 9, 9)).toBe(false); // zero-width (refused by every writer) = closed
    const open = Array.from({ length: 48 }, (_, slot) => slot).filter((slot) =>
      isOpenSlot(slot, 8, 1),
    );
    expect(open).toHaveLength(34); // 17 hours × 2
  });
});
