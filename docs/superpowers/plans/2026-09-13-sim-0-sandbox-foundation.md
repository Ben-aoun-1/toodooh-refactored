# SIM-0 Sandbox Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin Simulateur its foundation: throwaway sandbox databases per simulation, a registry, a context-routed `db` handle so the real engines run unchanged inside a sandbox, admin endpoints, and a minimal page.

**Architecture:** A `simulations` table in the MAIN database tracks each sandbox (a separate Postgres database on the same server, created and migrated in the background). `apps/api/src/db/client.ts` exports `db` as a Proxy that resolves, per async context (AsyncLocalStorage), to the active sandbox handle or falls back to main. Routes under `/api/admin/simulations/:id/*` enter the context in a last-position preHandler. Everything else in the api never sees a context.

**Tech Stack:** Fastify 5, drizzle-orm 0.45 + postgres.js 3.4, zod 4, vitest 4 (real Postgres, one database per worker), React 18 + React Query 5 + Tailwind, vitest 3 (node env) on the web.

**Spec:** `docs/superpowers/specs/2026-09-13-sim-0-sandbox-foundation-design.md`

**Spec amendment (recorded here, applied to the spec in Task 1):** the `sql` export of `db/client.ts` is used ONLY by `server.ts` to `end()` the main pool at shutdown; every raw statement in the codebase goes through drizzle's `sql` tag on `db.execute(...)`, which the routed `db` already covers. So only `db` is proxied; `sql` stays the plain main client. Sandbox-side raw SQL in this slice uses `db.execute(sql\`…\`)`.

## Global Constraints

- Node **20.20.2** for every git / pnpm / tsx command: prefix `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$HOME/.local/bin:$PATH"` inline on each Bash call (shell state does not persist).
- TypeScript strict; **no `any`, no `@ts-ignore`, no `@ts-expect-error`**. `unknown` + a type guard is the only escape.
- **No `console.*`** outside `**/scripts/**` and tests; pino via `app.log` / `request.log` / `logger`.
- Gates, per commit, exact commands: `pnpm --filter @toodooh/api typecheck` (must be **0** `error TS`), `pnpm --filter @toodooh/web typecheck` (baseline **14**, same error set as main), `pnpm lint` (**0** errors), `pnpm test` (all green). Never gate the api with bare `tsc --noEmit`.
- Never run two full api suites at once (shared Postgres server). Local api tests need the docker Postgres from `infra/docker-compose.yml` up (`infra-postgres-1`) and `DATABASE_URL=postgresql://test:test@localhost:5432/test_db` (the vitest default).
- Migration number for this slice: **0071**. Hand-written SQL + a `_journal.json` entry (the 0066–0070 style; no snapshot).
- Commits: Conventional Commits, one logical change each, trailer lines exactly:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018qwYRvbwWcQmym7X57DAbJ
  ```
  Commit with `NODE_OPTIONS=--max-old-space-size=4096` (lint-staged OOM precedent). Commits stay LOCAL; push only when the operator says so.
- French user-facing copy on the web; error codes on the api are UPPER_SNAKE like the neighbours (`SIMULATOR_DISABLED`, `SIMULATOR_FULL`, `SIMULATION_NOT_READY`, `SIMULATION_BUSY`, `NOT_FOUND`, `INVALID_INPUT`).
- Branch: `feat/sim-0-sandbox-foundation` (already holds the spec commit 65824ae).

---

## File map

**api — create**
- `apps/api/drizzle/0071_simulations.sql` — the registry table + enum.
- `apps/api/src/db/migrate-runner.ts` — `applyMigrations(databaseUrl)`; the ONE migrator call (script + sandbox provisioning share it).
- `apps/api/src/simulator/context.ts` — AsyncLocalStorage store, `runInSandbox`, `enterSandbox`, `currentSandbox`.
- `apps/api/src/simulator/pools.ts` — per-simulation pool cache (`sandboxHandleFor`, `evictSandbox`, `evictIdleSandboxes`, `closeAllSandboxes`).
- `apps/api/src/simulator/naming.ts` — pure: `mainDatabaseName(url)`, `sandboxDatabaseName(main)`, `sandboxUrl(mainUrl, dbName)`, `maintenanceUrl(mainUrl)`, `quoteIdent`.
- `apps/api/src/simulator/provisioning.ts` — `createSandboxDatabase`, `dropSandboxDatabase`, `listSandboxDatabases`, `provisionSimulation` (the background task), `sweepOrphans`.
- `apps/api/src/middleware/require-simulator.ts` — `requireSimulator(enabled)` factory → 503.
- `apps/api/src/routes/admin-simulations.ts` — the five endpoints + `enterSimulation` preHandler.
- `apps/api/tests/simulations-naming.test.ts`, `simulations-isolation.test.ts`, `simulations-lifecycle.test.ts`, `simulations-guards.test.ts`, `simulations-sweep.test.ts`.

**api — modify**
- `apps/api/src/db/schema.ts` — `simulationStatus` enum + `simulations` table (append at the end).
- `apps/api/drizzle/meta/_journal.json` — entry idx 71.
- `apps/api/src/db/client.ts` — `mainDb` + routed `db` proxy.
- `apps/api/src/env.ts` — `SIMULATOR_ENABLED`, `SIMULATOR_MAX_SANDBOXES`.
- `apps/api/scripts/migrate.ts` — call `applyMigrations`.
- `apps/api/src/routes/index.ts` — register `adminSimulationsRoutes`.
- `apps/api/src/server.ts` — boot log line, orphan sweep, idle-eviction timer, close pools on shutdown.

**web — create**
- `apps/web/src/features/admin/services/admin-simulator.service.ts` (+ `.test.ts`).
- `apps/web/src/features/admin/hooks/useAdminSimulator.ts`.
- `apps/web/src/features/admin/pages/SimulatorPage.tsx` (shell, < 150 lines).
- `apps/web/src/features/admin/components/simulator/SimulationList.tsx`, `CreateSimulationForm.tsx`, `SimulationDetail.tsx`, `SimulationStatusBadge.tsx`.

**web — modify**
- `apps/web/src/features/admin/hooks/queryKeys.ts` — simulator keys.
- `apps/web/src/App.tsx` — lazy `SimulatorPage` + `/admin-simulator` route.
- `apps/web/src/features/admin/components/AdminLayout.tsx` — « Simulateur » entry.

---

### Task 1: Registry schema + migration 0071 + env vars

**Files:**
- Modify: `apps/api/src/db/schema.ts` (append after `NewSupportMessage`, line ~2120)
- Create: `apps/api/drizzle/0071_simulations.sql`
- Modify: `apps/api/drizzle/meta/_journal.json`
- Modify: `apps/api/src/env.ts`
- Modify: `docs/superpowers/specs/2026-09-13-sim-0-sandbox-foundation-design.md` (§6 amendment)

**Interfaces:**
- Produces: `simulations` table + `Simulation`/`NewSimulation` types; `simulationStatus` enum values `'creating' | 'ready' | 'failed' | 'deleting'`; `env.SIMULATOR_ENABLED: boolean`; `env.SIMULATOR_MAX_SANDBOXES: number`.

- [ ] **Step 1: Append the schema**

At the end of `apps/api/src/db/schema.ts`:

```ts
// ── simulations (SIM-0, 2026-09-13) ─────────────────────────────────────────
// The admin « Simulateur » registry: one row per SANDBOX DATABASE on the same server, cloned
// from the migrations, on which the real engines run unchanged (db/client.ts routes `db` per
// async context). Lives in MAIN — a sandbox never knows it is one. `db_name` is derived
// (`<main>_sim_<8 hex>`), never user-supplied; `virtual_now` is the simulation clock (SIM-2
// advances it; SIM-0 only stores it).
export const simulationStatus = pgEnum('simulation_status', [
  'creating',
  'ready',
  'failed',
  'deleting',
]);

export const simulations = pgTable(
  'simulations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    dbName: text('db_name').notNull().unique(),
    status: simulationStatus('status').notNull().default('creating'),
    virtualNow: timestamp('virtual_now', { withTimezone: true }).notNull(),
    error: text('error'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('simulations_status_idx').on(table.status)],
);

export type Simulation = typeof simulations.$inferSelect;
export type NewSimulation = typeof simulations.$inferInsert;
```

- [ ] **Step 2: Write the migration**

`apps/api/drizzle/0071_simulations.sql`:

```sql
-- SIM-0 (2026-09-13). The admin « Simulateur » registry: one row per sandbox DATABASE on the
-- same Postgres server (created + migrated by the api in the background, dropped on delete).
-- Lives in MAIN only; the sandboxes carry this table too (same migrations) but never a row.
CREATE TYPE "simulation_status" AS ENUM ('creating', 'ready', 'failed', 'deleting');
--> statement-breakpoint
CREATE TABLE "simulations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "db_name" text NOT NULL,
  "status" "simulation_status" DEFAULT 'creating' NOT NULL,
  "virtual_now" timestamp with time zone NOT NULL,
  "error" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "simulations_db_name_unique" UNIQUE("db_name")
);
--> statement-breakpoint
CREATE INDEX "simulations_status_idx" ON "simulations" ("status");
```

- [ ] **Step 3: Journal entry**

In `apps/api/drizzle/meta/_journal.json`, after the `0070_support_messages` entry add (keep the JSON valid — a comma after the previous object):

```json
    {
      "idx": 71,
      "version": "7",
      "when": 1789300000000,
      "tag": "0071_simulations",
      "breakpoints": true
    }
```

- [ ] **Step 4: Env vars**

In `apps/api/src/env.ts`, after `ANTHROPIC_API_KEY`:

```ts
  // SIM-0 — the admin « Simulateur ». OPTIONAL by design (the WEDOOH_* posture: eager parse must
  // never fail-fast an entrypoint). Off → every /api/admin/simulations/* answers 503
  // SIMULATOR_DISABLED and the boot orphan sweep does not run. MAX bounds the number of sandbox
  // DATABASES on the server (each holds a small pool; see simulator/pools.ts).
  SIMULATOR_ENABLED: z.stringbool().default(false),
  SIMULATOR_MAX_SANDBOXES: z.coerce.number().int().min(1).max(20).default(5),
```

- [ ] **Step 5: Spec amendment**

In the spec §6 replace the two-line code block and its sentence about `sql` so it reads: only `db` is routed; `sql` stays the main client (its sole consumer is `server.ts`'s `sql.end()`); raw sandbox statements go through `db.execute(sql\`…\`)`. Also in §9 test 2 replace « a raw `` sql`…` `` inside the context hits the sandbox » with « a `db.execute(sql\`select count(*) …\`)` inside the context hits the sandbox ».

- [ ] **Step 6: Apply the migration to the dev DB and typecheck**

Run (from `apps/api`, with the Node 20 PATH prefix and the `.env` present):
```bash
pnpm migrate
pnpm --filter @toodooh/api typecheck
```
Expected: `migrations applied`; typecheck prints no `error TS`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle/0071_simulations.sql apps/api/drizzle/meta/_journal.json apps/api/src/env.ts docs/superpowers/specs/2026-09-13-sim-0-sandbox-foundation-design.md
git commit -m "feat(api): SIM-0 — simulations registry (migration 0071) + SIMULATOR_* env"
```
(with the two trailer lines.)

---

### Task 2: Naming helpers (pure) + migrate-runner

**Files:**
- Create: `apps/api/src/simulator/naming.ts`
- Create: `apps/api/src/db/migrate-runner.ts`
- Modify: `apps/api/scripts/migrate.ts`
- Test: `apps/api/tests/simulations-naming.test.ts`

**Interfaces:**
- Produces:
  - `mainDatabaseName(databaseUrl: string): string`
  - `sandboxDatabaseName(mainName: string, random?: () => string): string` → `${main}_sim_${8 hex}`
  - `sandboxPrefix(mainName: string): string` → `${main}_sim_`
  - `sandboxUrl(mainUrl: string, dbName: string): string`
  - `maintenanceUrl(mainUrl: string): string` (pathname `/postgres`)
  - `quoteIdent(name: string): string`
  - `applyMigrations(databaseUrl: string): Promise<void>` (max 1 connection, ends it).

- [ ] **Step 1: Failing test**

`apps/api/tests/simulations-naming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  mainDatabaseName,
  maintenanceUrl,
  quoteIdent,
  sandboxDatabaseName,
  sandboxPrefix,
  sandboxUrl,
} from '../src/simulator/naming.js';

const MAIN = 'postgresql://toodooh:pw@db:5432/toodooh_prod';

describe('simulator naming', () => {
  it('reads the main database name from the url', () => {
    expect(mainDatabaseName(MAIN)).toBe('toodooh_prod');
  });

  it('derives a sandbox name under the main prefix with 8 hex chars', () => {
    const name = sandboxDatabaseName('toodooh_prod', () => 'abcdef01');
    expect(name).toBe('toodooh_prod_sim_abcdef01');
    expect(sandboxDatabaseName('toodooh_prod')).toMatch(/^toodooh_prod_sim_[0-9a-f]{8}$/);
    expect(sandboxPrefix('toodooh_prod')).toBe('toodooh_prod_sim_');
  });

  it('rewrites only the pathname for sandbox and maintenance urls', () => {
    expect(sandboxUrl(MAIN, 'toodooh_prod_sim_abcdef01')).toBe(
      'postgresql://toodooh:pw@db:5432/toodooh_prod_sim_abcdef01',
    );
    expect(maintenanceUrl(MAIN)).toBe('postgresql://toodooh:pw@db:5432/postgres');
  });

  it('quotes identifiers safely', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @toodooh/api exec vitest run tests/simulations-naming.test.ts
```
Expected: FAIL — cannot find module `../src/simulator/naming.js`.

- [ ] **Step 3: Implement**

`apps/api/src/simulator/naming.ts`:

```ts
import { randomBytes } from 'node:crypto';

// SIM-0 — pure naming for sandbox databases. A sandbox is `<main>_sim_<8 hex>` on the SAME
// server as the main database, so `\l` shows ownership at a glance and the boot sweep can
// recognise orphans by prefix. Never user-supplied.

export const mainDatabaseName = (databaseUrl: string): string =>
  new URL(databaseUrl).pathname.replace(/^\//, '');

export const sandboxPrefix = (mainName: string): string => `${mainName}_sim_`;

export const sandboxDatabaseName = (
  mainName: string,
  random: () => string = () => randomBytes(4).toString('hex'),
): string => `${sandboxPrefix(mainName)}${random()}`;

const withPathname = (url: string, pathname: string): string => {
  const u = new URL(url);
  u.pathname = pathname;
  return u.toString();
};

export const sandboxUrl = (mainUrl: string, dbName: string): string =>
  withPathname(mainUrl, `/${dbName}`);

/** Same server, the maintenance DB — CREATE/DROP DATABASE cannot target the connected one. */
export const maintenanceUrl = (mainUrl: string): string => withPathname(mainUrl, '/postgres');

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
```

`apps/api/src/db/migrate-runner.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// The ONE migrator call. scripts/migrate.ts (container start) and the simulator's sandbox
// provisioning both apply the same folder the same way. The folder resolves relative to this
// file (src/db → ../../drizzle; dist/db → ../../drizzle — the image copies both `dist` and
// `drizzle` under /app), so it does not depend on the process cwd.
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

export const applyMigrations = async (databaseUrl: string): Promise<void> => {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
};
```

`apps/api/scripts/migrate.ts` becomes:

```ts
import { applyMigrations } from '../src/db/migrate-runner.js';
import { env } from '../src/env.js';

const run = async (): Promise<void> => {
  await applyMigrations(env.DATABASE_URL);
  console.info('migrations applied');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migration failed', err);
    process.exit(1);
  });
```

- [ ] **Step 4: Run tests + the real migrate script**

```bash
pnpm --filter @toodooh/api exec vitest run tests/simulations-naming.test.ts
pnpm --filter @toodooh/api migrate
```
Expected: 4 passing; `migrations applied` (no-op, already at 0071).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/simulator/naming.ts apps/api/src/db/migrate-runner.ts apps/api/scripts/migrate.ts apps/api/tests/simulations-naming.test.ts
git commit -m "feat(api): SIM-0 — sandbox naming helpers + shared migrate-runner"
```

---

### Task 3: Context store + routed `db` proxy + pool cache

**Files:**
- Create: `apps/api/src/simulator/context.ts`
- Create: `apps/api/src/simulator/pools.ts`
- Modify: `apps/api/src/db/client.ts`
- Test: `apps/api/tests/simulations-isolation.test.ts`

**Interfaces:**
- Produces:
  - `interface SandboxStore { simulationId: string; db: DrizzleDb }`
  - `runInSandbox<T>(store: SandboxStore, fn: () => Promise<T>): Promise<T>`
  - `enterSandbox(store: SandboxStore): void`
  - `currentSandbox(): SandboxStore | undefined`
  - `sandboxHandleFor(simulationId: string, dbName: string): SandboxStore` (cached)
  - `evictSandbox(simulationId: string): Promise<void>`
  - `evictIdleSandboxes(now?: number): Promise<number>`
  - `closeAllSandboxes(): Promise<void>`
  - `mainDb: DrizzleDb` (exported from `db/client.ts` for the two places that must bypass routing).
- Consumes: `sandboxUrl` from Task 2.

- [ ] **Step 1: Failing test**

`apps/api/tests/simulations-isolation.test.ts`. It creates a real sandbox database by hand (Task 4 adds the provisioning module; this test must not depend on it), so it uses the naming helpers + `applyMigrations` directly.

```ts
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, mainDb } from '../src/db/client.js';
import { applyMigrations } from '../src/db/migrate-runner.js';
import { screenhosts } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { currentSandbox, runInSandbox } from '../src/simulator/context.js';
import {
  mainDatabaseName,
  maintenanceUrl,
  quoteIdent,
  sandboxDatabaseName,
  sandboxUrl,
} from '../src/simulator/naming.js';
import { closeAllSandboxes, sandboxHandleFor } from '../src/simulator/pools.js';

const SIM_ID = '00000000-0000-4000-8000-000000000001';
const dbName = sandboxDatabaseName(mainDatabaseName(env.DATABASE_URL));

const countHosts = async (): Promise<number> => {
  const rows = await db.select({ id: screenhosts.id }).from(screenhosts);
  return rows.length;
};

describe('routed db handle (SIM-0)', () => {
  beforeAll(async () => {
    const admin = postgres(maintenanceUrl(env.DATABASE_URL), { max: 1 });
    try {
      await admin.unsafe(`CREATE DATABASE ${quoteIdent(dbName)}`);
    } finally {
      await admin.end();
    }
    await applyMigrations(sandboxUrl(env.DATABASE_URL, dbName));
    await mainDb.delete(screenhosts);
  });

  afterAll(async () => {
    await closeAllSandboxes();
    const admin = postgres(maintenanceUrl(env.DATABASE_URL), { max: 1 });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it('resolves to main outside any context', async () => {
    expect(currentSandbox()).toBeUndefined();
    const [row] = await db.execute(sql`select current_database() as name`);
    expect(row?.['name']).toBe(mainDatabaseName(env.DATABASE_URL));
  });

  it('routes selects, inserts, transactions and execute to the sandbox inside a context', async () => {
    const store = sandboxHandleFor(SIM_ID, dbName);
    await runInSandbox(store, async () => {
      expect(currentSandbox()?.simulationId).toBe(SIM_ID);
      const [row] = await db.execute(sql`select current_database() as name`);
      expect(row?.['name']).toBe(dbName);
      await db.transaction(async (tx) => {
        await tx.insert(screenhosts).values({ name: 'Sandbox venue' });
      });
      expect(await countHosts()).toBe(1);
    });
    expect(await countHosts()).toBe(0); // main untouched
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
```

Note: `screenhosts.name` is the only NOT NULL column without a default that the insert needs — verify with `grep -n "export const screenhosts = pgTable" -A 40 apps/api/src/db/schema.ts` and add any other required columns the test insert needs (owner_id is nullable; check before running). If the insert needs an owner, seed a user via `db.insert(users).values({ email, contactName, status: 'approved' })` inside the same context first.

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @toodooh/api exec vitest run tests/simulations-isolation.test.ts
```
Expected: FAIL — cannot find `../src/simulator/context.js`.

- [ ] **Step 3: Implement the context**

`apps/api/src/simulator/context.ts`:

```ts
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
```

`apps/api/src/db/client.ts`:

```ts
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
  get(_target, prop, _receiver) {
    const target = resolve();
    const value: unknown = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
```

Circular import note: `simulator/context.ts` imports only the TYPE `DrizzleDb` from `db/client.ts` (`import type`), so there is no runtime cycle.

`apps/api/src/simulator/pools.ts`:

```ts
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
```

- [ ] **Step 4: Run the isolation test AND the whole api suite**

```bash
pnpm --filter @toodooh/api exec vitest run tests/simulations-isolation.test.ts
pnpm --filter @toodooh/api test
pnpm --filter @toodooh/api typecheck
```
Expected: isolation 4 passing; the FULL suite green (this is the « proxy outside any context behaves as before » proof — every existing test now runs through the proxy); typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/simulator/context.ts apps/api/src/simulator/pools.ts apps/api/src/db/client.ts apps/api/tests/simulations-isolation.test.ts
git commit -m "feat(api): SIM-0 — context-routed db handle + per-simulation pool cache"
```

---

### Task 4: Provisioning (create / drop / list / sweep)

**Files:**
- Create: `apps/api/src/simulator/provisioning.ts`
- Test: `apps/api/tests/simulations-sweep.test.ts`

**Interfaces:**
- Produces:
  - `createSandboxDatabase(dbName: string): Promise<void>`
  - `dropSandboxDatabase(dbName: string): Promise<void>` (IF EXISTS, WITH (FORCE))
  - `listSandboxDatabases(): Promise<string[]>` (names under the main prefix)
  - `provisionSimulation(simulationId: string, log: Logger): Promise<void>` — the background task; NEVER throws.
  - `sweepOrphans(log: Logger): Promise<{ dropped: number; markedFailed: number }>`
- Consumes: naming (Task 2), `applyMigrations` (Task 2), `mainDb` + `simulations` (Tasks 1, 3).
- `Logger` = `import type { FastifyBaseLogger } from 'fastify'`.

- [ ] **Step 1: Failing test**

`apps/api/tests/simulations-sweep.test.ts`:

```ts
import { eq } from 'drizzle-orm';
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

const silent = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => silent,
  level: 'silent',
  silent: () => undefined,
} as const;
// FastifyBaseLogger is structurally satisfied by the object above for the methods we call.
const log = silent as unknown as import('fastify').FastifyBaseLogger;

const main = mainDatabaseName(env.DATABASE_URL);
let adminId = '';
const created: string[] = [];

const seedAdmin = async (): Promise<string> => {
  const values: Partial<NewUser> = {
    email: `sim-admin-${Date.now()}@example.com`,
    contactName: 'Sim Admin',
    role: 'admin',
    status: 'approved',
  };
  const [u] = await mainDb.insert(users).values(values as NewUser).returning();
  return u?.id ?? '';
};

describe('sandbox provisioning + orphan sweep (SIM-0)', () => {
  beforeAll(async () => {
    adminId = await seedAdmin();
  });
  afterAll(async () => {
    for (const name of created) await dropSandboxDatabase(name);
    await mainDb.delete(simulations);
  });

  it('provisionSimulation creates + migrates the database and flips the row to ready', async () => {
    const dbName = sandboxDatabaseName(main);
    created.push(dbName);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'p1', dbName, virtualNow: new Date(), createdBy: adminId })
      .returning();
    await provisionSimulation(row?.id ?? '', log);
    const [after] = await mainDb.select().from(simulations).where(eq(simulations.id, row?.id ?? ''));
    expect(after?.status).toBe('ready');
    expect(await listSandboxDatabases()).toContain(dbName);
  });

  it('provisionSimulation marks failed (and leaves no database) when creation fails', async () => {
    const dbName = 'not a valid name because of spaces; -- and length ' + 'x'.repeat(80);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'p2', dbName, virtualNow: new Date(), createdBy: adminId })
      .returning();
    await provisionSimulation(row?.id ?? '', log);
    const [after] = await mainDb.select().from(simulations).where(eq(simulations.id, row?.id ?? ''));
    expect(after?.status).toBe('failed');
    expect(after?.error).toBeTruthy();
  });

  it('sweepOrphans drops a prefixed database with no row and fails a row with no database', async () => {
    const orphan = sandboxDatabaseName(main);
    await createSandboxDatabase(orphan);
    const ghost = sandboxDatabaseName(main);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'ghost', dbName: ghost, virtualNow: new Date(), createdBy: adminId, status: 'ready' })
      .returning();

    const result = await sweepOrphans(log);

    expect(result.dropped).toBeGreaterThanOrEqual(1);
    expect(await listSandboxDatabases()).not.toContain(orphan);
    const [after] = await mainDb.select().from(simulations).where(eq(simulations.id, row?.id ?? ''));
    expect(after?.status).toBe('failed');
    expect(after?.error).toBe('database missing');
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @toodooh/api exec vitest run tests/simulations-sweep.test.ts
```
Expected: FAIL — cannot find `../src/simulator/provisioning.js`.

- [ ] **Step 3: Implement**

`apps/api/src/simulator/provisioning.ts`:

```ts
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

const withMaintenance = async <T>(fn: (admin: postgres.Sql) => Promise<T>): Promise<T> => {
  const admin = postgres(maintenanceUrl(env.DATABASE_URL), { max: 1 });
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
};

export const createSandboxDatabase = (dbName: string): Promise<void> =>
  withMaintenance(async (admin) => {
    await admin.unsafe(`CREATE DATABASE ${quoteIdent(dbName)}`);
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

export const deleteSimulation = async (
  simulationId: string,
  dbName: string,
): Promise<void> => {
  await mainDb
    .update(simulations)
    .set({ status: 'deleting' })
    .where(eq(simulations.id, simulationId));
  await evictSandbox(simulationId);
  await dropSandboxDatabase(dbName);
  await mainDb.delete(simulations).where(eq(simulations.id, simulationId));
};

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
```

Rows still in `creating` are skipped by the sweep on purpose: the background task may be between CREATE DATABASE and the status flip.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @toodooh/api exec vitest run tests/simulations-sweep.test.ts tests/simulations-isolation.test.ts
pnpm --filter @toodooh/api typecheck
```
Expected: all passing; typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/simulator/provisioning.ts apps/api/tests/simulations-sweep.test.ts
git commit -m "feat(api): SIM-0 — sandbox provisioning, deletion and the orphan sweep"
```

---

### Task 5: `requireSimulator` guard + admin endpoints + `enterSimulation`

**Files:**
- Create: `apps/api/src/middleware/require-simulator.ts`
- Create: `apps/api/src/routes/admin-simulations.ts`
- Modify: `apps/api/src/routes/index.ts` (register after `adminTestingRoutes`)
- Test: `apps/api/tests/simulations-guards.test.ts`, `apps/api/tests/simulations-lifecycle.test.ts`

**Interfaces:**
- Produces:
  - `requireSimulator(enabled: boolean): preHandlerHookHandler` → 503 `SIMULATOR_DISABLED`.
  - `adminSimulationsRoutes: FastifyPluginAsync<{ enabled: boolean; maxSandboxes: number }>`.
  - Wire shape `SimulationView = { id, name, status, virtual_now, error, created_at, last_used_at }` (ISO strings).
  - Endpoints per spec §7.
- Consumes: everything above.

- [ ] **Step 1: Failing tests**

`apps/api/tests/simulations-guards.test.ts`:

```ts
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { mainDb } from '../src/db/client.js';
import { type NewUser, simulations, users } from '../src/db/schema.js';
import { adminSimulationsRoutes } from '../src/routes/admin-simulations.js';
import { closeAllSandboxes } from '../src/simulator/pools.js';
import { dropSandboxDatabase } from '../src/simulator/provisioning.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let adminId = '';
let advertiserId = '';
const seedUser = async (role: string): Promise<string> => {
  const values: Partial<NewUser> = {
    email: `guards-${role}-${Date.now()}-${Math.random()}@example.com`,
    contactName: `U ${role}`,
    status: 'approved',
    role,
  } as Partial<NewUser>;
  const [u] = await mainDb.insert(users).values(values as NewUser).returning();
  return u?.id ?? '';
};

const build = async (opts: { enabled: boolean; maxSandboxes: number }) => {
  const app = Fastify({ logger: false });
  await app.register(adminSimulationsRoutes, opts);
  await app.ready();
  return app;
};

describe('admin simulations guards (SIM-0)', () => {
  beforeAll(async () => {
    adminId = await seedUser('admin');
    advertiserId = await seedUser('advertiser');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    const rows = await mainDb.select({ dbName: simulations.dbName }).from(simulations);
    for (const r of rows) await dropSandboxDatabase(r.dbName);
    await mainDb.delete(simulations);
    await closeAllSandboxes();
  });

  it('answers 503 SIMULATOR_DISABLED on every route when disabled', async () => {
    const app = await build({ enabled: false, maxSandboxes: 5 });
    mockSession(adminId);
    const res = await app.inject({ method: 'GET', url: '/api/admin/simulations' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'SIMULATOR_DISABLED' });
    const post = await app.inject({ method: 'POST', url: '/api/admin/simulations', payload: { name: 'x' } });
    expect(post.statusCode).toBe(503);
    await app.close();
  });

  it('403s a non-admin, 401s no session', async () => {
    const app = await build({ enabled: true, maxSandboxes: 5 });
    mockSession(advertiserId, 'advertiser');
    expect((await app.inject({ method: 'GET', url: '/api/admin/simulations' })).statusCode).toBe(403);
    vi.restoreAllMocks();
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
    expect((await app.inject({ method: 'GET', url: '/api/admin/simulations' })).statusCode).toBe(401);
    await app.close();
  });

  it('409 SIMULATOR_FULL at the cap (failed rows do not count)', async () => {
    const app = await build({ enabled: true, maxSandboxes: 1 });
    mockSession(adminId);
    await mainDb.insert(simulations).values([
      { name: 'a', dbName: 'cap_a', virtualNow: new Date(), createdBy: adminId, status: 'failed' },
      { name: 'b', dbName: 'cap_b', virtualNow: new Date(), createdBy: adminId, status: 'ready' },
    ]);
    const res = await app.inject({ method: 'POST', url: '/api/admin/simulations', payload: { name: 'c' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SIMULATOR_FULL' });
    await mainDb.delete(simulations);
    await app.close();
  });

  it('409 SIMULATION_NOT_READY on a routed route while creating; 404 unknown id', async () => {
    const app = await build({ enabled: true, maxSandboxes: 5 });
    mockSession(adminId);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'nr', dbName: 'nr_db', virtualNow: new Date(), createdBy: adminId })
      .returning();
    const res = await app.inject({ method: 'GET', url: `/api/admin/simulations/${row?.id}/probe` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SIMULATION_NOT_READY' });
    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/simulations/00000000-0000-4000-8000-0000000000ff/probe',
    });
    expect(missing.statusCode).toBe(404);
    await mainDb.delete(simulations);
    await app.close();
  });

  it('400 on a bad name', async () => {
    const app = await build({ enabled: true, maxSandboxes: 5 });
    mockSession(adminId);
    const res = await app.inject({ method: 'POST', url: '/api/admin/simulations', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

`apps/api/tests/simulations-lifecycle.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { mainDb } from '../src/db/client.js';
import { type NewUser, screenhosts, simulations, users } from '../src/db/schema.js';
import { adminSimulationsRoutes } from '../src/routes/admin-simulations.js';
import { closeAllSandboxes } from '../src/simulator/pools.js';
import { dropSandboxDatabase, listSandboxDatabases } from '../src/simulator/provisioning.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'admin', status: 'approved' },
  } as unknown as GetSessionResult);
};

interface SimulationView {
  id: string;
  name: string;
  status: 'creating' | 'ready' | 'failed' | 'deleting';
  virtual_now: string;
  error: string | null;
  created_at: string;
  last_used_at: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let adminId = '';
let app: Awaited<ReturnType<typeof Fastify>>;

describe('admin simulations lifecycle (SIM-0)', () => {
  beforeAll(async () => {
    const values: Partial<NewUser> = {
      email: `lifecycle-${Date.now()}@example.com`,
      contactName: 'Life',
      role: 'admin',
      status: 'approved',
    } as Partial<NewUser>;
    const [u] = await mainDb.insert(users).values(values as NewUser).returning();
    adminId = u?.id ?? '';
    app = Fastify({ logger: false });
    await app.register(adminSimulationsRoutes, { enabled: true, maxSandboxes: 5 });
    await app.ready();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    const rows = await mainDb.select({ dbName: simulations.dbName }).from(simulations);
    for (const r of rows) await dropSandboxDatabase(r.dbName);
    await mainDb.delete(simulations);
    await closeAllSandboxes();
    await app.close();
  });

  const waitReady = async (id: string): Promise<SimulationView> => {
    for (let i = 0; i < 100; i += 1) {
      const res = await app.inject({ method: 'GET', url: `/api/admin/simulations/${id}` });
      const body = res.json<SimulationView>();
      if (body.status === 'ready' || body.status === 'failed') return body;
      await sleep(200);
    }
    throw new Error('sandbox never became ready');
  };

  it('creates (202) → ready; probe counts THROUGH the sandbox; delete drops the database', async () => {
    mockSession(adminId);
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/simulations',
      payload: { name: 'Monde 1', virtual_start: '2026-03-01T08:00:00Z' },
    });
    expect(create.statusCode).toBe(202);
    const created = create.json<SimulationView>();
    expect(created.status).toBe('creating');
    expect(created.virtual_now).toBe('2026-03-01T08:00:00.000Z');
    expect(Object.keys(created)).not.toContain('db_name');

    const ready = await waitReady(created.id);
    expect(ready.status).toBe('ready');
    expect(ready.error).toBeNull();

    // main gets one extra venue; the probe must NOT see it
    await mainDb.insert(screenhosts).values({ name: 'Main-only venue' });
    const probe = await app.inject({ method: 'GET', url: `/api/admin/simulations/${created.id}/probe` });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toEqual({
      screenhosts: 0,
      campaigns: 0,
      users: 0,
      dispatch_config_present: true,
    });
    await mainDb.delete(screenhosts);

    const list = await app.inject({ method: 'GET', url: '/api/admin/simulations' });
    expect(list.json<{ simulations: SimulationView[]; max: number }>().max).toBe(5);
    expect(list.json<{ simulations: SimulationView[] }>().simulations.map((s) => s.id)).toContain(created.id);

    const [row] = await mainDb.select().from(simulations).where(eq(simulations.id, created.id));
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/simulations/${created.id}` });
    expect(del.statusCode).toBe(204);
    expect(await listSandboxDatabases()).not.toContain(row?.dbName);
    const again = await app.inject({ method: 'DELETE', url: `/api/admin/simulations/${created.id}` });
    expect(again.statusCode).toBe(404);
  }, 60_000);

  it('refuses to delete a simulation still creating (409 SIMULATION_BUSY)', async () => {
    mockSession(adminId);
    const [row] = await mainDb
      .insert(simulations)
      .values({ name: 'busy', dbName: 'busy_db', virtualNow: new Date(), createdBy: adminId })
      .returning();
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/simulations/${row?.id}` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SIMULATION_BUSY' });
    await mainDb.delete(simulations).where(eq(simulations.id, row?.id ?? ''));
  });
});
```

Same note as Task 3 about `screenhosts` NOT NULL columns: adapt the main-only insert if `name` alone is not enough.

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @toodooh/api exec vitest run tests/simulations-guards.test.ts tests/simulations-lifecycle.test.ts
```
Expected: FAIL — cannot find `../src/routes/admin-simulations.js`.

- [ ] **Step 3: Implement the guard**

`apps/api/src/middleware/require-simulator.ts`:

```ts
import type { preHandlerHookHandler } from 'fastify';

// SIM-0 — the simulator is OFF unless SIMULATOR_ENABLED=true (the require-sync-key posture:
// factory form, the flag passed explicitly so tests need no env mutation; never silently open).
export const requireSimulator =
  (enabled: boolean): preHandlerHookHandler =>
  async (request, reply) => {
    if (!enabled) {
      return reply.status(503).send({
        error: 'SIMULATOR_DISABLED',
        message: 'Le simulateur est désactivé sur ce serveur.',
        statusCode: 503,
        requestId: request.id,
      });
    }
  };
```

- [ ] **Step 4: Implement the routes**

`apps/api/src/routes/admin-simulations.ts`:

```ts
import { desc, eq, ne } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db, mainDb } from '../db/client.js';
import { type Simulation, campaigns, dispatchConfig, screenhosts, simulations, users } from '../db/schema.js';
import { env } from '../env.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { requireSimulator } from '../middleware/require-simulator.js';
import { enterSandbox } from '../simulator/context.js';
import { mainDatabaseName, sandboxDatabaseName } from '../simulator/naming.js';
import { sandboxHandleFor } from '../simulator/pools.js';
import { deleteSimulation, provisionSimulation } from '../simulator/provisioning.js';

// SIM-0 — the admin « Simulateur » registry endpoints. A simulation is a sandbox DATABASE on the
// same server; the routes under /:id/* enter its async context in the LAST preHandler (after the
// auth guards, so an unauthenticated request never resolves a pool), and from there every engine
// import of `db` hits the sandbox (db/client.ts). The registry itself lives in MAIN, so this file
// reads/writes it through `mainDb` on purpose — the one place routing is bypassed.

export interface AdminSimulationsOptions {
  enabled: boolean;
  maxSandboxes: number;
}

const idParamSchema = z.object({ id: z.uuid() });
const createBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  virtual_start: z.iso.datetime({ offset: true }).optional(),
});

const view = (s: Simulation) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  virtual_now: s.virtualNow.toISOString(),
  error: s.error,
  created_at: s.createdAt.toISOString(),
  last_used_at: s.lastUsedAt.toISOString(),
});

const invalid = (reply: FastifyReply, field: string, reason: string) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    fields: [{ field, reason }],
  });

export const adminSimulationsRoutes: FastifyPluginAsync<AdminSimulationsOptions> = async (
  app,
  opts,
) => {
  const guards = [requireAuth, requireAdmin, requireSimulator(opts.enabled)];

  // Loads the registry row for /:id/* and enters the sandbox context. LAST in the chain.
  const enterSimulation = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      await invalid(reply, 'id', 'must be a uuid');
      return;
    }
    const [row] = await mainDb
      .select()
      .from(simulations)
      .where(eq(simulations.id, parsed.data.id))
      .limit(1);
    if (!row) {
      await reply.status(404).send({ error: 'NOT_FOUND', message: 'Simulation introuvable.' });
      return;
    }
    if (row.status !== 'ready') {
      await reply.status(409).send({
        error: 'SIMULATION_NOT_READY',
        message: `La simulation n'est pas prête (${row.status}).`,
        statusCode: 409,
        status: row.status,
      });
      return;
    }
    enterSandbox(sandboxHandleFor(row.id, row.dbName));
    await mainDb
      .update(simulations)
      .set({ lastUsedAt: new Date() })
      .where(eq(simulations.id, row.id));
  };

  app.get('/api/admin/simulations', { preHandler: guards }, async () => {
    const rows = await mainDb.select().from(simulations).orderBy(desc(simulations.createdAt));
    return { simulations: rows.map(view), max: opts.maxSandboxes };
  });

  app.post('/api/admin/simulations', { preHandler: guards }, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return invalid(reply, String(issue?.path[0] ?? 'body'), issue?.message ?? 'invalid');
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [{ count }] = await mainDb
      .select({ count: sql<number>`count(*)::int` })
      .from(simulations)
      .where(ne(simulations.status, 'failed'));
    if ((count ?? 0) >= opts.maxSandboxes) {
      return reply.status(409).send({
        error: 'SIMULATOR_FULL',
        message: `Nombre maximal de simulations atteint (${opts.maxSandboxes}).`,
        statusCode: 409,
        max: opts.maxSandboxes,
      });
    }
    const virtualNow = parsed.data.virtual_start ? new Date(parsed.data.virtual_start) : new Date();
    const [row] = await mainDb
      .insert(simulations)
      .values({
        name: parsed.data.name,
        dbName: sandboxDatabaseName(mainDatabaseName(env.DATABASE_URL)),
        virtualNow,
        createdBy: adminId,
      })
      .returning();
    if (!row) throw new Error('simulation insert returned no row');
    // Fire-and-forget: provisionSimulation never throws (it flips the row to failed instead).
    void provisionSimulation(row.id, request.log);
    return reply.status(202).send(view(row));
  });

  app.get('/api/admin/simulations/:id', { preHandler: guards }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalid(reply, 'id', 'must be a uuid');
    const [row] = await mainDb
      .select()
      .from(simulations)
      .where(eq(simulations.id, parsed.data.id))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Simulation introuvable.' });
    return view(row);
  });

  app.delete('/api/admin/simulations/:id', { preHandler: guards }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalid(reply, 'id', 'must be a uuid');
    const [row] = await mainDb
      .select()
      .from(simulations)
      .where(eq(simulations.id, parsed.data.id))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Simulation introuvable.' });
    if (row.status === 'creating' || row.status === 'deleting') {
      return reply.status(409).send({
        error: 'SIMULATION_BUSY',
        message: `La simulation est occupée (${row.status}).`,
        statusCode: 409,
        status: row.status,
      });
    }
    await deleteSimulation(row.id, row.dbName);
    return reply.status(204).send();
  });

  // Routed: every `db` read below hits the SANDBOX — the proof routing works and SIM-1's counters.
  app.get(
    '/api/admin/simulations/:id/probe',
    { preHandler: [...guards, enterSimulation] },
    async () => {
      const count = async (table: typeof screenhosts | typeof campaigns | typeof users) => {
        const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
        return r?.n ?? 0;
      };
      const [cfg] = await db.select({ id: dispatchConfig.id }).from(dispatchConfig).limit(1);
      return {
        screenhosts: await count(screenhosts),
        campaigns: await count(campaigns),
        users: await count(users),
        dispatch_config_present: Boolean(cfg),
      };
    },
  );
};
```

Check `dispatchConfig`'s primary key column name (`grep -n "export const dispatchConfig" -A 6 apps/api/src/db/schema.ts`) and use it in the probe select.

- [ ] **Step 5: Register**

In `apps/api/src/routes/index.ts`, import `adminSimulationsRoutes` and `env`, then after `await app.register(adminTestingRoutes);`:

```ts
  // SIM-0 — the admin « Simulateur » registry (sandbox databases + context-routed engines).
  await app.register(adminSimulationsRoutes, {
    enabled: env.SIMULATOR_ENABLED,
    maxSandboxes: env.SIMULATOR_MAX_SANDBOXES,
  });
```

- [ ] **Step 6: Run tests, then the full suite, typecheck, lint**

```bash
pnpm --filter @toodooh/api exec vitest run tests/simulations-guards.test.ts tests/simulations-lifecycle.test.ts
pnpm --filter @toodooh/api test
pnpm --filter @toodooh/api typecheck
pnpm lint
```
Expected: all green; typecheck 0; lint 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/middleware/require-simulator.ts apps/api/src/routes/admin-simulations.ts apps/api/src/routes/index.ts apps/api/tests/simulations-guards.test.ts apps/api/tests/simulations-lifecycle.test.ts
git commit -m "feat(api): SIM-0 — admin simulation endpoints, requireSimulator guard + tests"
```

---

### Task 6: Server wiring (boot line, orphan sweep, idle eviction, shutdown)

**Files:**
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `sweepOrphans` (Task 4), `evictIdleSandboxes`, `closeAllSandboxes` (Task 3).

- [ ] **Step 1: Wire it**

Imports:
```ts
import { closeAllSandboxes, evictIdleSandboxes } from './simulator/pools.js';
import { sweepOrphans } from './simulator/provisioning.js';
```

In the `onClose` hook, before `await sql.end();`:
```ts
  await closeAllSandboxes();
```

After `startEventSettlementJob(app.log);`:
```ts
    // SIM-0 — the admin Simulateur. Enabled: drop orphan sandbox databases once at boot and
    // evict idle sandbox pools every 5 min (unref'd). Disabled: ONE boot line, nothing else.
    if (env.SIMULATOR_ENABLED) {
      app.log.info({ max: env.SIMULATOR_MAX_SANDBOXES }, 'simulator enabled');
      void sweepOrphans(app.log).catch((err: unknown) =>
        app.log.warn({ err }, 'simulator: boot orphan sweep failed'),
      );
      const evictTimer = setInterval(
        () => {
          void evictIdleSandboxes().catch((err: unknown) =>
            app.log.warn({ err }, 'simulator: idle eviction failed'),
          );
        },
        5 * 60 * 1000,
      );
      evictTimer.unref();
    } else {
      app.log.info('simulator disabled (SIMULATOR_ENABLED unset)');
    }
```

- [ ] **Step 2: Boot the api locally once**

```bash
cd apps/api && timeout 20 pnpm dev 2>&1 | grep -i "simulator\|listening" | head -3
```
Expected: the `simulator disabled` line (or `enabled` if `.env` sets it) and the listen line. Exit via the timeout is fine.

- [ ] **Step 3: Gates + commit**

```bash
pnpm --filter @toodooh/api typecheck && pnpm lint
git add apps/api/src/server.ts
git commit -m "feat(api): SIM-0 — boot orphan sweep, idle pool eviction, sandbox shutdown"
```

---

### Task 7: Web service + hooks + query keys

**Files:**
- Create: `apps/web/src/features/admin/services/admin-simulator.service.ts`
- Test: `apps/web/src/features/admin/services/admin-simulator.service.test.ts`
- Create: `apps/web/src/features/admin/hooks/useAdminSimulator.ts`
- Modify: `apps/web/src/features/admin/hooks/queryKeys.ts`

**Interfaces:**
- Produces:
  - `type SimulationStatus = 'creating' | 'ready' | 'failed' | 'deleting'`
  - `interface Simulation { id; name; status; virtual_now; error; created_at; last_used_at }`
  - `interface SimulationProbe { screenhosts; campaigns; users; dispatch_config_present }`
  - `adminSimulatorService.{ list(), get(id), create({name, virtual_start?}), remove(id), probe(id) }`
  - `isSimulatorDisabled(err: unknown): boolean` (ApiError with status 503 and code `SIMULATOR_DISABLED`)
  - hooks `useSimulations()`, `useSimulation(id, {poll})`, `useSimulationProbe(id, enabled)`, `useCreateSimulation()`, `useDeleteSimulation()`
  - keys `adminKeys.simulations()`, `adminKeys.simulation(id)`, `adminKeys.simulationProbe(id)`.

- [ ] **Step 1: Failing test**

`admin-simulator.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock, delMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  delMock: vi.fn(),
}));
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { get: getMock, post: postMock, del: delMock } };
});

import { ApiError } from '@/lib/api-client';

import { adminSimulatorService, isSimulatorDisabled } from './admin-simulator.service';

describe('adminSimulatorService', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    delMock.mockReset();
  });

  it('list → GET /admin/simulations', async () => {
    getMock.mockResolvedValue({ simulations: [], max: 5 });
    const r = await adminSimulatorService.list();
    expect(getMock).toHaveBeenCalledWith('/admin/simulations');
    expect(r.max).toBe(5);
  });

  it('create → POST with name and optional virtual_start', async () => {
    postMock.mockResolvedValue({ id: 's1', status: 'creating' });
    await adminSimulatorService.create({ name: 'Monde 1' });
    expect(postMock).toHaveBeenCalledWith('/admin/simulations', { name: 'Monde 1' });
  });

  it('get / probe / remove hit the id routes', async () => {
    getMock.mockResolvedValue({});
    delMock.mockResolvedValue(undefined);
    await adminSimulatorService.get('s1');
    await adminSimulatorService.probe('s1');
    await adminSimulatorService.remove('s1');
    expect(getMock).toHaveBeenNthCalledWith(1, '/admin/simulations/s1');
    expect(getMock).toHaveBeenNthCalledWith(2, '/admin/simulations/s1/probe');
    expect(delMock).toHaveBeenCalledWith('/admin/simulations/s1');
  });

  it('isSimulatorDisabled recognises the 503 SIMULATOR_DISABLED refusal only', () => {
    expect(
      isSimulatorDisabled(new ApiError({ status: 503, code: 'SIMULATOR_DISABLED', message: '' })),
    ).toBe(true);
    expect(isSimulatorDisabled(new ApiError({ status: 503, code: 'OTHER', message: '' }))).toBe(false);
    expect(isSimulatorDisabled(new Error('x'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm --filter @toodooh/web exec vitest run src/features/admin/services/admin-simulator.service.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`admin-simulator.service.ts`:

```ts
import { ApiError, apiClient } from '@/lib/api-client';

// SIM-0 — the admin « Simulateur » registry client. apiClient prepends '/api'. Every route is
// [requireAuth, requireAdmin, requireSimulator]; a 503 SIMULATOR_DISABLED means the server has
// SIMULATOR_ENABLED off — the page shows one line and nothing else.

export type SimulationStatus = 'creating' | 'ready' | 'failed' | 'deleting';

export interface Simulation {
  id: string;
  name: string;
  status: SimulationStatus;
  virtual_now: string;
  error: string | null;
  created_at: string;
  last_used_at: string;
}

export interface SimulationList {
  simulations: Simulation[];
  max: number;
}

export interface SimulationProbe {
  screenhosts: number;
  campaigns: number;
  users: number;
  dispatch_config_present: boolean;
}

export interface CreateSimulationInput {
  name: string;
  virtual_start?: string;
}

export const isSimulatorDisabled = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 503 && err.code === 'SIMULATOR_DISABLED';

export const adminSimulatorService = {
  list: () => apiClient.get<SimulationList>('/admin/simulations'),
  get: (id: string) => apiClient.get<Simulation>(`/admin/simulations/${id}`),
  create: (input: CreateSimulationInput) =>
    apiClient.post<Simulation>('/admin/simulations', input),
  remove: (id: string) => apiClient.del<void>(`/admin/simulations/${id}`),
  probe: (id: string) => apiClient.get<SimulationProbe>(`/admin/simulations/${id}/probe`),
};
```

`queryKeys.ts` — add inside `adminKeys` after the testing keys:
```ts
  simulations: () => [...adminKeys.all, 'simulations'] as const,
  simulation: (id: string) => [...adminKeys.all, 'simulations', id] as const,
  simulationProbe: (id: string) => [...adminKeys.all, 'simulations', id, 'probe'] as const,
```

`useAdminSimulator.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type CreateSimulationInput,
  type Simulation,
  adminSimulatorService,
} from '@/features/admin/services/admin-simulator.service';

import { adminKeys } from './queryKeys';

export function useSimulations() {
  return useQuery({ queryKey: adminKeys.simulations(), queryFn: () => adminSimulatorService.list() });
}

/** Polls every 2 s while the sandbox is still being created. */
export function useSimulation(id: string | null) {
  return useQuery({
    queryKey: adminKeys.simulation(id ?? ''),
    queryFn: () => adminSimulatorService.get(id ?? ''),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      (query.state.data as Simulation | undefined)?.status === 'creating' ? 2000 : false,
  });
}

export function useSimulationProbe(id: string | null, ready: boolean) {
  return useQuery({
    queryKey: adminKeys.simulationProbe(id ?? ''),
    queryFn: () => adminSimulatorService.probe(id ?? ''),
    enabled: Boolean(id) && ready,
  });
}

export function useCreateSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSimulationInput) => adminSimulatorService.create(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulations() }),
  });
}

export function useDeleteSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminSimulatorService.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulations() }),
  });
}
```

- [ ] **Step 4: Run + gates**

```bash
pnpm --filter @toodooh/web exec vitest run src/features/admin/services/admin-simulator.service.test.ts
pnpm --filter @toodooh/web typecheck 2>&1 | grep -c 'error TS'   # expect 14
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin/services/admin-simulator.service.ts apps/web/src/features/admin/services/admin-simulator.service.test.ts apps/web/src/features/admin/hooks/useAdminSimulator.ts apps/web/src/features/admin/hooks/queryKeys.ts
git commit -m "feat(web): SIM-0 — admin simulator service, hooks and query keys"
```

---

### Task 8: The page shell + components + route + nav

**Files:**
- Create: `apps/web/src/features/admin/components/simulator/SimulationStatusBadge.tsx`
- Create: `apps/web/src/features/admin/components/simulator/SimulationList.tsx`
- Create: `apps/web/src/features/admin/components/simulator/CreateSimulationForm.tsx`
- Create: `apps/web/src/features/admin/components/simulator/SimulationDetail.tsx`
- Create: `apps/web/src/features/admin/pages/SimulatorPage.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import next to `TestingPage`; route after `/admin-testing`)
- Modify: `apps/web/src/features/admin/components/AdminLayout.tsx` (import `Gamepad2`; button after « Tests »)

**Interfaces:**
- Consumes: Task 7 hooks and types.

- [ ] **Step 1: Components**

`SimulationStatusBadge.tsx`:
```tsx
import type { SimulationStatus } from '@/features/admin/services/admin-simulator.service';

const LABEL: Record<SimulationStatus, string> = {
  creating: 'Création…',
  ready: 'Prête',
  failed: 'Échec',
  deleting: 'Suppression…',
};
const CLASS: Record<SimulationStatus, string> = {
  creating: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  deleting: 'bg-gray-100 text-gray-700',
};

export function SimulationStatusBadge({ status }: { status: SimulationStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASS[status]}`}>
      {LABEL[status]}
    </span>
  );
}
```

`SimulationList.tsx`:
```tsx
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

import type { Simulation } from '@/features/admin/services/admin-simulator.service';

import { SimulationStatusBadge } from './SimulationStatusBadge';

interface Props {
  simulations: Simulation[];
  max: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SimulationList({ simulations, max, selectedId, onSelect }: Props) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        Simulations ({simulations.length}/{max})
      </h2>
      {simulations.length === 0 && (
        <p className="text-sm text-gray-500">Aucune simulation. Crée la première ci-contre.</p>
      )}
      <ul className="divide-y">
        {simulations.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={`flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm hover:bg-gray-50 ${
                selectedId === s.id ? 'bg-brand-primary/10' : ''
              }`}
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-gray-500">
                {format(new Date(s.virtual_now), 'dd/MM/yyyy HH:mm', { locale: fr })}
              </span>
              <span className="text-gray-400">
                {formatDistanceToNow(new Date(s.created_at), { locale: fr, addSuffix: true })}
              </span>
              <SimulationStatusBadge status={s.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`CreateSimulationForm.tsx`:
```tsx
import { useState } from 'react';

import { useCreateSimulation } from '@/features/admin/hooks/useAdminSimulator';

interface Props {
  disabled: boolean;
  onCreated: (id: string) => void;
}

export function CreateSimulationForm({ disabled, onCreated }: Props) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const create = useCreateSimulation();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, ...(start ? { virtual_start: new Date(start).toISOString() } : {}) },
      {
        onSuccess: (s) => {
          setName('');
          setStart('');
          onCreated(s.id);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">Nouvelle simulation</h2>
      <label className="block text-sm">
        <span className="text-gray-600">Nom</span>
        <input
          className="mt-1 w-full rounded-lg border px-3 py-2"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Monde 1"
        />
      </label>
      <label className="block text-sm">
        <span className="text-gray-600">Début de l'horloge virtuelle (optionnel)</span>
        <input
          type="datetime-local"
          className="mt-1 w-full rounded-lg border px-3 py-2"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      {create.isError && (
        <p className="text-sm text-red-600">
          {create.error instanceof Error ? create.error.message : 'Création impossible.'}
        </p>
      )}
      <button
        type="submit"
        disabled={disabled || create.isPending || !name.trim()}
        className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
      >
        {create.isPending ? 'Création…' : 'Créer'}
      </button>
      {disabled && (
        <p className="text-xs text-gray-500">Nombre maximal de simulations atteint.</p>
      )}
    </form>
  );
}
```

`SimulationDetail.tsx`:
```tsx
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import {
  useDeleteSimulation,
  useSimulation,
  useSimulationProbe,
} from '@/features/admin/hooks/useAdminSimulator';

import { SimulationStatusBadge } from './SimulationStatusBadge';

interface Props {
  id: string;
  onDeleted: () => void;
}

export function SimulationDetail({ id, onDeleted }: Props) {
  const sim = useSimulation(id);
  const ready = sim.data?.status === 'ready';
  const probe = useSimulationProbe(id, ready);
  const del = useDeleteSimulation();
  const [confirming, setConfirming] = useState(false);

  if (sim.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-gray-400" />;
  if (!sim.data) return <p className="text-sm text-red-600">Simulation introuvable.</p>;
  const s = sim.data;

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{s.name}</h2>
        <SimulationStatusBadge status={s.status} />
      </header>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-gray-500">Horloge virtuelle</dt>
        <dd>{format(new Date(s.virtual_now), 'EEEE dd MMMM yyyy HH:mm', { locale: fr })}</dd>
        <dt className="text-gray-500">Créée le</dt>
        <dd>{format(new Date(s.created_at), 'dd/MM/yyyy HH:mm', { locale: fr })}</dd>
        {s.error && (
          <>
            <dt className="text-gray-500">Erreur</dt>
            <dd className="text-red-600">{s.error}</dd>
          </>
        )}
      </dl>
      {s.status === 'creating' && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Base de données en cours de création…
        </p>
      )}
      {ready && probe.data && (
        <dl className="grid grid-cols-4 gap-2 rounded-lg bg-gray-50 p-3 text-center text-sm">
          <div>
            <dt className="text-gray-500">Screenhosts</dt>
            <dd className="text-lg font-semibold">{probe.data.screenhosts}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Campagnes</dt>
            <dd className="text-lg font-semibold">{probe.data.campaigns}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Utilisateurs</dt>
            <dd className="text-lg font-semibold">{probe.data.users}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Config dispatch</dt>
            <dd className="text-lg font-semibold">
              {probe.data.dispatch_config_present ? 'présente' : 'absente'}
            </dd>
          </div>
        </dl>
      )}
      <div className="flex items-center gap-2">
        {!confirming ? (
          <button
            type="button"
            disabled={s.status === 'creating' || s.status === 'deleting'}
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
          >
            Supprimer
          </button>
        ) : (
          <>
            <span className="text-sm text-gray-600">Supprimer la base de données ?</span>
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => del.mutate(id, { onSuccess: onDeleted })}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Oui, supprimer
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border px-3 py-1.5 text-sm"
            >
              Annuler
            </button>
          </>
        )}
        {del.isError && <span className="text-sm text-red-600">Suppression impossible.</span>}
      </div>
    </section>
  );
}
```

`SimulatorPage.tsx`:
```tsx
import { Gamepad2 } from 'lucide-react';
import { useState } from 'react';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { CreateSimulationForm } from '@/features/admin/components/simulator/CreateSimulationForm';
import { SimulationDetail } from '@/features/admin/components/simulator/SimulationDetail';
import { SimulationList } from '@/features/admin/components/simulator/SimulationList';
import { useSimulations } from '@/features/admin/hooks/useAdminSimulator';
import { isSimulatorDisabled } from '@/features/admin/services/admin-simulator.service';

// SIM-0 — the shell. Later slices mount the living world here; this file stays a mount point.
export default function SimulatorPage() {
  const list = useSimulations();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const disabled = list.isError && isSimulatorDisabled(list.error);
  const simulations = list.data?.simulations ?? [];
  const max = list.data?.max ?? 0;
  const full = list.data ? simulations.filter((s) => s.status !== 'failed').length >= max : true;

  return (
    <AdminLayout title="Simulateur">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        <header className="flex items-center gap-3">
          <Gamepad2 className="h-6 w-6 text-brand-primary" />
          <div>
            <h1 className="text-xl font-semibold">Simulateur</h1>
            <p className="text-sm text-gray-500">
              Des mondes synthétiques, isolés dans leur propre base de données, sur lesquels
              tournent les vrais moteurs de la plateforme.
            </p>
          </div>
        </header>

        {disabled && (
          <p className="rounded-xl border bg-white p-4 text-sm text-gray-600">
            Le simulateur est désactivé sur ce serveur.
          </p>
        )}
        {list.isError && !disabled && (
          <p className="text-sm text-red-600">Impossible de charger les simulations.</p>
        )}

        {!disabled && (
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <SimulationList
                simulations={simulations}
                max={max}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              {selectedId && (
                <SimulationDetail id={selectedId} onDeleted={() => setSelectedId(null)} />
              )}
            </div>
            <CreateSimulationForm disabled={full} onCreated={setSelectedId} />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
```

Check how `TestingPage.tsx` imports `AdminLayout` (default vs named) and copy that import form exactly.

- [ ] **Step 2: Route + nav**

`App.tsx`: after the `TestingPage` lazy line add
```ts
const SimulatorPage = lazy(() => import('@/features/admin/pages/SimulatorPage'));
```
and after the `/admin-testing` `<Route>` add
```tsx
            <Route
              path="/admin-simulator"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <SimulatorPage />
                </AdminRoute>
              }
            />
```

`AdminLayout.tsx`: add `Gamepad2` to the lucide import (alphabetical, after `FlaskConical`), and after the « Tests » button inside the same `(role === 'superadmin' || role === 'admin')` block:
```tsx
                  <button
                    onClick={() => navigate('/admin-simulator')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-simulator'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <Gamepad2 className="mr-3 h-5 w-5" />
                    Simulateur
                  </button>
```

- [ ] **Step 3: Gates**

```bash
pnpm --filter @toodooh/web typecheck 2>&1 | grep 'error TS' | sort > /tmp/claude-1000/web-tc-now.txt; wc -l /tmp/claude-1000/web-tc-now.txt   # 14
pnpm lint
pnpm --filter @toodooh/web test
wc -l apps/web/src/features/admin/pages/SimulatorPage.tsx   # < 150
```
Expected: 14 web errors, none in new files; lint 0; web tests green.

- [ ] **Step 4: See it once**

With the api running with `SIMULATOR_ENABLED=true` in `apps/api/.env` and `pnpm --filter @toodooh/web dev`, sign in as an admin, open `/admin-simulator`, create « Monde 1 », watch it flip to « Prête », see the four probe counters (0/0/0/présente), delete it. Screenshot to `docs/qa/sim-0/simulator-shell.png` via the headless recipe in memory (`local-chrome-binaries-headless-evidence`) — optional if no admin session is at hand locally; say so in the report if skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin/components/simulator apps/web/src/features/admin/pages/SimulatorPage.tsx apps/web/src/App.tsx apps/web/src/features/admin/components/AdminLayout.tsx docs/qa/sim-0 2>/dev/null
git commit -m "feat(web): SIM-0 — /admin-simulator shell (list, create, open, delete)"
```

---

### Task 9: Final gates, ledger note, report

- [ ] **Step 1: Full gates from the repo root**

```bash
pnpm --filter @toodooh/api typecheck 2>&1 | grep -c 'error TS'   # 0
pnpm --filter @toodooh/web typecheck 2>&1 | grep -c 'error TS'   # 14
pnpm lint
pnpm test
```
All four must be green. If `pnpm test` shows failures in files the diff never touched or timeouts rather than assertions, treat it as an environment question first (memory: `ci-signal-misreads`) and re-run that suite alone.

- [ ] **Step 2: Deploy-ledger note (memory, not repo)**

Update `memory/deploy-ledger.md`: migration 0071 pending; new env `SIMULATOR_ENABLED` (prod default off; set `true` when the operator wants the page) and `SIMULATOR_MAX_SANDBOXES`; prod Postgres role must keep CREATEDB (it is the container superuser today). Update `memory/sim-program-simulator-lane.md` state to « SIM-0 BUILT, N commits local, awaiting ratify-then-push ».

- [ ] **Step 3: Report to the operator**

One line of what changed; the commit list; the exact gate commands with their counts; flags: whether the visual check ran; that SIM-1 is next.

---

## Self-review

**Spec coverage:** §4 registry → Task 1. §5 provisioning (create 202, background task, failure drop, delete with FORCE, cap 409, busy 409, boot sweep incl. `creating` skipped) → Tasks 4, 5, 6. §6 routing (ALS, proxy on `db`, pool cache with max 3 / idle 60 s / 15 min eviction, `enterSimulation` last, `mainDb` bypass, better-auth untouched) → Task 3 + Task 5; the `sql` amendment recorded in the header and applied in Task 1 Step 5. §7 endpoints, guard 503, env with defaults, boot line → Tasks 1, 5, 6. §8 page shell, nav entry, service, 503 copy, React Query only → Tasks 7, 8. §9 tests: lifecycle (Task 5), isolation incl. transaction + execute + identity-outside-context (Task 3; the « same target » proof is the full existing suite running green through the proxy plus the `current_database()` check), propagation (Task 5 lifecycle probe after a main-only insert), guards (Task 5), sweep (Task 4), web service pin (Task 7). §10 ops → Task 6 + Task 9 ledger note. §11 delivery → the plan carries more, smaller commits than the spec's three; same PR, same migration.

**Placeholders:** none. Two « check the schema before running » notes are verification steps with the exact grep, not deferred work.

**Type consistency:** `SandboxStore { simulationId, db }` used identically in context/pools/routes; `sandboxHandleFor(simulationId, dbName)` in pools, isolation test and routes; `provisionSimulation(id, log)` / `deleteSimulation(id, dbName)` / `sweepOrphans(log)` consistent between provisioning, tests, routes, server; wire shape `Simulation` identical in the api `view()` and the web service; hook names identical between Task 7 and Task 8.
