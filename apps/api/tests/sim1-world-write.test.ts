import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, mainDb } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate-runner.js';
import {
  type NewUser,
  agentReferrals,
  recharges,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhosts,
  screens,
  simulationActors,
  simulations,
  users,
} from '../src/db/schema.js';
import { env } from '../src/env.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import { addIsoDays, broadcastableHours } from '../src/lib/opening-hours.js';
import { loadPeriodAudienceInput } from '../src/lib/period-audience-source.js';
import { walletSpendable } from '../src/lib/recharges.js';
import { runInSandbox } from '../src/simulator/context.js';
import { mainDatabaseName, sandboxDatabaseName, sandboxUrl } from '../src/simulator/naming.js';
import { closeAllSandboxes, sandboxHandleFor } from '../src/simulator/pools.js';
import { createSandboxDatabase, dropSandboxDatabase } from '../src/simulator/provisioning.js';
import { type WorldSpec, generateWorld } from '../src/simulator/world/spec.js';
import {
  type WorldCounts,
  actorParams,
  sandboxIsEmpty,
  writeWorld,
} from '../src/simulator/world/write.js';

// SIM-1 — the writer, against a real sandbox. The load-bearing assertion is the LAST one: the
// REAL pool assembly, run inside the sandbox for a whole-network window, returns every generated
// venue. A world that the engine cannot see is not a world.

const VIRTUAL_TODAY = '2026-03-02';
const dbName = sandboxDatabaseName(mainDatabaseName(env.DATABASE_URL));
let simulationId = '';
let spec: WorldSpec;
let counts: WorldCounts;

const inSandbox = <T>(fn: () => Promise<T>): Promise<T> =>
  runInSandbox(sandboxHandleFor(simulationId, dbName), fn);

describe('SIM-1 writeWorld (real sandbox)', () => {
  beforeAll(async () => {
    const [admin] = await mainDb
      .insert(users)
      .values({
        email: `sim1-admin-${Date.now()}@example.com`,
        contactName: 'Sim1 Admin',
        role: 'admin',
        status: 'approved',
      } satisfies NewUser)
      .returning();
    const [row] = await mainDb
      .insert(simulations)
      .values({
        name: 'sim1',
        dbName,
        virtualNow: new Date(`${VIRTUAL_TODAY}T09:00:00Z`),
        createdBy: admin?.id ?? '',
        status: 'ready',
      })
      .returning();
    simulationId = row?.id ?? '';
    await createSandboxDatabase(dbName);
    await applyMigrations(sandboxUrl(env.DATABASE_URL, dbName));

    spec = generateWorld({
      seed: 'writer01',
      venues: 6,
      owners: 4,
      advertisers: 3,
      agents: 2,
      historyDays: 5,
      walletMinTnd: 1000,
      walletMaxTnd: 2000,
      virtualToday: VIRTUAL_TODAY,
    });
    counts = await inSandbox(() => writeWorld(spec, { simulationId }));
  }, 300_000);

  afterAll(async () => {
    await closeAllSandboxes();
    await dropSandboxDatabase(dbName);
    await mainDb.delete(simulations).where(eq(simulations.id, simulationId));
  }, 300_000);

  it('reports the sandbox non-empty afterwards (the generator refuses to run twice)', async () => {
    expect(await inSandbox(() => sandboxIsEmpty())).toBe(false);
  });

  it('writes exactly the spec: venues, screens, people, agents, referrals', async () => {
    const rows = await inSandbox(async () => ({
      venues: await db
        .select({
          id: screenhosts.id,
          sps: screenhosts.sps,
          cap: screenhosts.broadcastCapacity,
          zone: screenhosts.zoneId,
          sector: screenhosts.businessSectorId,
        })
        .from(screenhosts),
      screens: await db.select({ id: screens.id, seen: screens.lastSeenAt }).from(screens),
      users: await db
        .select({ id: users.id, role: users.role, status: users.status, email: users.email })
        .from(users),
      referrals: await db.select({ id: agentReferrals.id }).from(agentReferrals),
    }));
    expect(rows.venues).toHaveLength(6);
    expect(rows.screens).toHaveLength(counts.screens);
    expect(rows.users).toHaveLength(4 + 3 + 2);
    expect(rows.referrals).toHaveLength(spec.referrals.length);
    expect(rows.users.every((u) => u.status === 'approved')).toBe(true);
    expect(rows.users.every((u) => u.email.endsWith('@simulateur.invalid'))).toBe(true);
    expect(rows.venues.every((v) => v.cap === 4 && v.zone !== null && v.sector !== null)).toBe(
      true,
    );
    expect(rows.screens.every((s) => s.seen !== null)).toBe(true);
    const sps = rows.venues.map((v) => Number(v.sps)).sort();
    expect(sps).toEqual(spec.venues.map((v) => v.sps).sort());
  });

  it('writes the typical week as half-hour pairs and the measured past inside opening hours', async () => {
    const { grid, history } = await inSandbox(async () => ({
      grid: await db.select({ n: sql<number>`count(*)::int` }).from(screenhostAffluence),
      history: await db
        .select({
          screenhostId: screenhostAffluenceHourly.screenhostId,
          date: screenhostAffluenceHourly.date,
          hour: screenhostAffluenceHourly.hour,
          slot: screenhostAffluenceHourly.slot,
        })
        .from(screenhostAffluenceHourly),
    }));
    expect(grid[0]?.n).toBe(6 * 7 * 48);
    expect(history).toHaveLength(counts.history_cells);
    // both halves of every hour, five days, never the virtual day itself
    const dates = new Set(history.map((h) => h.date));
    expect(dates.size).toBe(5);
    expect(dates.has(VIRTUAL_TODAY)).toBe(false);
    expect(dates.has(addIsoDays(VIRTUAL_TODAY, -1))).toBe(true);
    expect(history.every((h) => h.slot === h.hour * 2 || h.slot === h.hour * 2 + 1)).toBe(true);
    const openOf = new Map(
      spec.venues.map((v) => [v.id, new Set(broadcastableHours(v.openingHour, v.closingHour))]),
    );
    expect(history.every((h) => openOf.get(h.screenhostId)?.has(h.hour) === true)).toBe(true);
  });

  it('funds every advertiser — the REAL wallet function reads the seeded amount', async () => {
    for (const advertiser of spec.advertisers) {
      const wallet = await inSandbox(() => walletSpendable(advertiser.id));
      expect(wallet.spendable_tnd).toBe(advertiser.walletTnd);
    }
    const confirmed = await inSandbox(() =>
      db.select({ ref: recharges.reference, status: recharges.status }).from(recharges),
    );
    expect(confirmed).toHaveLength(3);
    expect(confirmed.every((r) => r.status === 'confirmed')).toBe(true);
  });

  it('the measured past is what the REAL period-audience loader reads', async () => {
    const venue = spec.venues[0]!;
    const input = await inSandbox(() =>
      loadPeriodAudienceInput({
        venueId: venue.id,
        range: { from: addIsoDays(VIRTUAL_TODAY, -5), to: addIsoDays(VIRTUAL_TODAY, -1) },
        todayIso: VIRTUAL_TODAY,
      }),
    );
    const measuredDays = new Set(input.hourly.map((cell) => cell.date));
    expect(measuredDays.size).toBe(5);
    expect(input.hourly.some((c) => (c.value ?? 0) > 0)).toBe(true);
  });

  it('keeps behaviours in MAIN and never in the sandbox', async () => {
    const owners = await actorParams(simulationId, 'owner');
    const screensParams = await actorParams(simulationId, 'screen');
    expect(owners.size).toBe(4);
    expect(screensParams.size).toBe(counts.screens);
    for (const owner of spec.owners) {
      expect(owners.get(owner.id)).toEqual({
        acceptance_rate: owner.acceptanceRate,
        response_delay_hours: owner.responseDelayHours,
      });
    }
    const inMain = await mainDb
      .select({ n: sql<number>`count(*)::int` })
      .from(simulationActors)
      .where(eq(simulationActors.simulationId, simulationId));
    expect(inMain[0]?.n).toBe(4 + counts.screens + 3);
    const inSandboxActors = await inSandbox(() =>
      db.select({ n: sql<number>`count(*)::int` }).from(simulationActors),
    );
    expect(inSandboxActors[0]?.n).toBe(0);
  });

  it('stores the world card on the simulation row', async () => {
    const [row] = await mainDb
      .select({ world: simulations.world })
      .from(simulations)
      .where(eq(simulations.id, simulationId));
    const world = row?.world as { seed: string; counts: WorldCounts } | null;
    expect(world?.seed).toBe('writer01');
    expect(world?.counts.venues).toBe(6);
  });

  it('THE PROOF: the real pool assembly sees every generated venue for a whole-network window', async () => {
    const start = addIsoDays(VIRTUAL_TODAY, 3);
    const result = await inSandbox(() =>
      assemblePool(
        db,
        {
          id: '00000000-0000-4000-8000-0000000000aa',
          startDate: start,
          endDate: addIsoDays(start, 6),
        },
        { s: 10, t: 0.5, fMaxSeconds: 300 },
      ),
    );
    expect(result.candidateCount).toBe(6);
    expect(new Set(result.pool.map((p) => p.id))).toEqual(new Set(spec.venues.map((v) => v.id)));
    for (const entry of result.pool) {
      expect(entry.avgAffluence).toBeGreaterThan(0);
      expect(entry.hours).toBeGreaterThan(0);
      expect(entry.capaciteUtile).toBeGreaterThan(0);
      expect(entry.days).toHaveLength(7);
    }
  }, 60_000);
});
