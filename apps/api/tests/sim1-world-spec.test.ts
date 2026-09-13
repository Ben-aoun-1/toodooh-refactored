import { describe, expect, it } from 'vitest';

import { broadcastableHours } from '../src/lib/opening-hours.js';
import { createRng } from '../src/simulator/world/rng.js';
import { OWNER_SECTORS } from '../src/simulator/world/sectors.js';
import { type WorldParams, generateWorld, historyCells } from '../src/simulator/world/spec.js';

// SIM-1 — the pure generator. No database: everything here is a function of the params.

const params = (over: Partial<WorldParams> = {}): WorldParams => ({
  seed: 'abcdef01',
  venues: 12,
  owners: 8,
  advertisers: 6,
  agents: 2,
  historyDays: 28,
  walletMinTnd: 500,
  walletMaxTnd: 5000,
  virtualToday: '2026-03-02',
  ...over,
});

describe('SIM-1 rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = Array.from({ length: 5 }, () => createRng('seed-a').next());
    const b = Array.from({ length: 5 }, () => createRng('seed-a').next());
    expect(a).toEqual(b);
    expect(createRng('seed-b').next()).not.toBe(createRng('seed-a').next());
  });

  it('draws uuids Postgres accepts (v4 shape)', () => {
    const rng = createRng('uuids');
    for (let i = 0; i < 50; i += 1) {
      expect(rng.uuid()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('respects bounds', () => {
    const rng = createRng('bounds');
    for (let i = 0; i < 200; i += 1) {
      const n = rng.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });
});

describe('SIM-1 generateWorld', () => {
  it('same params → byte-identical world; a different seed → a different world', () => {
    expect(generateWorld(params())).toEqual(generateWorld(params()));
    expect(JSON.stringify(generateWorld(params({ seed: 'other' })))).not.toBe(
      JSON.stringify(generateWorld(params())),
    );
  });

  it('honours the counts asked for', () => {
    const w = generateWorld(params({ venues: 20, owners: 9, advertisers: 4, agents: 2 }));
    expect(w.venues).toHaveLength(20);
    expect(w.owners).toHaveLength(9);
    expect(w.advertisers).toHaveLength(4);
    expect(w.agents).toHaveLength(2);
    expect(new Set(w.venues.map((v) => v.id)).size).toBe(20);
    expect(new Set([...w.owners, ...w.advertisers, ...w.agents].map((p) => p.email)).size).toBe(15);
  });

  it('every venue is dispatchable by construction: hours open, capacity set, one zone-less field missing never', () => {
    const w = generateWorld(params({ venues: 40 }));
    for (const v of w.venues) {
      expect(broadcastableHours(v.openingHour, v.closingHour).length).toBeGreaterThan(0);
      expect(v.broadcastCapacity).toBe(4);
      expect(v.sps).toBeGreaterThanOrEqual(35);
      expect(v.sps).toBeLessThanOrEqual(85);
      expect(v.screens.length).toBeGreaterThanOrEqual(1);
      expect(OWNER_SECTORS.map((s) => s.name)).toContain(v.sector);
    }
  });

  it('grids are 7 × 24, non-negative, and non-empty over the open hours', () => {
    const w = generateWorld(params({ venues: 10 }));
    for (const v of w.venues) {
      expect(v.grid).toHaveLength(7);
      for (const day of v.grid) {
        expect(day).toHaveLength(24);
        for (const value of day) expect(value).toBeGreaterThanOrEqual(0);
      }
      const open = broadcastableHours(v.openingHour, v.closingHour);
      const total = v.grid.reduce(
        (sum, day) => sum + open.reduce((s, h) => s + (day[h] ?? 0), 0),
        0,
      );
      expect(total).toBeGreaterThan(0);
    }
  });

  it('demographics sum to 100 on both axes', () => {
    for (const v of generateWorld(params({ venues: 30 })).venues) {
      const d = v.demographics;
      expect(d.genderMalePct + d.genderFemalePct).toBe(100);
      expect(d.age17To30Pct + d.age31To45Pct + d.age46PlusPct).toBe(100);
    }
  });

  it('class and sector mixes follow the configured weights at scale', () => {
    const w = generateWorld(params({ venues: 60, owners: 30 }));
    const share = (n: number) => (n / 60) * 100;
    const populaire = share(w.venues.filter((v) => v.venueClass === 'populaire').length);
    const premium = share(w.venues.filter((v) => v.venueClass === 'premium').length);
    expect(Math.abs(populaire - 50)).toBeLessThanOrEqual(15);
    expect(Math.abs(premium - 20)).toBeLessThanOrEqual(15);
    const cafes = share(w.venues.filter((v) => v.sector === 'Café').length);
    expect(Math.abs(cafes - 35)).toBeLessThanOrEqual(15);
  });

  it('wallets stay in range and each advertiser gets a unique recharge reference', () => {
    const w = generateWorld(params({ advertisers: 10, walletMinTnd: 800, walletMaxTnd: 1200 }));
    for (const a of w.advertisers) {
      expect(a.walletTnd).toBeGreaterThanOrEqual(800);
      expect(a.walletTnd).toBeLessThanOrEqual(1200);
    }
    expect(new Set(w.advertisers.map((a) => a.rechargeReference)).size).toBe(10);
  });

  it('venues spread over owners, and an owner with several venues is a fleet_owner', () => {
    const w = generateWorld(params({ venues: 12, owners: 5 }));
    for (const owner of w.owners) {
      const owned = w.venues.filter((v) => v.ownerId === owner.id).length;
      expect(owned).toBeGreaterThanOrEqual(1);
      expect(owner.role).toBe(owned > 1 ? 'fleet_owner' : 'individual_owner');
    }
    expect(w.venues.every((v) => w.owners.some((o) => o.id === v.ownerId))).toBe(true);
  });

  it('owner and screen behaviours are inside their ranges', () => {
    const w = generateWorld(params({ venues: 20, owners: 12 }));
    for (const o of w.owners) {
      expect(o.acceptanceRate).toBeGreaterThanOrEqual(0.55);
      expect(o.acceptanceRate).toBeLessThanOrEqual(0.95);
      expect(o.responseDelayHours).toBeGreaterThanOrEqual(1);
      expect(o.responseDelayHours).toBeLessThanOrEqual(36);
    }
    for (const s of w.venues.flatMap((v) => v.screens)) {
      expect(s.offlineProbability).toBeGreaterThanOrEqual(0);
      expect(s.offlineProbability).toBeLessThanOrEqual(0.08);
    }
  });

  it('referrals point at real agents and never at the agents themselves', () => {
    const w = generateWorld(params({ owners: 10, advertisers: 10 }));
    const agentIds = new Set(w.agents.map((a) => a.id));
    const referred = new Set([...w.owners, ...w.advertisers].map((p) => p.id));
    for (const r of w.referrals) {
      expect(agentIds.has(r.agentId)).toBe(true);
      expect(referred.has(r.referredId)).toBe(true);
      expect(agentIds.has(r.referredId)).toBe(false);
    }
    expect(new Set(w.referrals.map((r) => r.referredId)).size).toBe(w.referrals.length);
  });

  it('no agents asked for → no agents and no referrals', () => {
    const w = generateWorld(params({ agents: 0 }));
    expect(w.agents).toHaveLength(0);
    expect(w.referrals).toHaveLength(0);
  });
});

describe('SIM-1 historyCells', () => {
  it('covers exactly the requested days, stops before the virtual day, and stays inside opening hours', () => {
    const w = generateWorld(params({ venues: 3, historyDays: 7 }));
    for (const v of w.venues) {
      const cells = historyCells(w, v);
      const days = new Set(cells.map((c) => c.date));
      expect(days.size).toBe(7);
      expect([...days].sort()).toEqual([
        '2026-02-23',
        '2026-02-24',
        '2026-02-25',
        '2026-02-26',
        '2026-02-27',
        '2026-02-28',
        '2026-03-01',
      ]);
      expect(days.has('2026-03-02')).toBe(false);
      const open = new Set(broadcastableHours(v.openingHour, v.closingHour));
      for (const c of cells) {
        expect(open.has(c.hour)).toBe(true);
        expect(c.value).toBeGreaterThanOrEqual(0);
      }
      expect(cells).toHaveLength(7 * open.size);
    }
  });

  it('is deterministic and independent of the order venues are processed in', () => {
    const w = generateWorld(params({ venues: 4, historyDays: 3 }));
    const first = historyCells(w, w.venues[2]!);
    const again = historyCells(w, w.venues[2]!);
    expect(first).toEqual(again);
    expect(
      historyCells(generateWorld(params({ venues: 4, historyDays: 3 })), w.venues[2]!),
    ).toEqual(first);
  });

  it('no history days → no cells', () => {
    const w = generateWorld(params({ venues: 2, historyDays: 0 }));
    expect(historyCells(w, w.venues[0]!)).toHaveLength(0);
  });
});
