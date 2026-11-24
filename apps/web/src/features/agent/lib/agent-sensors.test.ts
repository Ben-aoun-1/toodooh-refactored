import { describe, expect, it } from 'vitest';

import type { AssignableSensor, SensorVenueCard } from '../services/agent-sensors.service';

import {
  assignCounts,
  batteryLabel,
  curvePoints,
  filterAssignable,
  filterSensorVenues,
  heatMax,
  heatStep,
  lastActivity,
  offlineBanner,
  pickerSubline,
  pickerVenues,
} from './agent-sensors';

const card = (over: Partial<SensorVenueCard>): SensorVenueCard => ({
  screenhost_id: 'v',
  name: 'Café Nord',
  category: null,
  status: 'en_cours',
  people_now: 0,
  online: 1,
  offline: 0,
  ...over,
});
const sensor = (over: Partial<AssignableSensor>): AssignableSensor => ({
  id: '1',
  label: 'pax_01',
  status: 'online',
  battery_pct: 90,
  screenhost_id: null,
  screenhost_name: null,
  ...over,
});

describe('Suivi des capteurs (spec VF §12)', () => {
  it('the banner is singular, plural or absent', () => {
    expect(offlineBanner(0)).toBeNull();
    expect(offlineBanner(1)).toContain('Un capteur hors ligne');
    expect(offlineBanner(3)).toContain('Les capteurs hors ligne');
  });

  it('filters by sensor state and by name', () => {
    const rows = [
      card({ screenhost_id: 'a', name: 'Café Nord', online: 1, offline: 1 }),
      card({ screenhost_id: 'b', name: 'Salon Sud', online: 0, offline: 2 }),
      card({ screenhost_id: 'c', name: 'Gym Est', online: 2, offline: 0 }),
    ];
    expect(filterSensorVenues(rows, 'on', '').map((r) => r.screenhost_id)).toEqual(['a', 'c']);
    expect(filterSensorVenues(rows, 'off', '').map((r) => r.screenhost_id)).toEqual(['a', 'b']);
    expect(filterSensorVenues(rows, 'all', 'sud').map((r) => r.screenhost_id)).toEqual(['b']);
  });

  it('formats a sensor line and the curve', () => {
    expect(batteryLabel(null)).toBe('–');
    expect(batteryLabel(20)).toBe('20 %');
    expect(lastActivity(null)).toBe('–');
    expect(lastActivity('2026-11-15T09:55:00Z', new Date('2026-11-15T10:00:00Z'))).toBe(
      'il y a 5 minutes',
    );
    expect(curvePoints([0, null, 10])).toEqual([
      [0, 170],
      [380, 170],
      [760, 10],
    ]);
  });

  it('shades a heat cell against the grid maximum', () => {
    expect(heatMax([{ days: [1, null, 8] }, { days: [4, 2, null] }])).toBe(8);
    expect(heatStep(null, 8)).toBe(0);
    expect(heatStep(1, 8)).toBe(1);
    expect(heatStep(8, 8)).toBe(5);
    expect(heatStep(4, 8)).toBe(3);
  });
});

describe('Assigner mes capteurs (spec VF §14)', () => {
  const sensors = [
    sensor({ id: '1', label: 'pax_01', screenhost_id: 'a', screenhost_name: 'Café Nord' }),
    sensor({ id: '2', label: 'pax_02', status: 'never', battery_pct: null }),
  ];
  it('counts and filters the sensors', () => {
    expect(assignCounts(sensors)).toEqual({ all: 2, free: 1, done: 1 });
    expect(filterAssignable(sensors, 'free', '').map((s) => s.id)).toEqual(['2']);
    expect(filterAssignable(sensors, 'done', '').map((s) => s.id)).toEqual(['1']);
    expect(filterAssignable(sensors, 'all', 'nord').map((s) => s.id)).toEqual(['1']);
  });
  it('puts the venue the agent came from first and words its line', () => {
    const venues = [
      { screenhost_id: 'a', name: 'Café Nord', status: 'en_cours' as const, sensor_count: 2 },
      {
        screenhost_id: 'b',
        name: 'Salon Sud',
        status: 'en_attente_activation' as const,
        sensor_count: 0,
      },
    ];
    expect(pickerVenues(venues, '', 'b').map((v) => v.screenhost_id)).toEqual(['b', 'a']);
    expect(pickerVenues(venues, 'café', null).map((v) => v.screenhost_id)).toEqual(['a']);
    expect(pickerSubline(venues[0]!)).toBe('Affilié · 2 capteurs');
    expect(pickerSubline(venues[1]!)).toBe("En attente d'activation · aucun capteur");
  });
});
