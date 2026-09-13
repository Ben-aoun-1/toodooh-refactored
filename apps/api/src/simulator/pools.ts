import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema.js';
import { env } from '../env.js';

import type { SandboxStore } from './context.js';
import { sandboxUrl } from './naming.js';

// SIM-0 — one small pool per OPEN sandbox, cached by simulation id. Bounded: at most
// SIMULATOR_MAX_SANDBOXES × 3 connections, idle connections closed by postgres.js after 60 s,
// whole entries evicted after 15 min without use (server.ts ticks evictIdleSandboxes).
interface Entry {
  store: SandboxStore;
  client: ReturnType<typeof postgres>;
  lastUsed: number;
}

const IDLE_EVICT_MS = 15 * 60 * 1000;
const entries = new Map<string, Entry>();

export const sandboxHandleFor = (simulationId: string, dbName: string): SandboxStore => {
  const hit = entries.get(simulationId);
  if (hit) {
    hit.lastUsed = Date.now();
    return hit.store;
  }
  const client = postgres(sandboxUrl(env.DATABASE_URL, dbName), {
    max: 3,
    idle_timeout: 60,
    connect_timeout: 10,
  });
  const store: SandboxStore = { simulationId, db: drizzle(client, { schema }) };
  entries.set(simulationId, { store, client, lastUsed: Date.now() });
  return store;
};

export const evictSandbox = async (simulationId: string): Promise<void> => {
  const entry = entries.get(simulationId);
  if (!entry) return;
  entries.delete(simulationId);
  await entry.client.end({ timeout: 5 });
};

export const evictIdleSandboxes = async (now: number = Date.now()): Promise<number> => {
  let evicted = 0;
  for (const [id, entry] of entries) {
    if (now - entry.lastUsed > IDLE_EVICT_MS) {
      await evictSandbox(id);
      evicted += 1;
    }
  }
  return evicted;
};

export const closeAllSandboxes = async (): Promise<void> => {
  for (const id of [...entries.keys()]) await evictSandbox(id);
};

export const openSandboxCount = (): number => entries.size;
