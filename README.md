# TOODOOH Platform

TOODOOH is a Tunisian DOOH (digital out-of-home) advertising marketplace. This repository
hosts the platform monorepo as it migrates from a single-package Supabase frontend to a
self-hosted Node.js + Postgres + nginx stack.

## Monorepo layout

```
apps/
  web/          React 18 + Vite frontend (existing TOODOOH code lands here)
  api/           Node.js + Fastify backend          (not created yet)
  player-api/    Service for the Android TV APK      (not created yet)
packages/
  shared/        TypeScript types shared across apps (not created yet)
infra/           Docker Compose, nginx, SQL migrations (not created yet)
```

Only monorepo tooling and docs live at the repo root — see `CLAUDE.md` for the rules.

## Local development

Requirements: **Node 20.20.2 exact** (pinned identically in `.nvmrc`, the CI
workflow, and `CLAUDE.md` — keep the three in parity) and **pnpm 9** (pinned via
`packageManager`; `corepack enable` will provision it).

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # run dev servers for every package that defines one
pnpm typecheck      # tsc across all packages
pnpm lint           # eslint across the repo
pnpm test           # tests across all packages
pnpm format         # prettier --write
```

A git pre-commit hook (Husky + lint-staged) runs Prettier and ESLint on staged files.
CI (`.github/workflows/ci.yml`) runs **four gates** on every push and PR — typecheck,
lint, test, build — and is **green on `main`**. Typecheck and lint are _baseline-gated_:
they carry accepted, Phase-1-deferred debt (51 typecheck errors, 1 lint error — both
blocked on the Supabase typed client, issue #15), so CI fails only on a regression
_past_ that committed baseline, not on the baseline itself. See `docs/audit.md` §4
"Step 13" for the mechanism.
