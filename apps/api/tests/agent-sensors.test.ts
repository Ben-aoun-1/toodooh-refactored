import { describe, expect, it } from 'vitest';

import {
  type AgentVenue,
  type HubSensors,
  assignmentView,
  heatGrid,
  heatHours,
  sensorCards,
  sensorTotals,
} from '../src/lib/agent-sensors.js';

// Agent Screenhost spec VF §12 / §14 — the pure views built from the hub's answer and the agent's
// own venues (the platform decides which venues an agent sees).

const venues: AgentVenue[] = [
  { screenhost_id: 'v1', name: 'Café Nord', category: 'Cafés', status: 'en_cours' },
  { screenhost_id: 'v2', name: 'Salon Sud', category: null, status: 'en_attente_activation' },
];
const device = (over: Partial<HubSensors['devices'][number]>): HubSensors['devices'][number] => ({
  id: '1',
  label: 'pax_01',
  status: 'online',
  people: 7,
  battery_pct: 90,
  last_seen_at: '2026-11-15T09:00:00Z',
  location_id: 'v1',
  place_name: 'Café Nord (hub)',
  ...over,
});
const hub: HubSensors = {
  agent_found: true,
  devices: [
    device({}),
    device({ id: '2', label: 'pax_02', status: 'offline', people: null, battery_pct: 20 }),
    device({
      id: '3',
      label: 'pax_03',
      status: 'never',
      people: null,
      location_id: null,
      place_name: null,
    }),
    device({
      id: '4',
      label: 'pax_04',
      people: 3,
      location_id: 'elsewhere',
      place_name: 'Autre lieu',
    }),
  ],
  places: [],
};

describe('agent sensors views', () => {
  it('shows only the agent’s venues that hold a sensor; people = sum over online sensors', () => {
    const cards = sensorCards(venues, hub);
    expect(cards).toEqual([
      {
        screenhost_id: 'v1',
        name: 'Café Nord',
        category: 'Cafés',
        status: 'en_cours',
        people_now: 7,
        online: 1,
        offline: 1,
      },
    ]);
    expect(sensorTotals(cards)).toEqual({ sensors: 2, online: 1, offline: 1 });
    // A place the hub reports but that is not one of his venues never becomes a card.
    expect(cards.some((c) => c.screenhost_id === 'elsewhere')).toBe(false);
  });

  it('lists every prepared sensor to assign, with « – » battery data until it connects', () => {
    const view = assignmentView(venues, hub);
    expect(view.sensors.map((s) => [s.label, s.status, s.battery_pct, s.screenhost_name])).toEqual([
      ['pax_01', 'online', 90, 'Café Nord'],
      ['pax_02', 'offline', 20, 'Café Nord'],
      ['pax_03', 'never', null, null],
      ['pax_04', 'online', 90, 'Autre lieu'],
    ]);
    expect(view.venues).toEqual([
      { screenhost_id: 'v1', name: 'Café Nord', status: 'en_cours', sensor_count: 2 },
      { screenhost_id: 'v2', name: 'Salon Sud', status: 'en_attente_activation', sensor_count: 0 },
    ]);
  });

  it('heat-map hours follow the opening hours, else 08:00 to 23:00', () => {
    expect(heatHours(null, null)).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
    expect(heatHours(9, 12)).toEqual([9, 10, 11, 12]);
    expect(heatHours(22, 1)).toEqual([22, 23, 0, 1]);
  });

  it('a heat cell is the mean of its half-hours; a missing or empty cell stays empty', () => {
    const grid = heatGrid(
      [9, 10],
      [
        { day: 1, hour: 9, value: 10 },
        { day: 1, hour: 9, value: 15 },
        { day: 3, hour: 10, value: null },
        { day: 7, hour: 10, value: 4 },
      ],
    );
    expect(grid[0]).toEqual({ hour: 9, days: [13, null, null, null, null, null, null] });
    expect(grid[1]).toEqual({ hour: 10, days: [null, null, null, null, null, null, 4] });
  });
});
