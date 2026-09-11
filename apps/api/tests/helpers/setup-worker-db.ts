// setupFiles entry — runs in EVERY worker before the test file (and therefore before src/env.ts,
// whose zod parse of process.env happens at import). Points this worker at its own database.
import { workerDatabaseUrl } from './parallel-db.js';

const poolId = Number(process.env['VITEST_POOL_ID'] ?? '1');
const base = process.env['DATABASE_URL'];
if (!base)
  throw new Error('DATABASE_URL must be set (vitest.config.ts env) before the worker setup');
if (!/_w\d+$/.test(new URL(base).pathname)) {
  process.env['DATABASE_URL'] = workerDatabaseUrl(
    base,
    Number.isInteger(poolId) && poolId > 0 ? poolId : 1,
  );
}
