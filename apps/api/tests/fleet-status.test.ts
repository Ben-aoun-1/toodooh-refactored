import { describe, expect, it } from 'vitest';

import { eventDayPlan, expectedDayPlan, podAt, podCampaigns } from '../src/lib/fleet/event-pods.js';
import { dayPlan, plannedRunStart } from '../src/lib/fleet/plan.js';
import {
  type StatusInput,
  fleetStatus,
  isOpenAt,
  matchStatus,
  silentAfterMs,
} from '../src/lib/fleet/status.js';

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

// FLEET-3 — a match: classic is paused, the venue airs ad pages (pods). now = 11:30 Tunis.
describe('FLEET-3 — the ad pages of a match', () => {
  const slot = (m: number, id: string) => ({ at: minutesAgo(m), campaignId: id, campaignName: id });
  // A page 11:14–11:20 (ended 10 min ago), one 11:34–11:40 (opens in 4 min).
  const ended = {
    start: minutesAgo(16),
    end: minutesAgo(10),
    slots: [slot(16, 'A'), slot(15, 'B'), slot(14, 'A')],
  };
  const coming = { start: minutesAgo(-4), end: minutesAgo(-10), slots: [slot(-4, 'A')] };
  const live = { start: minutesAgo(2), end: minutesAgo(-4), slots: [slot(2, 'A'), slot(1, 'B')] };

  it('finds the page on air, the one just ended and the next one', () => {
    expect(podAt([coming, ended], now)).toEqual({ pod: ended, live: false, next: coming });
    expect(podAt([ended, live], now)).toEqual({ pod: live, live: true, next: null });
    // A page is forgotten 20 minutes after its end.
    const old = { ...ended, start: minutesAgo(40), end: minutesAgo(34) };
    expect(podAt([old], now)).toEqual({ pod: null, live: false, next: null });
    expect(podAt([], now)).toEqual({ pod: null, live: false, next: null });
  });

  it('a page on air: diffuse once a pass arrived, muet after the grace', () => {
    expect(matchStatus(now, live, minutesAgo(1))).toBe('diffuse');
    expect(matchStatus(now, live, minutesAgo(30))).toBe('muet');
    expect(matchStatus(now, live, null)).toBe('muet');
    // The page opened a minute ago: too early to judge.
    expect(matchStatus(now, { start: minutesAgo(1), end: minutesAgo(-5) }, null)).toBe('diffuse');
  });

  it('a page just ended: nothing planned if it aired, muet if the screen missed it', () => {
    expect(matchStatus(now, ended, minutesAgo(11))).toBe('rien_prevu');
    expect(matchStatus(now, ended, minutesAgo(50))).toBe('muet');
    expect(matchStatus(now, null, minutesAgo(50))).toBe('rien_prevu');
  });

  it('fleetStatus follows the pages during a match, whatever the classic plan says', () => {
    const inMatch = { ...base, plannedRepsNow: 0, plannedSince: null };
    expect(fleetStatus({ ...inMatch, match: { pod: null }, lastProofAt: null })).toBe('rien_prevu');
    expect(fleetStatus({ ...inMatch, match: { pod: live }, lastProofAt: minutesAgo(1) })).toBe(
      'diffuse',
    );
    expect(fleetStatus({ ...inMatch, match: { pod: ended }, lastProofAt: minutesAgo(50) })).toBe(
      'muet',
    );
    // Offline stays offline.
    expect(fleetStatus({ ...inMatch, match: { pod: live }, lastSeenAt: minutesAgo(60) })).toBe(
      'hors_ligne_ouverture',
    );
  });

  it('counts the event passes hour by hour and drops classic from a full match hour', () => {
    expect(podCampaigns(ended)).toEqual([
      { id: 'A', name: 'A', reps: 2 },
      { id: 'B', name: 'B', reps: 1 },
    ]);
    const event = eventDayPlan([ended, coming], '2026-03-10');
    expect(event[11]).toMatchObject({ reps: 4 });
    expect(eventDayPlan([ended], '2026-03-11')[11]?.reps).toBe(0);
    const classic = dayPlan(
      [{ campaignId: 'c', campaignName: 'Classic', engine: 'v1', rI: 6, creneaux: [] }],
      '2026-03-10',
      null,
      null,
    );
    const blackout = Array.from({ length: 24 }, (_, h) => (h === 11 ? 60 : h === 12 ? 30 : 0));
    const plan = expectedDayPlan(classic, event, blackout);
    expect(plan[10]).toMatchObject({ reps: 6 });
    expect(plan[11]).toMatchObject({ reps: 4 });
    expect(plan[11]?.campaigns.map((c) => c.id)).toEqual(['A', 'B']);
    expect(plan[12]).toMatchObject({ reps: 6 });
  });
});
