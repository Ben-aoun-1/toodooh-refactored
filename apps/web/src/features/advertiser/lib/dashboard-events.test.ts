import { describe, expect, it } from 'vitest';

import type { EventItemView } from '@/features/events/services/events.api';

import { dashboardEventCards, windowHours } from './dashboard-events';

const event = (id: string, kickoff: string, over: Partial<EventItemView> = {}): EventItemView => ({
  id,
  name: `Match ${id}`,
  description: null,
  type: 'sport',
  category: 'Football',
  kickoff_at: kickoff,
  ends_at: kickoff,
  statut: 'a_venir',
  source: 'official',
  has_image: false,
  positionable: true,
  fenetre: {
    window_start: '2026-12-01T19:00:00.000Z',
    window_end: '2026-12-01T23:00:00.000Z',
    blocs: [],
  },
  ...over,
});

const kinds = (list: readonly EventItemView[]) =>
  dashboardEventCards(list).map((c) => (c.kind === 'match' ? c.event.id : c.kind));

describe('dashboardEventCards', () => {
  it('shows the next two matches, soonest first, then the Ramadan offer', () => {
    const list = [
      event('c', '2026-12-20T19:00:00.000Z'),
      event('a', '2026-12-01T19:00:00.000Z'),
      event('b', '2026-12-10T19:00:00.000Z'),
    ];
    expect(kinds(list)).toEqual(['a', 'b', 'ramadan']);
  });

  it('keeps Ramadan next to a single match', () => {
    expect(kinds([event('a', '2026-12-01T19:00:00.000Z')])).toEqual(['a', 'ramadan']);
  });

  it('falls back to Ramadan plus the catalogue card when no match is open', () => {
    expect(kinds([])).toEqual(['ramadan', 'catalogue']);
  });

  it('skips a match that cannot be positioned on', () => {
    const list = [
      event('started', '2026-12-01T19:00:00.000Z', { statut: 'en_cours' }),
      event('over', '2026-12-02T19:00:00.000Z', { statut: 'termine' }),
      event('tbc', '2026-12-03T19:00:00.000Z', { positionable: false }),
      event('suggested', '2026-12-04T19:00:00.000Z', { source: 'suggested' }),
    ];
    expect(kinds(list)).toEqual(['ramadan', 'catalogue']);
  });

  it('treats a row without the positionable flag as open (older api rows)', () => {
    const list = [event('old', '2026-12-01T19:00:00.000Z', { positionable: undefined })];
    expect(kinds(list)).toEqual(['old', 'ramadan']);
  });
});

describe('windowHours', () => {
  it('prints the diffusion window in Tunis hours', () => {
    expect(windowHours(event('a', '2026-12-01T20:00:00.000Z'))).toBe('20h00 – 0h00');
  });

  it('a match « à confirmer » stands in the row, without provisional hours (operator 23/11)', () => {
    const tbc = event('t', '2026-12-01T20:00:00.000Z', { time_tbc: true, positionable: true });
    expect(dashboardEventCards([tbc])[0]).toEqual({ kind: 'match', event: tbc });
    expect(windowHours(tbc)).toBe('Horaire à confirmer');
    expect(windowHours({ ...tbc, time_tbc: false, date_tbc: true })).toBe('Horaire à confirmer');
  });
});
