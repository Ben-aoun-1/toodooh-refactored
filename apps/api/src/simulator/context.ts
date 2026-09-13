import { AsyncLocalStorage } from 'node:async_hooks';

import type { DrizzleDb } from '../db/client.js';

// SIM-0 — the async context that tells db/client.ts's routed `db` which database to hit. No
// store → main (every existing code path). A store is entered by the simulation routes' LAST
// preHandler (after auth) and by the tick engine (SIM-2). Boot jobs never enter one.
export interface SandboxStore {
  simulationId: string;
  db: DrizzleDb;
}

const storage = new AsyncLocalStorage<SandboxStore>();

export const currentSandbox = (): SandboxStore | undefined => storage.getStore();

export const runInSandbox = <T>(store: SandboxStore, fn: () => Promise<T>): Promise<T> =>
  storage.run(store, fn);

/** For Fastify preHandlers: the context then covers the handler and every await under it. */
export const enterSandbox = (store: SandboxStore): void => {
  storage.enterWith(store);
};
