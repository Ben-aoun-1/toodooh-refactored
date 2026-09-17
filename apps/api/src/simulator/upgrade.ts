import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { mainDb } from '../db/client.js';
import { applyMigrations } from '../db/migrate-runner.js';
import { simulations } from '../db/schema.js';
import { env } from '../env.js';

import { sandboxUrl } from './naming.js';

// CPM-1 — bring an EXISTING sandbox up to the deployed schema. provisionSimulation migrates a
// sandbox once, when it is created. Drizzle names every column it selects and inserts, so after a
// deploy that changes the schema (0074 is the first since SIM went live), a sandbox created
// before it would answer every campaign read with « column … does not exist ». The migrator
// applies only the pending journal entries, so for an up-to-date sandbox this is one bookkeeping
// round-trip.
//
// Two callers share one memo per process: the boot pass (server.ts) upgrades every ready sandbox
// eagerly, and the routes await the same promise before they open a pool. A request that races
// the boot pass waits for it rather than reaching the old schema, and a sandbox is never migrated
// twice at once. A sandbox whose migration throws is marked failed; its database is kept for
// inspection, and « Supprimer » drops it.

const upgrades = new Map<string, Promise<boolean>>();

/** The driver's own message when drizzle wraps it (« Failed query: … » hides the reason). */
const reasonOf = (err: unknown): string => {
  if (!(err instanceof Error)) return 'unknown error';
  return err.cause instanceof Error ? err.cause.message : err.message;
};

const runUpgrade = async (
  simulationId: string,
  dbName: string,
  log: FastifyBaseLogger,
): Promise<boolean> => {
  try {
    await applyMigrations(sandboxUrl(env.DATABASE_URL, dbName));
    return true;
  } catch (err) {
    // Only a row that is still `ready` turns failed: a concurrent delete keeps its own status.
    await mainDb
      .update(simulations)
      .set({ status: 'failed', error: `migration failed: ${reasonOf(err)}` })
      .where(and(eq(simulations.id, simulationId), eq(simulations.status, 'ready')));
    log.error({ err, simulationId, dbName }, 'simulator: sandbox upgrade failed');
    return false;
  }
};

/** Resolves true once the sandbox carries the deployed schema; false when it could not (the row
 *  is then `failed`). Rejects only when the registry itself cannot be written, and that attempt
 *  is forgotten so the next open retries. */
export const upgradeSandbox = (
  simulationId: string,
  dbName: string,
  log: FastifyBaseLogger,
): Promise<boolean> => {
  const pending = upgrades.get(simulationId);
  if (pending) return pending;
  const run = runUpgrade(simulationId, dbName, log);
  upgrades.set(simulationId, run);
  void run.catch(() => upgrades.delete(simulationId));
  return run;
};

/** Boot pass: every `ready` sandbox, one at a time (each migration holds one connection). */
export const upgradeReadySandboxes = async (
  log: FastifyBaseLogger,
): Promise<{ upgraded: number; failed: number }> => {
  const rows = await mainDb
    .select({ id: simulations.id, dbName: simulations.dbName })
    .from(simulations)
    .where(eq(simulations.status, 'ready'));
  let upgraded = 0;
  let failed = 0;
  for (const row of rows) {
    if (await upgradeSandbox(row.id, row.dbName, log)) upgraded += 1;
    else failed += 1;
  }
  if (rows.length > 0) log.info({ upgraded, failed }, 'simulator: sandboxes upgraded');
  return { upgraded, failed };
};

/** A deleted simulation's memo entry goes with it. */
export const forgetSandboxUpgrade = (simulationId: string): void => {
  upgrades.delete(simulationId);
};
