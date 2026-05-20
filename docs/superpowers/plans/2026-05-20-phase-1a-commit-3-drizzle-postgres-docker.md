# Phase 1a Commit 3 — Drizzle + Postgres + Docker Compose + migration runner + /health DB-ping

Third and final commit of the Phase-1 backend foundation. Commit 2
(`326d39b`) landed env validation, pino logging, `/health`, and a shaped
error handler. Commit 3 adds a real database layer: a Dockerized
Postgres+PostGIS, a Drizzle client, a migration pipeline that proves
itself with an empty initial migration, and a `/health` extension that
pings the DB. After this, Phase 1a closes and Phase 1b (users table +
better-auth + signup) opens with the foundation it needs.

The five pieces co-deliver because they reference each other (Drizzle
needs a connection; the connection needs Postgres; the migration runner
needs Drizzle configured; the `/health` ping needs the connection).

**This plan surfaces EIGHT findings that diverge from the firing
prompt's literal instructions.** Each is a plan-time catch (cheap) rather
than an execution-time surprise (expensive). Findings 1–2 are
location/naming conflicts inside the prompt and against CLAUDE.md;
findings 3–8 are design consequences. All are summarized in §2 and
flagged as watch-items in §12.

---

## §0 — Pre-flight verification

**Working tree state.** Branch `main`, clean. HEAD at `326d39b`
(Commit 2.1), pushed and CI-green (run `26134109474`). Origin in sync.

**Repo baseline gates — floor for Commit 3 (CF-10).**
The four root gates were CI-verified at `326d39b` (the Commit 2.1
landing, run `26134109474` green) at:

| Gate | Floor | Source |
| --- | --- | --- |
| `pnpm typecheck` (root) | **51** | CI-green at 326d39b |
| `pnpm lint` (root) | **1** | CI-green at 326d39b |
| `pnpm test` (root) | **167** (160 web + 7 api) | CI-green at 326d39b |
| `pnpm build` (apps/web main gzip) | **139.80 kB** | CI-green at 326d39b |
| `pnpm --filter @toodooh/api test` | **7** | Commit 2.1 |

> **Note on re-baseline:** a live full-gate re-run was attempted
> plan-time but interrupted; the floor above is the CI-verified
> post-2.1 state (same session continuum, no intervening commits). The
> live re-baseline runs at the **start of Commit 3.1 execution**, where
> gates run anyway — any drift surfaces there before edits land.

**Node version.** Default `node` is v24; repo pins `>=20 <21`. Every
gate command + git commit prefixes the PATH export to
`~/.nvm/versions/node/v20.20.2/bin`. Node 20.20.2 supports both
`--env-file=` and `--env-file-if-exists=` (verified plan-time).

**CF-18 sweep — clean (no collisions).** Verified plan-time, absent at
HEAD:
- No `docker-compose.yml` / `docker-compose.yaml` / `compose.yml` /
  `compose.yaml` at repo root **or** under `infra/` (no `infra/` dir
  exists yet).
- No `apps/api/.env`, `apps/api/.env.example`, `apps/api/drizzle/`,
  `apps/api/drizzle.config.ts`, `apps/api/src/db/`,
  `apps/api/scripts/`.
- No `app.decorate('db'`, `app.db`, or `FastifyInstance { db }` anywhere
  in `apps/api/src`.
- No `"migrate"` / `"db:generate"` script in any package.json.
- Existing `.env` artifacts are apps/web-only (`apps/web/.env.local`,
  `apps/web/.env.example`) — no collision.

Three-axis check (CF-18): Axis 1 neighborhood — no `compose.*`,
`db.ts`, `database.ts` near the target names. Axis 2 representation —
no alternate-cased or alternate-extension variants. Axis 3
source/target — greenfield, no migration-from state.

---

## §1 — Locked constraints

**Pinned versions (plan-time, 2026-05-20, exact pins):**

| Package | Version | Notes |
| --- | --- | --- |
| `drizzle-orm` | `0.45.2` | `npm view drizzle-orm version` |
| `drizzle-kit` | `0.31.10` | `npm view drizzle-kit version` (devDep) |
| `postgres` | `3.4.9` | postgres.js, `npm view postgres version` |

Unchanged from Commit 2: fastify 5.8.5, zod 4.4.3, pino 10.3.1,
pino-pretty 13.1.3, vitest 4.1.6, @types/node 20.19.41, tsx 4.22.3,
typescript 5.7.2.

**Docker image (architect-locked decision #1):** `postgis/postgis:16-3.4`
(Postgres 16 + PostGIS 3.4). Existence verified at execution via
`docker compose pull` (network call deferred from plan-time per
operator preference; risk-register §7 covers pull failure).

**In-scope — files (final, reflecting findings 1–2):**

| File | Action | Note |
| --- | --- | --- |
| `infra/docker-compose.yml` | create | **Finding 1** — `infra/`, not repo root |
| `apps/api/src/db/schema.ts` | create | empty schema, documents Phase 1b users table |
| `apps/api/src/db/client.ts` | create | drizzle client + `sql` handle + `DrizzleDb` type |
| `apps/api/scripts/migrate.ts` | create | **Finding 2** — `scripts/`, not `src/db/` |
| `apps/api/src/types/fastify.d.ts` | create | `FastifyInstance { db }` augmentation (**Finding 6 of prompt**) |
| `apps/api/drizzle.config.ts` | create | drizzle-kit config |
| `apps/api/drizzle/0000_initial.sql` | create | `CREATE EXTENSION IF NOT EXISTS postgis;` (**Finding 5**) |
| `apps/api/drizzle/meta/_journal.json` | create | drizzle-kit generated |
| `apps/api/drizzle/meta/0000_snapshot.json` | create | drizzle-kit generated |
| `apps/api/.env.example` | create | documents the env shape |
| `apps/api/tests/db.test.ts` | create | schema imports cleanly (no connection) |
| `apps/api/src/env.ts` | modify | add `DATABASE_URL` required |
| `apps/api/src/routes/health.ts` | modify | db-ping → `checks.db`, `status: degraded` |
| `apps/api/src/server.ts` | modify | `decorate('db')` + `onClose` hook (**Finding 4**) |
| `apps/api/vitest.config.ts` | modify | inject `DATABASE_URL` test env (**Finding 3**) |
| `apps/api/tsconfig.test.json` | modify | include `scripts/`, `drizzle.config.ts` (**Finding 2**) |
| `apps/api/tests/env.test.ts` | modify | DATABASE_URL cases (**Finding 3**) |
| `apps/api/tests/health.test.ts` | modify | ok + degraded paths |
| `apps/api/package.json` | modify | deps + scripts |
| `apps/api/README.md` | modify | first-run section |
| `pnpm-lock.yaml` | modify | `pnpm install` |

**Out-of-scope, deferred:** users table / any schema (Phase 1b);
better-auth/sessions (Phase 1b); MinIO/storage (Phase 1d); email
(Phase 1b); production secrets/backups (Phase 1g+); pool tuning beyond
postgres.js defaults; CI workflow changes (**Finding 8** — none needed);
frontend (Phase 1f).

---

## §2 — Inventory phase & the eight findings

### Finding 1 (HALT-class) — `docker-compose.yml` belongs in `infra/`, not repo root

**Architect decision #6** locks "repo-root `docker-compose.yml`".
**But:**
- `CLAUDE.md` line 13: *"`infra/` — Docker Compose, nginx config, SQL
  migrations (created as needed)"* — explicitly designates `infra/` as
  the compose home.
- `CLAUDE.md` line 15: the permitted-root-files list **does not include
  `docker-compose.yml`**; *"Adding any other file at root requires
  explicit user approval."* CLAUDE.md rule #6: *"No new files in repo
  root."*
- `docs/handoff/00-PROJECT_HANDOFF.md` §4 (line 84): shows
  `infra/docker-compose.yml`.

Per the instruction-priority order (user's CLAUDE.md = highest
authority, above architect-prompt conventions) and the methodology's
bidirectional honest-reporting discipline (Part 4: *"the executor
pushing back on an architect figure is the discipline working"*), this
plan **recommends `infra/docker-compose.yml`**.

The architect's stated rationale for #6 — *"future services (MinIO,
etc.) join the same compose file"* — is fully satisfied by
`infra/docker-compose.yml`; the location does not affect multi-service
capability. Choosing `infra/` also pre-creates the `infra/` directory
that handoff §4 anticipates for nginx + SQL.

**Consequence if `infra/`:** README commands become
`docker compose -f infra/docker-compose.yml up -d postgres`. Nothing
else changes (the migrate/db paths are `apps/api`-relative, independent
of the compose file location). No CLAUDE.md edit needed.

**Consequence if repo-root (architect overrides):** CLAUDE.md's
permitted-root-files list (line 15) needs a companion edit to add
`docker-compose.yml`, and this deviates from handoff §4. That makes the
commit touch CLAUDE.md — a heavier change.

→ **Watch-item #1.** Plan defaults to `infra/docker-compose.yml`.

### Finding 2 (conflict in prompt) — migrate runner belongs in `scripts/`, not `src/db/`

**Architect decision #3** says `apps/api/scripts/migrate.ts`.
**Architect SCOPE-IN** says `apps/api/src/db/migrate.ts`. These
conflict.

The ESLint config's `no-console` rule is **global error**, with a
carve-out for `**/scripts/**` (eslint.config.js lines 96–105). A
migration runner is a CLI tool that should log progress to stdout. In
`src/db/` it cannot use `console` (would need to instantiate pino —
heavy for a one-shot script); in `scripts/` it can.

→ **Recommend `apps/api/scripts/migrate.ts`** (matches decision #3 and
the eslint carve-out). Requires adding `scripts/**/*.ts` to
`tsconfig.test.json`'s `include` so `pnpm typecheck` covers it.
**Watch-item #2.**

### Finding 3 — required `DATABASE_URL` breaks the eager env singleton in tests

Commit 2's `env.ts` ends with `export const env = parseEnv(process.env)`
— an **eager parse at module load**. With `DATABASE_URL` now required
(no default), importing `env.ts` in `tests/env.test.ts` throws unless
`DATABASE_URL` is present in the vitest process. Also,
`tests/env.test.ts`'s existing `parseEnv({})` "defaults" case now
throws (DATABASE_URL missing).

**Fix (two parts):**
1. `vitest.config.ts` injects a dummy `DATABASE_URL` via `test.env` so
   the eager singleton parses when any test imports `env.ts`.
2. `tests/env.test.ts` updated: the "defaults" case passes a
   `DATABASE_URL`; a new case asserts `parseEnv({})` **rejects** missing
   `DATABASE_URL`.

Keeping the eager singleton (architect's Commit 2 pattern) over making
it lazy — the vitest env injection is the minimal change. **Watch-item
#3.**

### Finding 4 — graceful-shutdown ordering; use Fastify `onClose` hook

**Architect SCOPE-IN** says *"close [db] in the existing shutdown
handler before app.close()"*. The correct order is the **reverse**:
`app.close()` first (stops accepting new connections, drains in-flight
requests), **then** close the DB — otherwise in-flight handlers lose
their connection mid-request.

**Recommend** the idiomatic Fastify pattern:
`app.addHook('onClose', async () => { await sql.end(); })`. Fastify
runs `onClose` hooks during `app.close()`, after the server stops
accepting connections. The existing shutdown handler stays unchanged
(just `app.close()`); the hook closes the DB at the right moment. This
sidesteps the ordering question entirely. **Watch-item #4.**

### Finding 5 — drizzle-kit does not generate `CREATE EXTENSION`

Extensions live outside Drizzle's schema model, so `drizzle-kit
generate` against an empty schema produces no `CREATE EXTENSION`.
Confirmed by `docs/handoff/supabase-schema-inventory.md` §9 (line 562):
*"Phase 1 Postgres needs `CREATE EXTENSION postgis;`. Drizzle has
limited PostGIS support; may need raw SQL."*

**Path chosen (a, with the clean escape hatch):** run
`drizzle-kit generate --custom --name initial`. The `--custom` flag
creates an **empty** migration file plus correct `meta/_journal.json` +
`meta/0000_snapshot.json` entries; we then hand-add
`CREATE EXTENSION IF NOT EXISTS postgis;` to the generated
`0000_initial.sql`. This keeps drizzle-kit's meta bookkeeping authoritative
(so future table migrations chain correctly) while injecting raw SQL.
**Watch-item #5.**

### Finding 6 — tests mock the db client (confirmed by CI shape)

The repo CI (`.github/workflows/ci.yml`) `Test` step runs `pnpm test`
plainly, with **no `services: postgres`** block. If apps/api tests
needed a real connection, CI would fail. → Inventory item 4 **path (c)
— mock the db client** — is mandatory, not just preferred. All three
new/updated test concerns (db schema import, health ok, health
degraded) run **without a real connection**. **No CI workflow change is
needed (Finding 8).**

### Finding 7 — `.env` loading without a new dependency

Node 20.20.2 supports `--env-file-if-exists=` (verified plan-time). The
`dev` and `migrate` scripts use `--env-file-if-exists=.env` — loads
`.env` when present, no crash when absent (e.g., DATABASE_URL supplied
via shell or CI). No `dotenv` dependency added. tsx forwards Node flags;
forwarding verified at execution (risk-register fallback: add `dotenv`).
**Watch-item #6.**

### Finding 8 — dist contents & no CI change

`scripts/migrate.ts` runs via `tsx` and is **not** built to `dist/`
(it lives outside `src/`, which `tsconfig.json` build-includes). The
`drizzle/` folder is data, read at runtime via the package-relative
path `drizzle/` — **not** copied to `dist/`. `src/types/fastify.d.ts` is
a declaration — emits no `.js`. So `dist/` after `tsc` contains:
`server.js`, `env.js`, `logger.js`, `error-handler.js`,
`db/client.js`, `db/schema.js`, `routes/health.js` (+ their `.d.ts`/maps).
CI needs no change (Finding 6).

### Inventory item — Fastify decoration + type augmentation

`app.decorate('db', db)` + module augmentation in a dedicated
`apps/api/src/types/fastify.d.ts` (`declare module 'fastify'`). Imported
as `import type` so no runtime/eager-parse coupling. Covered by both
`tsconfig.json` (build) and `tsconfig.test.json` (typecheck) via
`src/**/*.ts`.

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **3.0** | **Plan document** (this file). Halt; approve; commit + push (CF-6). |
| **3.1** | **Implementation:** ~20 files + lockfile (§1 table). Halt; CF-9 pause summary; approve; commit + push (CF-7). |

Commit 3.1 is **mechanical** with one **judgment** seam: the
`drizzle-kit generate --custom` step produces files whose exact bytes
are tool-determined — verified against §11 at execution, not
pre-written verbatim. Everything else is deterministic from §11.

Not split further: the five pieces can't be exercised in isolation
(gate-driven discipline needs runnable gates per commit).

---

## §4 — Per-commit verification gates

### Gate 1 — Workspace registration

`pnpm -r ls --depth -1` shows `@toodooh/api` + `@toodooh/web`.

### Gate 2 — Per-package (apps/api floor: test 7 → 10)

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
pnpm --filter @toodooh/api typecheck   # 0; covers src+tests+scripts+drizzle.config via tsconfig.test.json
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # 10 passing, 0 failing (mocked db; no connection)
pnpm --filter @toodooh/api build       # success; dist contents per Finding 8
```

| Filter gate | Floor |
| --- | --- |
| typecheck | **0** |
| lint | **0** |
| test | **10 passing, 0 failing** (env 4 + health 2 + error-handler 3 + db 1) |
| build | **success**; `dist/{server,env,logger,error-handler,db/client,db/schema,routes/health}.js` |

### Gate 3 — Root no-regression vs `326d39b` floors

| Root gate | Floor | Post-Commit-3 expected |
| --- | --- | --- |
| typecheck | 51 | **51** (apps/api still 0) |
| lint | 1 | **1** |
| test | 167 | **170** (apps/api 7 → 10) |
| build (apps/web main gzip) | 139.80 kB | **139.80 kB ±0.5** |

### Gate 4 — Boot + DB verification (manual, post-build)

```bash
# 1. start Postgres (path per Finding 1)
docker compose -f infra/docker-compose.yml up -d postgres
# 2. wait for healthy
docker compose -f infra/docker-compose.yml ps        # STATUS = healthy
# 3. set .env (cp apps/api/.env.example apps/api/.env), then migrate
pnpm --filter @toodooh/api migrate                    # exits 0
# 4. verify extension
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U toodooh -d toodooh_dev -c \
  "SELECT extname FROM pg_extension WHERE extname='postgis';"   # 1 row
# 5. boot
pnpm --filter @toodooh/api dev                        # env validates, listens :4000
# 6. healthy ping
curl -s http://localhost:4000/health
#   {"status":"ok","uptime":<n>,"timestamp":"...","checks":{"db":"ok"}}  HTTP 200
# 7. stop DB
docker compose -f infra/docker-compose.yml stop postgres
# 8. degraded ping
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health    # 200
curl -s http://localhost:4000/health
#   {"status":"degraded",...,"checks":{"db":"error"}}  HTTP 200
# 9-10. restart DB, recovery ping → status:"ok" again
docker compose -f infra/docker-compose.yml start postgres
# 11. SIGINT dev → onClose ends sql, clean shutdown < 2s
```

### Gate 5 — CI on push

`gh run watch <id>` against the 3.1 headSha. No workflow change
(Finding 6/8). Expected green.

---

## §5 — Standing operating procedure

- **CF-6** for 3.0 (docs push immediate + CI watch).
- **CF-7** for 3.1 (gate sweep → boot+DB verification → CF-9 → approve →
  push → CI watch).
- **Node PATH prefix** on every gate + git command.
- **CF-18 sweep** done plan-time (§0). Re-verify `ls infra/ apps/api/src/db`
  empty before first Write at 3.1.
- **CF-10** floor cited from CI-green 326d39b; live re-baseline at 3.1
  start.

---

## §6 — Hard-halt conditions

1. Any apps/api gate fails (typecheck/lint/test/build).
2. Any root gate regresses from §0 floor.
3. **Finding 1 unresolved** — architect hasn't confirmed `infra/` vs
   repo-root for the compose file.
4. `drizzle-kit generate --custom` doesn't produce usable meta files, or
   `migrate()` won't apply the hand-edited `CREATE EXTENSION` SQL
   (Finding 5 fails).
5. `infra/docker-compose.yml` (or the chosen path) already exists —
   surface, don't overwrite. (Swept clean §0; re-check at 3.1.)
6. `postgis/postgis:16-3.4` doesn't pull (network or tag).
7. Migration runner exits 0 but `postgis` extension absent (silent
   success) — Gate 4 step 4 must show 1 row.
8. `/health` degraded path doesn't return `status:'degraded'` /
   `checks.db:'error'` / HTTP 200 when DB down.
9. SIGINT doesn't close the DB connection (onClose hook not firing).
10. `app.db` type augmentation doesn't compile.
11. CI would require a Postgres service (contradicts Finding 6) — halt,
    don't expand scope.
12. tsx doesn't forward `--env-file-if-exists` and there's no clean
    fallback (Finding 7).

---

## §7 — Risk register

| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| Postgres image pull slow/fails on first run | Medium | Gate 4 step 1 hangs/errors | Pre-pull `docker compose -f infra/docker-compose.yml pull`; risk is network, not config |
| drizzle-kit `--custom` meta drift | Low | Gate 4 step 3 migrate errors | Inspect generated `meta/`; regenerate if malformed |
| Eager env singleton throws in tests | **Resolved by Finding 3** | Gate 2 test load error | `vitest.config.ts` `test.env.DATABASE_URL` |
| Mock db pattern brittle | Low | Gate 2 health tests | Decorate test app with a typed mock (`as unknown as` double-assertion, sanctioned escape per CLAUDE.md) |
| Fastify decoration TS ergonomics | Low | Gate 2 typecheck | Dedicated `src/types/fastify.d.ts`, `import type` only |
| Migration runner exit-code semantics | Low | Gate 4 step 3 | `migrate.ts` exits 1 on catch, 0 on success (scripts/ allows console for the log) |
| `.env-file-if-exists` not forwarded by tsx | Low | Gate 4 step 5 boot (no DATABASE_URL) | Fallback: add `dotenv` + import in scripts only; or `node --env-file-if-exists` wrapper |
| postgres.js pool defaults on dev PG | Very low | Gate 4 pings | Defaults (max 10) are fine for dev; tuning is out-of-scope |
| onClose hook ordering | **Resolved by Finding 4** | Gate 4 step 11 | Fastify runs onClose after server stop |
| Repo-root compose violates CLAUDE.md | **Resolved by Finding 1** | plan review | Default to `infra/` |

---

## §8 — Cross-references

- **Architecture.** `00-PROJECT_HANDOFF.md` §4 — Fastify v5, Drizzle,
  Postgres 16, `infra/docker-compose.yml`. Stateful sessions = Phase 1b.
- **Schema/PostGIS.** `supabase-schema-inventory.md` §9 (lines 554–562)
  — `screens.coordinates` + `locations.coordinates` are PostGIS `POINT`
  with GIST indexes; Phase 1 needs `CREATE EXTENSION postgis`. Drizzle
  PostGIS support is limited (raw SQL likely later). This commit installs
  the extension; no spatial columns yet.
- **CLAUDE.md** lines 13, 15 — `infra/` compose home + root-file
  restriction (Finding 1).
- **Methodology.** Part 4 — grep-everything, negative-claim
  verification, bidirectional honest reporting (drives Findings 1/4).
- **CF-18 doc** — three-axis sweep (§0).
- **Prior commits.** `d0dbc22`, `d723ae6`, `7e8d4f4`, `326d39b`.

---

## §9 — Carry-forward methodology

- **CF-9** — 3.1 pause summary lists the 22 items from the firing prompt
  + verbatim contents of every new/modified file.
- **CF-10** — floor cited CI-green at 326d39b; live re-baseline at 3.1
  start.
- **CF-18** — swept clean plan-time (§0), three axes.
- **CF-19 candidate (third worked example).** Exact-pin greenfield
  discipline → drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9.
  Third instance after Commit 1 (typescript) + Commit 2 (zod/pino/vitest).
  Promotable at the next audit refresh.
- **CF-20 — PROMOTED (architect-approved 2026-05-20).** Two worked
  examples meet the threshold: Commit 2's `tsconfig.test.json` + Commit
  3's extension to cover `scripts/` + `drizzle.config.ts`. The
  generalized rule: *"When introducing a test-tooling tsconfig split,
  the test-side tsconfig extends the build tsconfig and adds the
  test-adjacent paths (scripts, config files at app root, anything
  tooling-only) to its `include` array. The build tsconfig stays
  `rootDir`-strict for `tsc` emit."* Write up formally in this commit's
  audit refresh.
- **Tracked follow-up carried from Commit 2** — vitest major alignment
  ([#40](https://github.com/Ben-aoun-1/toodooh-refactored/issues/40)),
  unaffected by this commit.

**New CF candidate (recorded, parked — architect-confirmed not yet
promotable):**
- **CF-21 candidate — "Eager config singletons need a test-env shim."**
  A module that parses required env at import time (`export const env =
  parse(process.env)`) forces every test that transitively imports it to
  supply those vars. Inject them via the test runner's env option rather
  than making the singleton lazy. Worked example: Finding 3. **Needs a
  second instance to promote** — Phase 1b's better-auth likely adds
  another required env var (`AUTH_SECRET` or equivalent), which would be
  the second example. If it doesn't materialize, the candidate stays
  parked.

- **CF-19 — now well-established (commits 1, 2, 3).** Exact-pin
  discipline for every backend runtime + dev dependency. Formal write-up
  in this commit's audit refresh (architect-confirmed).

---

## §10 — Push policy + sequencing

**Commit 3.0 — Plan document**
```bash
git add docs/superpowers/plans/2026-05-20-phase-1a-commit-3-drizzle-postgres-docker.md
git commit -m "docs(phase-1a): plan Commit 3 — drizzle + postgres + docker + /health db-ping"
git push origin main
gh run watch   # CF-6
```

**Commit 3.1 — Implementation**
```bash
git add apps/api infra pnpm-lock.yaml   # (+ CLAUDE.md only if architect picks repo-root for Finding 1)
git commit -m "feat(api): add drizzle + postgres, docker compose, migration runner, /health db-ping

[body summarizing the five pieces + the resolved findings]"
git push origin main
gh run watch   # CF-7
```

Both land on `main` directly. No `Co-Authored-By` trailer.

---

## §11 — Exact file contents (Commit 3.1)

### `infra/docker-compose.yml` (Finding 1 — `infra/`)

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    environment:
      POSTGRES_USER: toodooh
      POSTGRES_PASSWORD: toodooh
      POSTGRES_DB: toodooh_dev
    ports:
      - '5432:5432'
    volumes:
      - toodooh_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U toodooh -d toodooh_dev']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  toodooh_pgdata:
```

Named volume `toodooh_pgdata` lives in Docker's storage, not the repo —
no `.gitignore` entry needed (architect's "verify the chosen pattern").

### `apps/api/src/db/schema.ts`

```ts
// Drizzle schema for @toodooh/api.
//
// Phase 1a Commit 3 ships this empty — the migration pipeline is proven
// with a tables-free initial migration (CREATE EXTENSION postgis only).
//
// Phase 1b adds the first table here:
//   export const users = pgTable('users', { ... })  // role enum: advertiser | owner | admin | superadmin
// At that point this file likely splits into a db/schema/ folder.
export {};
```

### `apps/api/src/db/client.ts`

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../env.js';
import * as schema from './schema.js';

// postgres.js connects lazily on first query, so importing this module
// does not open a connection.
export const sql = postgres(env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export type DrizzleDb = typeof db;
```

### `apps/api/src/types/fastify.d.ts`

```ts
import type { DrizzleDb } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DrizzleDb;
  }
}
```

### `apps/api/scripts/migrate.ts` (Finding 2 — `scripts/`, console allowed)

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { env } from '../src/env.js';

const run = async (): Promise<void> => {
  const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: 'drizzle' });
    console.info('migrations applied');
  } finally {
    await migrationClient.end();
  }
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migration failed', err);
    process.exit(1);
  });
```

### `apps/api/drizzle.config.ts`

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
```

Reads `process.env.DATABASE_URL` directly (not the app's eager `env`
singleton) so `drizzle-kit` commands don't couple to the app's parse.

### `apps/api/drizzle/0000_initial.sql` (Finding 5 — hand-added SQL)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Produced by `drizzle-kit generate --custom --name initial`, then the
`CREATE EXTENSION` line hand-added. The `meta/_journal.json` +
`meta/0000_snapshot.json` are tool-generated and committed verbatim
(exact bytes determined at execution — the §3 judgment seam).

### `apps/api/src/env.ts` (modified — add DATABASE_URL)

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DATABASE_URL: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema> & {
  LOG_LEVEL: NonNullable<z.infer<typeof EnvSchema>['LOG_LEVEL']>;
};

export const parseEnv = (raw: NodeJS.ProcessEnv): Env => {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const parsed = result.data;
  const logLevel: Env['LOG_LEVEL'] =
    parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'production' ? 'info' : 'debug');
  return { ...parsed, LOG_LEVEL: logLevel };
};

export const env: Env = parseEnv(process.env);
```

### `apps/api/src/routes/health.ts` (modified — db ping)

```ts
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

const responseSchema = {
  type: 'object',
  required: ['status', 'uptime', 'timestamp', 'checks'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    uptime: { type: 'number' },
    timestamp: { type: 'string', format: 'date-time' },
    checks: {
      type: 'object',
      required: ['db'],
      properties: { db: { type: 'string', enum: ['ok', 'error'] } },
    },
  },
} as const;

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', { schema: { response: { 200: responseSchema } } }, async (request) => {
    let dbStatus: 'ok' | 'error' = 'ok';
    try {
      await app.db.execute(sql`select 1`);
    } catch (err) {
      dbStatus = 'error';
      request.log.error({ err }, 'health: db ping failed');
    }
    return {
      status: dbStatus === 'ok' ? ('ok' as const) : ('degraded' as const),
      uptime: Math.round(process.uptime() * 10) / 10,
      timestamp: new Date().toISOString(),
      checks: { db: dbStatus },
    };
  });
};
```

### `apps/api/src/server.ts` (modified — decorate + onClose)

```ts
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { db, sql } from './db/client.js';
import { env } from './env.js';
import { buildErrorHandler, buildNotFoundHandler } from './error-handler.js';
import { buildLoggerConfig } from './logger.js';
import { healthRoute } from './routes/health.js';

const app: FastifyInstance = Fastify({
  logger: buildLoggerConfig(env),
  genReqId: () => randomUUID(),
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'requestId',
});

app.decorate('db', db);
app.addHook('onClose', async () => {
  await sql.end();
});

app.setErrorHandler(buildErrorHandler(env));
app.setNotFoundHandler(buildNotFoundHandler());

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'shutdown signal received');
  try {
    await app.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

const start = async (): Promise<void> => {
  try {
    await app.register(healthRoute);
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
```

### `apps/api/vitest.config.ts` (modified — Finding 3 test env)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The eager env singleton (src/env.ts) parses at import; tests that
    // import it need DATABASE_URL present. Real DB tests mock the client.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
    },
  },
});
```

### `apps/api/tsconfig.test.json` (modified — Finding 2 include scripts + drizzle.config)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": [
    "src/**/*.ts",
    "tests/**/*.ts",
    "scripts/**/*.ts",
    "vitest.config.ts",
    "drizzle.config.ts"
  ]
}
```

### `apps/api/tests/env.test.ts` (modified — Finding 3)

```ts
import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/env.js';

const DB = 'postgresql://test:test@localhost:5432/test_db';

describe('parseEnv', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    const env = parseEnv({ DATABASE_URL: DB });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.DATABASE_URL).toBe(DB);
  });

  it('uses info LOG_LEVEL when NODE_ENV=production', () => {
    const env = parseEnv({ NODE_ENV: 'production', DATABASE_URL: DB });
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects malformed PORT', () => {
    expect(() => parseEnv({ PORT: 'abc', DATABASE_URL: DB })).toThrowError(
      /Invalid environment configuration/,
    );
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });
});
```

### `apps/api/tests/health.test.ts` (modified — ok + degraded)

```ts
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { healthRoute } from '../src/routes/health.js';
import type { DrizzleDb } from '../src/db/client.js';

const buildApp = (execute: () => Promise<unknown>) => {
  const app = Fastify({ logger: false });
  app.decorate('db', { execute } as unknown as DrizzleDb);
  return app;
};

describe('GET /health', () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it('returns 200 ok when db ping succeeds', async () => {
    app = buildApp(async () => [{ '?column?': 1 }]);
    await app.register(healthRoute);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      uptime: number;
      timestamp: string;
      checks: { db: string };
    }>();
    expect(body.status).toBe('ok');
    expect(body.checks.db).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('returns 200 degraded when db ping fails', async () => {
    app = buildApp(async () => {
      throw new Error('db down');
    });
    await app.register(healthRoute);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; checks: { db: string } }>();
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe('error');
  });
});
```

`{ execute } as unknown as DrizzleDb` — the sanctioned `unknown`
double-assertion (CLAUDE.md rule #1) for a test mock; no `any`.

### `apps/api/tests/db.test.ts` (new — schema imports, no connection)

```ts
import { describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema.js';

describe('db schema', () => {
  it('imports without opening a connection', () => {
    expect(schema).toBeDefined();
  });
});
```

### `apps/api/.env.example` (new)

```
DATABASE_URL=postgresql://toodooh:toodooh@localhost:5432/toodooh_dev
NODE_ENV=development
PORT=4000
HOST=0.0.0.0
LOG_LEVEL=debug
```

Gitignored counterpart `.env` is already covered by `apps/api/.gitignore`
(`.env`); `.env.example` is committed (not matched by `.env`).

### `apps/api/package.json` (modified)

```json
{
  "name": "@toodooh/api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit -p tsconfig.test.json",
    "lint": "eslint .",
    "test": "vitest run",
    "migrate": "tsx --env-file-if-exists=.env scripts/migrate.ts",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "drizzle-orm": "0.45.2",
    "fastify": "5.8.5",
    "pino": "10.3.1",
    "pino-pretty": "13.1.3",
    "postgres": "3.4.9",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "20.19.41",
    "drizzle-kit": "0.31.10",
    "tsx": "4.22.3",
    "typescript": "5.7.2",
    "vitest": "4.1.6"
  }
}
```

### `apps/api/README.md` (modified — add first-run section)

Add after the Commands section:

```markdown
## First run (local database)

```bash
# 1. start Postgres + PostGIS
docker compose -f infra/docker-compose.yml up -d postgres

# 2. wait until healthy
docker compose -f infra/docker-compose.yml ps   # STATUS shows "healthy"

# 3. set local env
cp apps/api/.env.example apps/api/.env

# 4. apply migrations (installs the postgis extension)
pnpm --filter @toodooh/api migrate

# 5. run the API
pnpm --filter @toodooh/api dev
```

`GET /health` returns `{ "status": "ok", "checks": { "db": "ok" } }`
when the database is reachable, and `"degraded"` / `"db": "error"`
(still HTTP 200) when it is not.
```

Update the Scope section's Commit-3 line to reflect: Drizzle client +
Postgres (docker) + migration pipeline + `/health` db-ping landed;
Phase 1b begins the users table + better-auth.

---

## §12 — Fire instruction

This is **Commit 3.0** (plan document). Architect: review, focusing on
the eight findings. On approval, commit + push docs-only per §10.
**Halt** until then.

**Watch-items for the architect (decisions needed before 3.1):**

1. **Finding 1 — compose location.** Plan defaults to
   `infra/docker-compose.yml` (CLAUDE.md line 13/15 + handoff §4). Confirm,
   or override to repo-root (which then requires a CLAUDE.md
   permitted-files edit in the same commit).
2. **Finding 2 — migrate location.** Plan uses `apps/api/scripts/migrate.ts`
   (decision #3 + eslint console carve-out), not `src/db/migrate.ts`.
   Confirm.
3. **Finding 3 — vitest env shim** for the eager env singleton + the
   updated env tests. Confirm the approach (vs making `env` lazy).
4. **Finding 4 — shutdown via `onClose` hook** (app.close() then sql.end),
   not "close db before app.close()". Confirm the corrected ordering.
5. **Finding 5 — `drizzle-kit generate --custom`** + hand-added
   `CREATE EXTENSION`. Confirm.
6. **Finding 7 — `--env-file-if-exists`** (no dotenv dep). Confirm, or
   prefer adding `dotenv`.
7. **Test floor 7 → 10** (env 4 + health 2 + error-handler 3 + db 1),
   root 167 → 170. Confirm no additional coverage wanted (per the
   Commit-2 "resist test scope-creep" note).
8. **CF-20 now promotable** (tsconfig split reused with refinement) +
   **CF-21 candidate** (eager-singleton test shim) recorded. Confirm
   promotion of CF-20 at this commit's audit refresh.
