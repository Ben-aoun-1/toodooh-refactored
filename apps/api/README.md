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
```

## Scope

This package is being built up across Phase 1a-1f. As of Commit 1:

- Fastify instance only, no routes, no logger, no env validation.
- Phase 1a Commit 2 adds env validation (zod) + pino + `/health`.
- Phase 1a Commit 3 adds Drizzle + local Postgres (Docker Compose).
- Phase 1b begins screenhost auth via better-auth.

See `docs/superpowers/plans/2026-05-20-phase-1a-commit-1-api-scaffold.md`
for the scaffold plan.
