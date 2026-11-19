import { describe, expect, it } from 'vitest';

import { dayPlan, plannedRunStart } from '../src/lib/fleet/plan.js';
import { type StatusInput, fleetStatus, isOpenAt, silentAfterMs } from '../src/lib/fleet/status.js';

// FLEET-1 — the screen state rule (pure): planned now vs what the TV reports.

const now = new Date('2026-03-10T10:30:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const base: StatusInput = {
  now,
  connected: false,
  lastSeenAt: minutesAgo(0.5),
  pairedAt: minutesAgo(10_000),
  plannedRepsNow: 6,
  plannedSince: minutesAgo(90),
  lastProofAt: minutesAgo(5),
  openNow: true,
};

describe('fleetStatus', () => {
  it('diffuse: online, planned, a recent pass', () => {
    expect(fleetStatus(base)).toBe('diffuse');
    expect(fleetStatus({ ...base, connected: true, lastSeenAt: minutesAgo(30) })).toBe('diffuse');
  });

  it('muet: online and planned, but silent longer than max(20 min, two intervals)', () => {
    expect(fleetStatus({ ...base, lastProofAt: minutesAgo(25) })).toBe('muet');
    expect(fleetStatus({ ...base, lastProofAt: null })).toBe('muet');
    // 3 passes an hour = one every 20 min: silent 35 min is still within two intervals.
    expect(fleetStatus({ ...base, plannedRepsNow: 3, lastProofAt: minutesAgo(35) })).toBe(
      'diffuse',
    );
    expect(fleetStatus({ ...base, plannedRepsNow: 3, lastProofAt: minutesAgo(41) })).toBe('muet');
  });

  it('too early to judge when the planned run has just begun', () => {
    expect(fleetStatus({ ...base, lastProofAt: null, plannedSince: minutesAgo(10) })).toBe(
      'diffuse',
    );
  });

  it('rien_prevu: online with nothing planned now (or a match holding the hour)', () => {
    expect(fleetStatus({ ...base, plannedRepsNow: 0, plannedSince: null, lastProofAt: null })).toBe(
      'rien_prevu',
    );
  });

  it('offline: urgent while open or planned, quiet otherwise; never connected apart', () => {
    const off = { ...base, lastSeenAt: minutesAgo(60) };
    expect(fleetStatus(off)).toBe('hors_ligne_ouverture');
    expect(fleetStatus({ ...off, plannedRepsNow: 0 })).toBe('hors_ligne_ouverture');
    expect(fleetStatus({ ...off, plannedRepsNow: 0, openNow: false })).toBe('hors_ligne');
    expect(fleetStatus({ ...off, plannedRepsNow: 0, lastSeenAt: null, pairedAt: null })).toBe(
      'jamais',
    );
  });

  it('three missed heartbeats make a TV offline', () => {
    expect(fleetStatus({ ...base, lastSeenAt: minutesAgo(1.4) })).toBe('diffuse');
    expect(fleetStatus({ ...base, lastSeenAt: minutesAgo(1.6) })).toBe('hors_ligne_ouverture');
  });

  it('silentAfterMs and isOpenAt', () => {
    expect(silentAfterMs(20)).toBe(20 * 60_000);
    expect(silentAfterMs(2)).toBe(60 * 60_000);
    expect(isOpenAt(10, 8, 22)).toBe(true);
    expect(isOpenAt(22, 8, 22)).toBe(false);
    expect(isOpenAt(1, 18, 2)).toBe(true); // open past midnight
    expect(isOpenAt(10, 18, 2)).toBe(false);
    expect(isOpenAt(10, null, null)).toBe(false);
  });
});

describe('dayPlan', () => {
  const tours = {
    campaignId: 'c1',
    campaignName: 'Alpha',
    engine: 'tours',
    rI: 0,
    creneaux: [
      { date: '2026-03-10', hour: 10, reps: 6, impressions: 60 },
      { date: '2026-03-10', hour: 11, reps: 6, impressions: 60 },
      { date: '2026-03-11', hour: 11, reps: 9, impressions: 90 },
    ],
  };
  const v1 = { campaignId: 'c2', campaignName: 'Beta', engine: 'v1', rI: 2, creneaux: [] };

  it('tours: that day’s créneaux only; v1: r_i on each opening hour; summed per hour', () => {
    const plan = dayPlan([tours, v1], '2026-03-10', 10, 12);
    expect(plan[10]).toEqual({
      hour: 10,
      reps: 8,
      campaigns: [
        { id: 'c1', name: 'Alpha', reps: 6 },
        { id: 'c2', name: 'Beta', reps: 2 },
      ],
    });
    expect(plan[12]?.reps).toBe(0);
    expect(dayPlan([v1], '2026-03-10', null, null).every((h) => h.reps === 2)).toBe(true);
  });

  it('plannedRunStart walks back over contiguous planned hours', () => {
    const plan = dayPlan([tours], '2026-03-10', null, null);
    expect(plannedRunStart(plan, 11)).toBe(10);
    expect(plannedRunStart(plan, 12)).toBeNull();
  });
});
