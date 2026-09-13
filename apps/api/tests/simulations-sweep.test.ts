import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mainDb } from '../src/db/client.js';
import { type NewUser, simulations, users } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { mainDatabaseName, sandboxDatabaseName } from '../src/simulator/naming.js';
import {
  createSandboxDatabase,
  dropSandboxDatabase,
  listSandboxDatabases,
  provisionSimulation,
  sweepOrphans,
} from '../src/simulator/provisioning.js';

// A structurally sufficient silent logger: provisioning only calls info/warn/error.
const noop = (): void => undefined;
const silentLogger = (): FastifyBaseLogger => {
  const log = {
    level: 'silent',
    silent: noop,
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    child: () => log,
  };
  return log as unknown as FastifyBaseLogger;
};
const log = silentLogger();

const main = mainDatabaseName(env.DATABASE_URL);
let adminId = '';
const created: string[] = [];

const seedAdmin = async (): Promise<string> => {
  const values: NewUser = {
    email: `sim-admin-${Date.now()}@example.com`,
    contactName: 'Sim Admin',
    role: 'admin',
    status: 'approved',
  };
  const [u] = await mainDb.insert(users).values(values).returning();
  return u?.id ?? '';
};

const rowById = async (id: string) => {
  const [row] = await mainDb.select().from(simulations).where(eq(simulations.id, id));
  return row;
};

// Timeouts are 120 s on purpose: DROP DATABASE forces a checkpoint, and under the full parallel
// suite a checkpoint on the docker volume can stall for tens of seconds (measured 2026-09-13 via
// pg_stat_activity: IPC / CheckpointDone). Alone, the whole file runs in a few seconds.
describe('sandbox provisioning + orphan sweep (SIM-0)', () => {
  beforeAll(async () => {
    adminId = await seedAdmin();
  });
  afterAll(async () => {
    for (const name of created) await dropSandboxDatabase(name);
    await mainDb.delete(simulations);
  }, 60_000);

  it('provisionSimulation creates + migrates the database and flips the row to ready', async () => {
    const dbName = sandboxDatabaseName(main);
    created.push(dbName);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'p1', dbName, virtualNow: new Date(), createdBy: adminId })
      .returning();
    await provisionSimulation(row?.id ?? '', log);
    const after = await rowById(row?.id ?? '');
    expect(after?.status).toBe('ready');
    expect(after?.error).toBeNull();
    expect(await listSandboxDatabases()).toContain(dbName);
  }, 120_000);

  it('provisionSimulation marks failed (and leaves no database) when creation fails', async () => {
    // Deterministic failure: the database already exists, so CREATE DATABASE refuses. (An
    // over-long name is NOT a failure — Postgres truncates identifiers to 63 bytes silently.)
    const dbName = sandboxDatabaseName(main);
    await createSandboxDatabase(dbName);
    created.push(dbName);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'p2', dbName, virtualNow: new Date(), createdBy: adminId })
      .returning();
    await provisionSimulation(row?.id ?? '', log);
    const after = await rowById(row?.id ?? '');
    expect(after?.status).toBe('failed');
    expect(after?.error).toMatch(/already exists/);
    // The failure path drops best-effort — the pre-existing database is gone too.
    expect(await listSandboxDatabases()).not.toContain(dbName);
  }, 120_000);

  it('sweepOrphans drops a prefixed database with no row and fails a row with no database', async () => {
    const orphan = sandboxDatabaseName(main);
    await createSandboxDatabase(orphan);
    created.push(orphan);
    const ghost = sandboxDatabaseName(main);
    const [row] = await mainDb
      .insert(simulations)
      .values({
        name: 'ghost',
        dbName: ghost,
        virtualNow: new Date(),
        createdBy: adminId,
        status: 'ready',
      })
      .returning();
    const [creating] = await mainDb
      .insert(simulations)
      .values({
        name: 'still-creating',
        dbName: sandboxDatabaseName(main),
        virtualNow: new Date(),
        createdBy: adminId,
      })
      .returning();

    const result = await sweepOrphans(log);

    expect(result.dropped).toBeGreaterThanOrEqual(1);
    expect(await listSandboxDatabases()).not.toContain(orphan);
    const after = await rowById(row?.id ?? '');
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe('database missing');
    // A row still creating is the background task's — never touched by the sweep.
    expect((await rowById(creating?.id ?? ''))?.status).toBe('creating');
  }, 120_000);
});
