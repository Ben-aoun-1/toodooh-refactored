# @toodooh/api

Marketplace backend for the TOODOOH DOOH platform — Fastify v5 +
TypeScript, Node 20 LTS.

## Commands

```bash
pnpm --filter @toodooh/api dev       # tsx watch on 0.0.0.0:4000
pnpm --filter @toodooh/api build     # tsc → dist/
pnpm --filter @toodooh/api start     # node dist/server.js
pnpm --filter @toodooh/api typecheck
pnpm --filter @toodooh/api lint
pnpm --filter @toodooh/api test
pnpm --filter @toodooh/api migrate     # apply migrations (drizzle-orm)
pnpm --filter @toodooh/api db:generate # generate a migration (drizzle-kit)
```

The `dev` and `migrate` scripts use Node's `--env-file-if-exists=.env`,
so a local `apps/api/.env` is loaded automatically when present (and the
command still runs when it is absent, e.g. with vars supplied via the
shell or CI). Copy `apps/api/.env.example` to `apps/api/.env` for local
development.

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

## Scope

This package is being built up across Phase 1a-1f. As of Phase 1a
Commit 3 (Phase 1a foundation complete):

- Fastify instance, validated env (zod), pino logging, shaped error +
  not-found handlers, `/health` with a DB-ping check.
- Drizzle client over a Dockerized Postgres 16 + PostGIS 3.4, a
  migration pipeline (empty initial migration installs the `postgis`
  extension), and graceful DB shutdown via a Fastify `onClose` hook.
- Phase 1b begins the `users` table + better-auth + the screenhost
  signup endpoint.

See `docs/superpowers/plans/` for the per-commit plans
(`...-commit-1-api-scaffold.md`, `...-commit-2-env-logger-health-errors.md`,
`...-commit-3-drizzle-postgres-docker.md`).
