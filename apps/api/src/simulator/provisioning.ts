import { eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import postgres from 'postgres';

import { mainDb } from '../db/client.js';
import { applyMigrations } from '../db/migrate-runner.js';
import { simulations } from '../db/schema.js';
import { env } from '../env.js';

import {
  mainDatabaseName,
  maintenanceUrl,
  quoteIdent,
  sandboxPrefix,
  sandboxUrl,
} from './naming.js';
import { evictSandbox } from './pools.js';

// SIM-0 — sandbox database lifecycle. Every statement runs on a max-1 maintenance connection to
// the server's `postgres` database (CREATE/DROP DATABASE cannot target the connected one).
// `provisionSimulation` is the background task behind POST /api/admin/simulations: it never
// throws, flips the registry row to ready/failed, and leaves no half-built database behind.
// The registry lives in MAIN, hence `mainDb` throughout — this module may be called from inside
// a sandbox context one day and must still write the registry, not the sandbox.

const withMaintenance = async <T>(fn: (admin: postgres.Sql) => Promise<T>): Promise<T> => {
  const admin = postgres(maintenanceUrl(env.DATABASE_URL), { max: 1 });
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
};

// CREATE DATABASE copies template1 and refuses (55006 object_in_use, « is being accessed by
// other users ») while another backend is mid-copy from the same template. Two admins clicking
// « Créer » at once — or two vitest workers — must not turn that race into a « failed » row: the
// creates serialise behind ONE server-wide advisory lock, and the object_in_use case retries.
const CREATE_DB_LOCK_KEY = 7400710;
const CREATE_RETRIES = 5;
const CREATE_RETRY_MS = 250;

const isObjectInUse = (err: unknown): boolean =>
  err instanceof Error && 'code' in err && err.code === '55006';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const createSandboxDatabase = (dbName: string): Promise<void> =>
  withMaintenance(async (admin) => {
    await admin`SELECT pg_advisory_lock(${CREATE_DB_LOCK_KEY})`;
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await admin.unsafe(`CREATE DATABASE ${quoteIdent(dbName)}`);
          return;
        } catch (err) {
          if (!isObjectInUse(err) || attempt >= CREATE_RETRIES) throw err;
          await sleep(CREATE_RETRY_MS * attempt);
        }
      }
    } finally {
      await admin`SELECT pg_advisory_unlock(${CREATE_DB_LOCK_KEY})`;
    }
  });

export const dropSandboxDatabase = (dbName: string): Promise<void> =>
  withMaintenance(async (admin) => {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`);
  });

export const listSandboxDatabases = (): Promise<string[]> =>
  withMaintenance(async (admin) => {
    const prefix = sandboxPrefix(mainDatabaseName(env.DATABASE_URL));
    const rows = await admin<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE ${`${prefix}%`} ORDER BY datname`;
    return rows.map((r) => r.datname);
  });

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'unknown error';

export const provisionSimulation = async (
  simulationId: string,
  log: FastifyBaseLogger,
): Promise<void> => {
  const [row] = await mainDb
    .select({ dbName: simulations.dbName })
    .from(simulations)
    .where(eq(simulations.id, simulationId))
    .limit(1);
  if (!row) {
    log.warn({ simulationId }, 'simulator: provision skipped, row missing');
    return;
  }
  try {
    await createSandboxDatabase(row.dbName);
    await applyMigrations(sandboxUrl(env.DATABASE_URL, row.dbName));
    await mainDb
      .update(simulations)
      .set({ status: 'ready', error: null })
      .where(eq(simulations.id, simulationId));
    log.info({ simulationId, dbName: row.dbName }, 'simulator: sandbox ready');
  } catch (err) {
    const message = errorMessage(err);
    await dropSandboxDatabase(row.dbName).catch(() => undefined);
    await mainDb
      .update(simulations)
      .set({ status: 'failed', error: message })
      .where(eq(simulations.id, simulationId));
    log.error({ err, simulationId, dbName: row.dbName }, 'simulator: sandbox provisioning failed');
  }
};

export const deleteSimulation = async (simulationId: string, dbName: string): Promise<void> => {
  await mainDb
    .update(simulations)
    .set({ status: 'deleting' })
    .where(eq(simulations.id, simulationId));
  await evictSandbox(simulationId);
  await dropSandboxDatabase(dbName);
  await mainDb.delete(simulations).where(eq(simulations.id, simulationId));
};

/** Boot-time reconciliation: drop prefixed databases with no registry row; mark rows whose
 *  database is gone as failed. Rows still `creating` belong to a running background task and
 *  are skipped. */
export const sweepOrphans = async (
  log: FastifyBaseLogger,
): Promise<{ dropped: number; markedFailed: number }> => {
  const onServer = await listSandboxDatabases();
  const rows = await mainDb
    .select({ id: simulations.id, dbName: simulations.dbName, status: simulations.status })
    .from(simulations);
  const known = new Set(rows.map((r) => r.dbName));

  let dropped = 0;
  for (const name of onServer) {
    if (!known.has(name)) {
      await dropSandboxDatabase(name);
      dropped += 1;
      log.warn({ dbName: name }, 'simulator: dropped orphan sandbox database');
    }
  }

  const present = new Set(onServer);
  const missing = rows
    .filter((r) => r.status !== 'creating' && !present.has(r.dbName))
    .map((r) => r.id);
  if (missing.length > 0) {
    await mainDb
      .update(simulations)
      .set({ status: 'failed', error: 'database missing' })
      .where(inArray(simulations.id, missing));
    for (const id of missing) log.warn({ simulationId: id }, 'simulator: sandbox database missing');
  }
  return { dropped, markedFailed: missing.length };
};
