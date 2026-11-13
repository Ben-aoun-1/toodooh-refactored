import { describe, expect, it } from 'vitest';

import {
  type UnavailabilityView,
  applyHoursToggle,
  cellDateOf,
  dayStateOf,
  hoursChange,
  hoursRangesLabel,
  unavailableHoursOf,
  windowHours,
} from './hour-unavailability';

const view = (over: Partial<UnavailabilityView> = {}): UnavailabilityView => ({
  days: [],
  hours: [],
  opening_hour: 20,
  closing_hour: 2,
  ...over,
});

describe('HOUR-UNAV1 calendar rules', () => {
  it('lists the window in opening order and dates the small hours on the next day', () => {
    expect(windowHours(20, 2)).toEqual([20, 21, 22, 23, 0, 1]);
    expect(windowHours(8, 18)).toHaveLength(10);
    expect(windowHours(null, null)).toHaveLength(24);
    expect(cellDateOf('2027-06-10', 1, 20)).toBe('2027-06-11');
    expect(cellDateOf('2027-06-10', 22, 20)).toBe('2027-06-10');
    expect(cellDateOf('2027-12-31', 0, 20)).toBe('2028-01-01');
  });

  it('reads a day as available / partial / unavailable from the api cells', () => {
    const v = view({
      hours: [
        { day: '2027-06-10', hour: 22 },
        { day: '2027-06-11', hour: 0 },
      ],
    });
    expect(unavailableHoursOf('2027-06-10', v)).toEqual([22, 0]);
    expect(dayStateOf('2027-06-10', v)).toBe('partial');
    expect(dayStateOf('2027-06-11', v)).toBe('available'); // 00:00 on the 11th is the 10th's
    const all = applyHoursToggle(view(), '2027-06-10', null, true);
    expect(dayStateOf('2027-06-10', all)).toBe('unavailable');
    expect(all.days).toEqual(['2027-06-10']);
  });

  it('the optimistic toggle adds and frees hours, and keeps `days` in step', () => {
    const v = applyHoursToggle(view(), '2027-06-10', [22, 0], true);
    expect(v.hours).toEqual([
      { day: '2027-06-10', hour: 22 },
      { day: '2027-06-11', hour: 0 },
    ]);
    const freed = applyHoursToggle(
      applyHoursToggle(v, '2027-06-10', null, true),
      '2027-06-10',
      [21],
      false,
    );
    expect(freed.days).toEqual([]);
    expect(unavailableHoursOf('2027-06-10', freed)).toEqual([20, 22, 23, 0, 1]);
  });

  it('sends only the change, and names ranges', () => {
    expect(hoursChange([14, 15], [15, 16])).toEqual({ add: [16], remove: [14] });
    expect(hoursRangesLabel([20, 23, 0], windowHours(20, 2))).toBe('20 h–21 h, 23 h–1 h');
  });
});
