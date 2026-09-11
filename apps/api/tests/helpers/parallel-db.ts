// Parallel api suite — one Postgres database PER VITEST WORKER, cloned from a migrated template.
//
// Why: the suite ran with `fileParallelism: false` because many files TRUNCATE the same tables
// (signup, profile, admin…). Serial on one DB was 579 s of test time for 1740 tests in CI
// (2026-09-11 measurement) — no hot spot, just per-file DB cost × one lane. Giving each worker
// its own copy of the schema removes the shared-state reason for the serialisation without
// touching a single test.
//
// How: `global-setup.ts` (main process, once) creates a FRESH template `<base>_tpl` (drop +
// create + migrate from 0000 — never the base DB in place, whose schema may carry local residue)
// and then `CREATE DATABASE <base>_w<i> TEMPLATE <base>_tpl` for i in 1..workerCount. `setup-worker-db.ts`
// (each worker, before any test file imports src/env.ts) rewrites DATABASE_URL to the worker's
// copy using VITEST_POOL_ID. Tests keep truncating "their" tables — now in a private database.
import os from 'node:os';

export const FALLBACK_DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';

/** Server + credentials + base name. The base DB itself is only used to derive names; the suite
 *  never writes to it (CI: the service DB; locally: the test DB — never the dev DB). */
export const baseDatabaseUrl = (): string => process.env['DATABASE_URL'] ?? FALLBACK_DATABASE_URL;

/** `<base>_tpl` — rebuilt from the migrations on every run, then cloned per worker. */
export const templateDatabaseName = (baseName: string): string => `${baseName}_tpl`;

/** Worker count: TEST_WORKERS wins; else the machine's parallelism, capped so 8 pools × 10
 *  postgres.js connections stay well under Postgres' default max_connections (100). */
export const workerCount = (): number => {
  const fromEnv = Number(process.env['TEST_WORKERS']);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return Math.max(1, Math.min(os.availableParallelism(), 8));
};

/** `<base>_w<i>` — the i-th worker's private copy of the template. */
export const workerDatabaseName = (baseName: string, worker: number): string =>
  `${baseName}_w${worker}`;

export const workerDatabaseUrl = (base: string, worker: number): string => {
  const url = new URL(base);
  const baseName = url.pathname.replace(/^\//, '');
  url.pathname = `/${workerDatabaseName(baseName, worker)}`;
  return url.toString();
};

/** Same server, the maintenance DB — CREATE DATABASE cannot run while connected to the template. */
export const maintenanceUrl = (base: string): string => {
  const url = new URL(base);
  url.pathname = '/postgres';
  return url.toString();
};
