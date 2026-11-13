import { describe, expect, it } from 'vitest';

import type { AppointmentView } from '../services/appointments.service';

import {
  blockedHoursOf,
  dayState,
  freeHours,
  monthCells,
  partialDays,
  shiftMonth,
  splitAppointments,
} from './appointments';

const view = (over: Partial<AppointmentView>): AppointmentView => ({
  id: 'x',
  status: 'en_attente',
  day: '2026-10-20',
  hour: 10,
  proposed_day: null,
  proposed_hour: null,
  message: null,
  objective: null,
  counterpart_id: 'u',
  counterpart_name: 'Café',
  venue_name: null,
  venue_address: null,
  cancelled_by: null,
  ...over,
});

describe('AGT-5 — appointment calendar rules', () => {
  it('builds Monday-first weeks', () => {
    const cells = monthCells('2026-10'); // 1 Oct 2026 is a Thursday
    expect(cells.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(31);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('past days are frozen; unavailable days are red', () => {
    expect(dayState('2026-10-12', '2026-10-13', [])).toBe('past');
    expect(dayState('2026-10-14', '2026-10-13', ['2026-10-14'])).toBe('unavailable');
    expect(dayState('2026-10-15', '2026-10-13', ['2026-10-14'])).toBe('available');
  });

  it('free hours drop taken and already-started slots', () => {
    const now = new Date('2026-10-20T09:30:00Z'); // 10:30 Tunis
    expect(
      freeHours('2026-10-20', [9, 10, 11, 12], [{ day: '2026-10-20', hour: 12 }], now),
    ).toEqual([11]);
  });

  it('splits upcoming (soonest first) from past', () => {
    const rows = [
      view({ id: 'a', status: 'confirme', day: '2026-10-22' }),
      view({ id: 'b', status: 'en_attente', day: '2026-10-21' }),
      view({ id: 'c', status: 'passe' }),
      view({ id: 'd', status: 'annule' }),
    ];
    const { upcoming, past } = splitAppointments(rows);
    expect(upcoming.map((r) => r.id)).toEqual(['b', 'a']);
    expect(past.map((r) => r.id)).toEqual(['c', 'd']);
  });
});

describe('AGT-HOUR1 — agent hours', () => {
  const view = {
    unavailable: ['2026-10-20'],
    unavailable_hours: [
      { day: '2026-10-21', hour: 14 },
      { day: '2026-10-21', hour: 10 },
    ],
    slot_hours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
  };

  it('a day with some blocked hours is partial; a whole day stays unavailable', () => {
    expect(partialDays(view.unavailable_hours, view.unavailable)).toEqual(['2026-10-21']);
    expect(dayState('2026-10-21', '2026-10-13', view.unavailable, ['2026-10-21'])).toBe('partial');
    expect(dayState('2026-10-20', '2026-10-13', view.unavailable, ['2026-10-20'])).toBe(
      'unavailable',
    );
  });

  it('the blocked hours of a day, in slot order (a whole day = every slot)', () => {
    expect(blockedHoursOf('2026-10-21', view)).toEqual([10, 14]);
    expect(blockedHoursOf('2026-10-20', view)).toEqual(view.slot_hours);
    expect(blockedHoursOf('2026-10-22', view)).toEqual([]);
  });
});
