import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate-runner.js';
import { screenhosts } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { currentSandbox, runInSandbox } from '../src/simulator/context.js';
import { mainDatabaseName, sandboxDatabaseName, sandboxUrl } from '../src/simulator/naming.js';
import { closeAllSandboxes, sandboxHandleFor } from '../src/simulator/pools.js';
import { createSandboxDatabase, dropSandboxDatabase } from '../src/simulator/provisioning.js';

// SIM-0 — the routed `db` handle. The sandbox database is built from the primitives here
// (create + applyMigrations) so this file pins routing alone, independent of provisionSimulation.

const SIM_ID = '00000000-0000-4000-8000-000000000001';
const dbName = sandboxDatabaseName(mainDatabaseName(env.DATABASE_URL));

const countHosts = async (): Promise<number> => {
  const rows = await db.select({ id: screenhosts.id }).from(screenhosts);
  return rows.length;
};

const currentDatabase = async (): Promise<string | undefined> => {
  const rows = await db.execute(sql`select current_database() as name`);
  const first: unknown = rows[0];
  return first && typeof first === 'object' && 'name' in first && typeof first.name === 'string'
    ? first.name
    : undefined;
};

describe('routed db handle (SIM-0)', () => {
  // 180 s budgets: under the full parallel suite CREATE DATABASE waits behind the advisory lock
  // and DROP DATABASE waits on a forced checkpoint (measured 2026-09-13). Alone: a few seconds.
  beforeAll(async () => {
    await createSandboxDatabase(dbName);
    await applyMigrations(sandboxUrl(env.DATABASE_URL, dbName));
  }, 180_000);

  afterAll(async () => {
    await closeAllSandboxes();
    await dropSandboxDatabase(dbName);
  }, 180_000);

  it('resolves to main outside any context', async () => {
    expect(currentSandbox()).toBeUndefined();
    expect(await currentDatabase()).toBe(mainDatabaseName(env.DATABASE_URL));
  });

  it('routes selects, inserts, transactions and execute to the sandbox inside a context', async () => {
    // Main is SHARED with the other files of this worker — never truncate it; pin the delta.
    const mainBefore = await countHosts();
    const store = sandboxHandleFor(SIM_ID, dbName);
    await runInSandbox(store, async () => {
      expect(currentSandbox()?.simulationId).toBe(SIM_ID);
      expect(await currentDatabase()).toBe(dbName);
      await db.transaction(async (tx) => {
        await tx.insert(screenhosts).values({ name: 'Sandbox venue' });
      });
      expect(await countHosts()).toBe(1);
    });
    expect(await countHosts()).toBe(mainBefore); // main untouched
  });

  it('keeps the context across awaited hops and nested calls', async () => {
    const store = sandboxHandleFor(SIM_ID, dbName);
    const inner = async (): Promise<number> => {
      await new Promise((r) => setTimeout(r, 5));
      return countHosts();
    };
    expect(await runInSandbox(store, inner)).toBe(1);
  });

  it('caches one handle per simulation', () => {
    expect(sandboxHandleFor(SIM_ID, dbName)).toBe(sandboxHandleFor(SIM_ID, dbName));
  });
});
