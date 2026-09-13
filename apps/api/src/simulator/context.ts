import { AsyncLocalStorage } from 'node:async_hooks';

import type { DrizzleDb } from '../db/client.js';

// SIM-0 — the async context that tells db/client.ts's routed `db` which database to hit. No
// store → main (every existing code path). A store is entered by the simulation routes' LAST
// preHandler (after auth) and by the tick engine (SIM-2). Boot jobs never enter one.
//
// ⚠️ Only `runInSandbox` (AsyncLocalStorage.run) is offered — `enterWith` from an ASYNC Fastify
// preHandler does NOT reach the route handler (the hook runner continues on its own async
// resource; measured 2026-09-13: the probe counted MAIN). A callback-style hook calling `done()`
// INSIDE `runInSandbox` is the pattern that propagates (routes/admin-simulations.ts).
export interface SandboxStore {
  simulationId: string;
  db: DrizzleDb;
}

const storage = new AsyncLocalStorage<SandboxStore>();

export const currentSandbox = (): SandboxStore | undefined => storage.getStore();

/** Runs `fn` with `store` as the active sandbox; sync or async, the return value passes through. */
export const runInSandbox = <T>(store: SandboxStore, fn: () => T): T => storage.run(store, fn);
