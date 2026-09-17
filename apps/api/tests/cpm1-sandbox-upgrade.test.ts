import { rmSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { mainDb } from '../src/db/client.js';
import { type NewUser, type Simulation, simulations, users } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { adminSimulationsRoutes } from '../src/routes/admin-simulations.js';
import { mainDatabaseName, sandboxDatabaseName, sandboxUrl } from '../src/simulator/naming.js';
import { closeAllSandboxes } from '../src/simulator/pools.js';
import { createSandboxDatabase, dropSandboxDatabase } from '../src/simulator/provisioning.js';
import { upgradeReadySandboxes, upgradeSandbox } from '../src/simulator/upgrade.js';

import { migrationsFolderBefore } from './helpers/migrations-before.js';

// CPM-1 — a simulator sandbox is migrated ONCE, when it is created. 0074 is the first schema
// change since SIM went live, and drizzle names every column it selects and inserts, so a sandbox
// created before the deploy would answer every campaign read with « column … does not exist ».
// These sandboxes are built at 0073 (the schema a deploy starts from) and must work after the
// upgrade path: lazily when a route opens one, and eagerly in the boot pass.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'admin', status: 'approved' },
  } as unknown as GetSessionResult);
};

const CPM1_IDX = 74;
const main = mainDatabaseName(env.DATABASE_URL);

interface Sandbox {
  id: string;
  dbName: string;
  campaignId: string;
}

let app: FastifyInstance;
let adminId = '';
let tmp = '';
const dbNames: string[] = [];
const simulationIds: string[] = [];

const withSandbox = async <T>(dbName: string, fn: (c: postgres.Sql) => Promise<T>): Promise<T> => {
  const client = postgres(sandboxUrl(env.DATABASE_URL, dbName), {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

const register = async (
  name: string,
  dbName: string,
  status: Simulation['status'],
): Promise<string> => {
  const [row] = await mainDb
    .insert(simulations)
    .values({ name, dbName, virtualNow: new Date(), createdBy: adminId, status })
    .returning({ id: simulations.id });
  const id = row?.id ?? '';
  simulationIds.push(id);
  return id;
};

/** A registered sandbox whose schema stops at 0073, with a dated classic campaign in it.
 *  `breakCpm` pre-creates a conflicting column so 0074's ALTER TABLE throws. */
const sandboxAt0073 = async (name: string, opts: { breakCpm?: boolean } = {}): Promise<Sandbox> => {
  const dbName = sandboxDatabaseName(main);
  await createSandboxDatabase(dbName);
  dbNames.push(dbName);
  const campaignId = await withSandbox(dbName, async (c) => {
    await migrate(drizzle(c), { migrationsFolder: tmp });
    await c`update dispatch_config set standard_cpm_tnd = '18.000', event_cpm_tnd = '27.000'`;
    const [adv] = await c<{ id: string }[]>`
      insert into users (email, contact_name) values (${`${name}@example.com`}, ${name})
      returning id`;
    const [camp] = await c<{ id: string }[]>`
      insert into campaigns (advertiser_id, name, campaign_type, start_date, end_date)
      values (${adv?.id ?? ''}, ${name}, 'standard', '2027-03-01', '2027-03-07') returning id`;
    if (opts.breakCpm) await c`alter table campaigns add column standard_cpm_tnd text`;
    return camp?.id ?? '';
  });
  const id = await register(name, dbName, 'ready');
  return { id, dbName, campaignId };
};

const cpmColumns = (dbName: string): Promise<string[]> =>
  withSandbox(dbName, async (c) => {
    const rows = await c<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'campaigns' and column_name in ('standard_cpm_tnd', 'event_cpm_tnd')
      order by column_name`;
    return rows.map((r) => r.column_name);
  });

const statusOf = async (id: string) => {
  const [row] = await mainDb
    .select({ status: simulations.status, error: simulations.error })
    .from(simulations)
    .where(eq(simulations.id, id));
  return row;
};

// 300 s timeouts: the same contention budget as the other simulator files (CREATE DATABASE
// serialises behind one advisory lock; a full migrate competes with the whole parallel suite).
describe('CPM-1 — a sandbox created before 0074 is brought forward', () => {
  beforeAll(async () => {
    tmp = migrationsFolderBefore(CPM1_IDX);
    const [admin] = await mainDb
      .insert(users)
      .values({
        email: `cpm1-sim-${Date.now()}@example.com`,
        contactName: 'CPM1 Sim',
        role: 'admin',
        status: 'approved',
      } satisfies NewUser)
      .returning({ id: users.id });
    adminId = admin?.id ?? '';
    app = Fastify({ logger: false });
    await app.register(adminSimulationsRoutes, { enabled: true, maxSandboxes: 5 });
    await app.ready();
  }, 300_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app.close();
    await closeAllSandboxes();
    for (const name of dbNames) await dropSandboxDatabase(name);
    for (const id of simulationIds) {
      await mainDb.delete(simulations).where(eq(simulations.id, id));
    }
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }, 300_000);

  it('a route opening a pre-0074 sandbox migrates it first, and the campaign keeps the sandbox’s CPM', async () => {
    const sb = await sandboxAt0073('cpm1-lazy');
    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${sb.id}/campaigns/${sb.campaignId}/eligible-hosts`,
    });
    expect(res.statusCode).toBe(200);
    // Backfilled from the SANDBOX's own dispatch_config (18 / 27), not main's.
    expect(res.json<{ cpm_tnd: number }>().cpm_tnd).toBe(18);
    expect(await cpmColumns(sb.dbName)).toEqual(['event_cpm_tnd', 'standard_cpm_tnd']);
    expect((await statusOf(sb.id))?.status).toBe('ready');
  }, 300_000);

  it('a sandbox whose migration throws is marked failed and the route answers 409 NOT_READY', async () => {
    const sb = await sandboxAt0073('cpm1-broken-lazy', { breakCpm: true });
    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${sb.id}/campaigns/${sb.campaignId}/eligible-hosts`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SIMULATION_NOT_READY', status: 'failed' });
    const after = await statusOf(sb.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/standard_cpm_tnd/);
  }, 300_000);

  it('the boot pass upgrades every ready sandbox, fails the broken ones, and leaves the rest alone', async () => {
    const ready = await sandboxAt0073('cpm1-boot');
    const broken = await sandboxAt0073('cpm1-broken-boot', { breakCpm: true });
    // Not ready: never opened, never migrated — an empty database stays empty.
    const idleDb = sandboxDatabaseName(main);
    await createSandboxDatabase(idleDb);
    dbNames.push(idleDb);
    const idle = await register('cpm1-idle', idleDb, 'failed');

    const log = app.log;
    const result = await upgradeReadySandboxes(log);

    expect(result.upgraded).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await cpmColumns(ready.dbName)).toEqual(['event_cpm_tnd', 'standard_cpm_tnd']);
    expect((await statusOf(ready.id))?.status).toBe('ready');
    expect((await statusOf(broken.id))?.status).toBe('failed');
    expect((await statusOf(broken.id))?.error).toMatch(/standard_cpm_tnd/);
    expect((await statusOf(idle))?.status).toBe('failed');
    const idleSchemas = await withSandbox(
      idleDb,
      (c) =>
        c<{ n: number }[]>`select count(*)::int as n from pg_namespace where nspname = 'drizzle'`,
    );
    expect(idleSchemas[0]?.n).toBe(0);

    // The upgraded sandbox now serves the campaign routes, and a second pass is a no-op.
    mockSession(adminId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/simulations/${ready.id}/campaigns/${ready.campaignId}/eligible-hosts`,
    });
    expect(res.statusCode).toBe(200);
    expect(await upgradeSandbox(ready.id, ready.dbName, log)).toBe(true);
  }, 300_000);
});
