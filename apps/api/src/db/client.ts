import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../env.js';
import { currentSandbox } from '../simulator/context.js';

import * as schema from './schema.js';

// postgres.js connects lazily on first query, so importing this module
// does not open a connection.
export const sql = postgres(env.DATABASE_URL);

/** The MAIN handle. Import this ONLY where routing must be bypassed on purpose (the simulations
 *  registry lives in main; the routes touch it from inside a sandbox context). */
export const mainDb = drizzle(sql, { schema });

export type DrizzleDb = typeof mainDb;

// SIM-0 — `db` is ROUTED: inside a simulation context (simulator/context.ts) every property read
// resolves on the sandbox handle; outside, on main — so the 87 importers and the boot jobs behave
// exactly as before. Functions are bound to the resolved target so drizzle's internal `this`
// stays on one handle for the whole call. The Proxy target IS mainDb (same type, no cast).
const resolve = (): DrizzleDb => currentSandbox()?.db ?? mainDb;

export const db: DrizzleDb = new Proxy(mainDb, {
  get(_target, prop) {
    const target = resolve();
    const value: unknown = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
