import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, mainDb } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate-runner.js';
import {
  type NewUser,
  campaignDispatchAllocation,
  campaignReconciliation,
  campaigns,
  proofOfPlay,
  screenhostAffluenceHourly,
  screenhosts,
  simulations,
  users,
} from '../src/db/schema.js';
import { env } from '../src/env.js';
import { runInSandbox } from '../src/simulator/context.js';
import { mainDatabaseName, sandboxDatabaseName, sandboxUrl } from '../src/simulator/naming.js';
import { closeAllSandboxes, sandboxHandleFor } from '../src/simulator/pools.js';
import { createSandboxDatabase, dropSandboxDatabase } from '../src/simulator/provisioning.js';
import { momentOf } from '../src/simulator/tick/clock.js';
import { launchCampaign } from '../src/simulator/tick/launch.js';
import { runTick } from '../src/simulator/tick/run.js';
import { simulationState } from '../src/simulator/tick/state.js';
import { generateWorld } from '../src/simulator/world/spec.js';
import { writeWorld } from '../src/simulator/world/write.js';

// SIM-2 — a whole campaign lived through virtual time: dispatched, answered by owners, aired by
// screens hour after hour, and settled when it ends. Nothing here calls a simulator
// re-implementation of a rule: every number is produced by the product's own engines.

const SEED = 'tick0001';
const START = '2026-04-06T06:00:00Z'; // a Monday, 07h Tunis
const dbName = sandboxDatabaseName(mainDatabaseName(env.DATABASE_URL));
const silent = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => silent,
  level: 'silent',
  silent: () => undefined,
};
const log = silent as unknown as import('fastify').FastifyBaseLogger;

let simulationId = '';
const inSandbox = <T>(fn: () => Promise<T>): Promise<T> =>
  runInSandbox(sandboxHandleFor(simulationId, dbName), fn);
const simulation = async () => {
  const [row] = await mainDb.select().from(simulations).where(eq(simulations.id, simulationId));
  return row!;
};

let launch: {
  campaign_id: string;
  outcome: string;
  status: string;
  allocations: number;
  budget_tnd: number;
  c_max_tnd: number;
  start_date: string;
  end_date: string;
};

describe('SIM-2 the tick (real engines on virtual time)', () => {
  beforeAll(async () => {
    const [admin] = await mainDb
      .insert(users)
      .values({
        email: `sim2-${Date.now()}@example.com`,
        contactName: 'Sim2',
        role: 'admin',
        status: 'approved',
      } satisfies NewUser)
      .returning();
    const [row] = await mainDb
      .insert(simulations)
      .values({
        name: 'tick',
        dbName,
        virtualNow: new Date(START),
        createdBy: admin?.id ?? '',
        status: 'ready',
      })
      .returning();
    simulationId = row?.id ?? '';
    await createSandboxDatabase(dbName);
    await applyMigrations(sandboxUrl(env.DATABASE_URL, dbName));

    const spec = generateWorld({
      seed: SEED,
      venues: 6,
      owners: 4,
      advertisers: 2,
      agents: 2,
      historyDays: 3,
      walletMinTnd: 4000,
      walletMaxTnd: 6000,
      virtualToday: '2026-04-06',
    });
    await inSandbox(() => writeWorld(spec, { simulationId }));
  }, 300_000);

  afterAll(async () => {
    await closeAllSandboxes();
    await dropSandboxDatabase(dbName);
    await mainDb.delete(simulations).where(eq(simulations.id, simulationId));
  }, 180_000);

  it('an advertiser launches: the REAL ceiling prices it and the REAL dispatch places it', async () => {
    const sim = await simulation();
    const result = await inSandbox(() =>
      launchCampaign({
        moment: momentOf(sim.virtualNow),
        seed: SEED,
        name: 'Campagne simulée',
        durationDays: 3,
        spotSeconds: 10,
        startInDays: 2,
        budgetShare: 0.4,
      }),
    );
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    launch = result;
    expect(result.outcome).toBe('OK');
    expect(result.c_max_tnd).toBeGreaterThan(100);
    expect(result.budget_tnd).toBeGreaterThanOrEqual(100);
    expect(result.allocations).toBeGreaterThan(0);
    // The virtual clock says it has not started yet, so it waits as « upcoming ».
    expect(result.status).toBe('upcoming');

    const pending = await inSandbox(() =>
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE')),
    );
    expect(pending[0]?.n).toBe(result.allocations);
  }, 120_000);

  it('24 virtual hours: owners answer, sensors measure, the clock moves', async () => {
    const before = await simulation();
    const result = await inSandbox(() => runTick({ simulation: before, hours: 24, log }));
    expect(result.hours).toBe(24);
    expect(result.counters.owners_answered).toBeGreaterThan(0);
    expect(result.counters.accepted + result.counters.refused).toBe(
      result.counters.owners_answered,
    );
    expect(result.counters.pax_cells).toBeGreaterThan(0);
    expect(result.counters.sps_recomputed).toBe(6); // the 03h daily sweep, once, every venue

    const after = await simulation();
    expect(after.virtualNow.getTime() - before.virtualNow.getTime()).toBe(24 * 3600 * 1000);

    const measured = await inSandbox(() =>
      db
        .select({ date: screenhostAffluenceHourly.date })
        .from(screenhostAffluenceHourly)
        .where(eq(screenhostAffluenceHourly.date, '2026-04-06')),
    );
    expect(measured.length).toBeGreaterThan(0);
  }, 300_000);

  it('the campaign runs: it goes active, screens air it, proofs pile up', async () => {
    const before = await simulation();
    const result = await inSandbox(() => runTick({ simulation: before, hours: 72, log }));
    expect(result.counters.activated).toBeGreaterThanOrEqual(1);
    expect(result.counters.proofs).toBeGreaterThan(0);

    const [campaign] = await inSandbox(() =>
      db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, launch.campaign_id)),
    );
    expect(campaign?.status).toBe('active');

    const proofs = await inSandbox(() =>
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(proofOfPlay)
        .where(eq(proofOfPlay.campaignId, launch.campaign_id)),
    );
    expect(proofs[0]?.n).toBeGreaterThan(0);
  }, 600_000);

  it('the board shows a live world: lit screens, audience now, who is airing', async () => {
    const sim = await simulation();
    const state = await inSandbox(() => simulationState(momentOf(sim.virtualNow)));
    expect(state.venues).toHaveLength(6);
    expect(state.totals.screens_total).toBeGreaterThan(0);
    expect(state.totals.screens_online).toBeGreaterThan(0);
    expect(state.campaigns).toHaveLength(1);
    expect(state.campaigns[0]?.accepted).toBeGreaterThan(0);
    expect(state.clock.date).toBe('2026-04-10');
    const airing = state.venues.filter((v) => v.airing.length > 0);
    expect(airing.length + state.venues.filter((v) => v.proofs_today > 0).length).toBeGreaterThan(
      0,
    );
  }, 120_000);

  it('when the window closes the campaign completes and the REAL reconciliation settles it', async () => {
    const before = await simulation();
    await inSandbox(() => runTick({ simulation: before, hours: 60, log }));

    const [campaign] = await inSandbox(() =>
      db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, launch.campaign_id)),
    );
    expect(campaign?.status).toBe('completed');

    const [settlement] = await inSandbox(() =>
      db
        .select({
          expected: campaignReconciliation.expectedImp,
          delivered: campaignReconciliation.deliveredImp,
          spend: campaignReconciliation.spendTnd,
          status: campaignReconciliation.status,
        })
        .from(campaignReconciliation)
        .where(eq(campaignReconciliation.campaignId, launch.campaign_id)),
    );
    expect(settlement).toBeDefined();
    expect(settlement?.expected).toBeGreaterThan(0);
    expect(Number(settlement?.spend)).toBeGreaterThanOrEqual(0);
  }, 600_000);

  it('SPS moved off its seeded value for at least one venue (the real score, on real evidence)', async () => {
    const venues = await inSandbox(() =>
      db.select({ id: screenhosts.id, sps: screenhosts.sps }).from(screenhosts),
    );
    const spec = generateWorld({
      seed: SEED,
      venues: 6,
      owners: 4,
      advertisers: 2,
      agents: 2,
      historyDays: 3,
      walletMinTnd: 4000,
      walletMaxTnd: 6000,
      virtualToday: '2026-04-06',
    });
    const seeded = new Map(spec.venues.map((v) => [v.id, v.sps]));
    const moved = venues.filter((v) => Math.abs(Number(v.sps) - (seeded.get(v.id) ?? 0)) > 0.01);
    expect(moved.length).toBeGreaterThan(0);
  });
});
