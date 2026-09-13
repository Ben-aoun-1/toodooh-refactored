# SIM-0 — Simulator sandbox foundation (design)

Date: 2026-09-13. Status: awaiting operator review. Parent program: the admin **Simulateur**
(a gamified, living-world, end-to-end simulation of TOODOOH driven by the REAL engines).

## 1. Context and decision trail

The operator wants an admin page that simulates the whole TOODOOH flow — TVs, PAX devices,
advertisers, campaigns, events, owners accepting or refusing, dispatch, redispatch, pricing, SPS,
availability, month-end money — so the current algorithms and variables can be tested against
synthetic worlds. The rulings taken during brainstorming (2026-09-13):

| # | Question | Ruling |
| --- | --- | --- |
| Q1 | Fidelity vs isolation | **A** — real engines, isolated sandbox database per simulation |
| Q2 | What « gamified » means | **A** — a living world you watch and poke (board, TVs, PAX counters, clock) |
| Q3 | Virtual time | **A** — one tick = one virtual hour, speed dial, jump-to-date |
| Q4 | Build order | SIM-0 → SIM-1 → SIM-2 → SIM-3 → SIM-4 → SIM-5, kept as proposed |
| Q5 | Where it runs | **A** — in prod behind `SIMULATOR_ENABLED`, sandboxes on the prod Postgres |
| Q6 | How the engines reach the sandbox | **1** — context-routed `db` handle (AsyncLocalStorage proxy) |

Why a sandbox database and not tagged rows or an in-memory twin: every engine (dispatch pool,
cascade, redispatch, SPS, boost, C_max, reconcile, event pricing) queries tables through the one
`db` singleton in `apps/api/src/db/client.ts`. Only the inner math is pure. Tagging rows would
force every dashboard, billing job and hub sync to learn an exclusion; an in-memory twin would be
tested instead of TOODOOH. A cloned database runs the engines byte-for-byte on synthetic rows.

Why a context-routed handle and not executor injection: 87 files import `db`. Nothing captures the
handle at module load (verified by grep — no module-level `const x = db.…`, no `.prepare(`), and
better-auth binds `drizzleAdapter(db)` at config time, which must keep pointing at main anyway.
A proxy resolving per async context changes zero engine files.

## 2. The program this slice opens (for orientation only)

- **SIM-0 (this spec)** — sandbox databases, registry, routing, admin endpoints, a minimal page.
- **SIM-1** — world generator (venues, opening hours, sectors, zones, footfall profiles, TVs with
  device sessions, PAX devices, advertisers with wallets, agents; presets and knobs such as
  acceptance rate per owner and TV offline probability).
- **SIM-2** — the virtual-hour tick, headless: proof of play through the real ingest path with
  the virtual clock injected, PAX cells through the real hub-ingest logic, owner answers per
  acceptance rate, the real jobs run with the virtual `now` (lifecycle, dispatch, redispatch,
  SPS, billing, event blocs and settlement, reconcile).
- **SIM-3** — the living-world admin UI (board, clock controls, event injection, per-venue
  inspectors reusing the « Tests » page views pointed at the sandbox).
- **SIM-4** — actor flows through the real routes (campaign → cart → confirm → activate; events;
  boosts; recharges) and « play as » controls.
- **SIM-5** — scenarios with expected outcomes, graded pass/fail per rule.

Two facts from the engine map that later slices depend on, recorded here so they are not lost:
`assemblePool` already takes an injected executor and every orchestrator takes an injected `now`
(`runRedispatchRound`, `runCampaignLifecycleTick`, `computeSps`, `runBoost`, event settlement and
bloc pusher). Proof of play is stamped with the SERVER clock on insert (`playout/ingest.ts`), so
SIM-2 needs one injection point there to write proofs at the virtual time.

## 3. Scope of SIM-0

In scope:

1. A `simulations` registry table in the MAIN database (migration 0071).
2. Provisioning: create a sandbox database on the same server and migrate it; delete it.
3. Routing: `db` and `sql` become context-routed proxies; a per-simulation pool cache.
4. Admin endpoints under `/api/admin/simulations` behind a `requireSimulator` guard.
5. A minimal admin page `/admin-simulator` with list / create / open / delete.
6. Tests that prove isolation, propagation, lifecycle, cap, disabled mode and the boot sweep.

Out of scope (later slices): any synthetic data, any tick, any engine call inside a sandbox,
mounting the « Tests » endpoints under a sandbox, any UI beyond the list/create/open/delete shell.

## 4. Registry (main database, migration 0071)

Table `simulations`:

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `name` | text not null | operator label, 1–80 chars |
| `db_name` | text not null unique | `<main_db>_sim_<8 hex>` — derived, never user-supplied |
| `status` | enum `simulation_status` | `creating`, `ready`, `failed`, `deleting` |
| `virtual_now` | timestamptz not null | the simulation clock; SIM-0 sets it at creation to the request's `virtual_start` (default: now, Tunis) and never moves it |
| `error` | text null | set when `status = failed` |
| `created_by` | uuid not null → `users.id` | the admin |
| `created_at` | timestamptz not null default now() | |
| `last_used_at` | timestamptz not null default now() | touched by every routed request |

The sandbox name is derived from the main database name (parsed from `DATABASE_URL`) plus 8 hex
chars from `crypto.randomBytes`, so `\l` on the server shows ownership at a glance and the boot
sweep can recognise orphans by prefix.

The virtual clock lives here from day one so SIM-2 only has to advance it. In SIM-0 it is stored
and displayed, nothing reads it.

## 5. Provisioning

**Create** — `POST /api/admin/simulations` `{ name, virtual_start? }` validates, enforces the cap
(count of rows with status ≠ `failed` ≥ `SIMULATOR_MAX_SANDBOXES` → 409 `SIMULATOR_FULL`), inserts
the row in `creating`, answers **202** with the row, and starts a background task (not awaited by
the request; failure-isolated, ONE log line per outcome):

1. open a maintenance connection to the same server, database `postgres` (same recipe as
   `tests/helpers/parallel-db.ts::maintenanceUrl`), `CREATE DATABASE "<db_name>"`;
2. open a `max: 1` connection to the new database and run the drizzle migrator on it. The
   migrator call in `apps/api/scripts/migrate.ts` moves into `src/db/migrate-runner.ts`
   (`applyMigrations(databaseUrl)`), and the script becomes a caller of it — no second copy;
3. on success set `status = ready`; on any failure set `status = failed`, `error = message`, and
   best-effort `DROP DATABASE IF EXISTS … WITH (FORCE)` so no half-built database survives.

Migrations already seed the reference tables (governorates, business_sectors, zones,
predefined_zones, dispatch_config, one agent), so a fresh sandbox is usable by the engines
without any extra seed step.

**Delete** — `DELETE /api/admin/simulations/:id`: set `status = deleting`, close and evict the
sandbox pool if cached, `DROP DATABASE IF EXISTS "<db_name>" WITH (FORCE)` (Postgres 16 in
`infra/`), delete the row, answer 204. A second delete → 404. Deleting a row in `creating` is
refused with 409 `SIMULATION_BUSY` (the background task owns it until it settles).

**Boot sweep** — when `SIMULATOR_ENABLED` is true, once at boot (after listen, same shape as the
other boot sweeps in `server.ts`): list databases named `<main_db>_sim_%`, drop those with no
registry row, and mark registry rows whose database does not exist as `failed` with error
`database missing`. One log line per action. When disabled, the sweep does not run.

## 6. Routing

New module `apps/api/src/simulator/context.ts`:

- `const sandboxContext = new AsyncLocalStorage<{ simulationId: string; db: DrizzleDb; sql: Sql }>()`
- `runInSandbox(store, fn)` (wraps `als.run`). **Amendment (build, 2026-09-13):** no `enterWith`
  helper — from an async Fastify preHandler it does not reach the handler (measured: the probe
  counted main). The routing preHandler is CALLBACK-style and calls `done()` inside `runInSandbox`.
- `sandboxHandleFor(simulation)`: a cache `Map<simulationId, { sql, db, lastUsed }>`; pools are
  `postgres(url, { max: 3, idle_timeout: 60, connect_timeout: 10 })`, url = `DATABASE_URL` with
  the pathname replaced by `db_name`. `evictSandbox(simulationId)` ends the pool and drops the
  entry. A `setInterval(…).unref()` every 5 minutes evicts entries idle for more than 15 minutes.

`apps/api/src/db/client.ts` keeps building the real main handle (`sql`, `mainDb`) exactly as
today, then exports `db` as a Proxy over `mainDb` whose `get` trap reads the property from
`currentSandbox()?.db ?? mainDb` and binds functions to that target. Outside any context the
resolved target is always `mainDb`, so every existing import behaves as before; the `DrizzleDb`
type is unchanged. **Amendment (plan, 2026-09-13):** the raw `sql` export is NOT routed — its only
consumer is `server.ts`'s `sql.end()` at shutdown; every raw statement in the codebase goes through
drizzle's `sql` tag on `db.execute(...)`, which the routed `db` already covers.

Fastify wiring, in `apps/api/src/routes/admin-simulations.ts`: routes under
`/api/admin/simulations/:id/*` carry the preHandler chain `[requireAuth, requireAdmin,
requireSimulator, enterSimulation]`. `enterSimulation` is LAST, so an unauthenticated or
non-admin request never resolves a pool. It (a) loads the registry row from MAIN (no context
exists yet), (b) 404 when absent, 409 `SIMULATION_NOT_READY` unless `status = ready`, (c)
resolves the pool via `sandboxHandleFor`, (d) touches `last_used_at` on main via `mainDb`
explicitly (the one place that must bypass the proxy on purpose), (e) calls `done()` inside
`runInSandbox(store, …)` so the handler runs within the store.
Propagation from a preHandler into the handler is the pattern `@fastify/request-context` relies
on, and it gets a dedicated test (§9) rather than trust.

Everything else in the api — better-auth (bound to `mainDb` at config time), the boot jobs, the
hub-sync routes, the websocket — never enters a context and keeps hitting main.

## 7. Endpoints and guards

All under `[requireAuth, requireAdmin, requireSimulator]`. `requireSimulator` answers **503**
`SIMULATOR_DISABLED` when `env.SIMULATOR_ENABLED` is false — the same shape as the hub-sync key
guard (`require-sync-key.ts`, 503 when unset).

| method | path | body / answer |
| --- | --- | --- |
| POST | `/api/admin/simulations` | `{ name, virtual_start? }` → 202 `Simulation` |
| GET | `/api/admin/simulations` | → `{ simulations: Simulation[], max: number }` newest first |
| GET | `/api/admin/simulations/:id` | → `Simulation` (any status; no context entered) |
| DELETE | `/api/admin/simulations/:id` | → 204 / 404 / 409 |
| GET | `/api/admin/simulations/:id/probe` | routed; → `{ screenhosts, campaigns, users, dispatch_config_present }` counted THROUGH the proxy |

`Simulation` wire shape: `{ id, name, status, virtual_now, error, created_at, last_used_at }`
(`db_name` is never sent to the browser). Validation with zod like every other route.

Env (`src/env.ts`): `SIMULATOR_ENABLED` (`'true' | 'false'`, default `'false'`, coerced to
boolean) and `SIMULATOR_MAX_SANDBOXES` (integer 1–20, default 5). Both optional; boot logs one
line stating whether the simulator is on.

## 8. Web page (SIM-0 shell)

- Route `/admin-simulator`, `React.lazy`, inside `AdminRoute` (default admin + superadmin), in
  `App.tsx` next to `/admin-testing`.
- Sidebar entry « Simulateur » in `features/admin/components/AdminLayout.tsx`, next to « Tests ».
- `features/admin/services/admin-simulator.service.ts` — the five calls above, typed, through
  `apiClient`; on a 503 with code `SIMULATOR_DISABLED` the page renders one line: « Le simulateur
  est désactivé sur ce serveur. »
- `features/admin/pages/SimulatorPage.tsx` — a shell that mounts sections, capped well under
  400 lines: `SimulationList` (name, status badge, virtual clock, age, open/delete),
  `CreateSimulationForm` (name, optional virtual start date), `SimulationDetail` (status, clock,
  probe counts, polling every 2 s while `creating`, inline confirm on delete). Components under
  `features/admin/components/simulator/`. Tailwind only, French labels, `date-fns` for dates.
- React Query for all server state; no Zustand store in this slice.

## 9. Tests

Api (`apps/api/tests/`, real Postgres, per-worker database):

1. `simulations-lifecycle.test.ts` — create → poll to `ready`; `probe` returns zero counts and
   `dispatch_config_present = true`; delete → 204, the database is gone (`pg_database` check),
   second delete → 404; delete while `creating` → 409.
2. `simulations-isolation.test.ts` — inside `runInSandbox` insert a screenhost via the routed
   `db`; outside, main counts 0 and inside counts 1; `db.transaction` opened inside the context
   writes to the sandbox; a `db.execute(sql`…`)` inside the context hits the sandbox; the proxy
   outside any context resolves to the same target as `mainDb` (identity check on `$client`).
3. `simulations-propagation.test.ts` — an `app.inject` on `:id/probe` proves the context set by
   the `enterSimulation` preHandler reaches the handler and its awaited queries (the probe
   counts come from the sandbox, not main, after main has been given one extra screenhost).
4. `simulations-guards.test.ts` — disabled → 503 on every route; cap → 409; non-admin → 403;
   not-ready → 409 on routed routes.
5. `simulations-sweep.test.ts` — an orphan database with the prefix is dropped by the boot sweep;
   a registry row whose database is missing flips to `failed`.

Tests create their sandboxes on the worker's server and always delete them in `afterAll`, so the
per-worker database recipe is untouched. Never run two full api suites at once (shared server).

Web: `admin-simulator.service.test.ts` pinning the paths and the 503 mapping (node env, like the
sibling admin service tests).

## 10. Error handling and operations

- Creation failures never leave a database behind (best-effort drop) and never throw out of the
  background task; the row carries the error for the page to show.
- Pool exhaustion is bounded: at most `SIMULATOR_MAX_SANDBOXES × 3` sandbox connections, idle
  ones closed after 60 s, entries evicted after 15 min idle.
- Prod prerequisite: the api's Postgres role must hold `CREATEDB` (today it is the container
  superuser from `POSTGRES_USER`, so nothing to change). Disk: a fresh migrated sandbox is a few
  MB; the cap bounds the count.
- Deploy ledger entry: migration 0071; two new env vars (`SIMULATOR_ENABLED=true` on prod when
  the operator wants the page live); no data migration.

## 11. Delivery

One PR, one migration, three commits, each ending green on the named gates:

1. `feat(api): SIM-0 — simulations registry, context-routed db handle, sandbox provisioning`
2. `feat(api): SIM-0 — admin simulation endpoints, requireSimulator guard, boot sweep + tests`
3. `feat(web): SIM-0 — /admin-simulator shell (list, create, open, delete)`

Gates per commit: `pnpm --filter @toodooh/api typecheck` (0), `pnpm --filter @toodooh/web
typecheck` (baseline 14, error set unchanged), `pnpm lint` (0), `pnpm test`. Commits halt local
until the operator ratifies the push.
