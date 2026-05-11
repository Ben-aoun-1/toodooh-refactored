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

Requirements: **Node 20 LTS** (`.nvmrc`) and **pnpm 9** (pinned via `packageManager`;
`corepack enable` will provision it).

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # run dev servers for every package that defines one
pnpm typecheck      # tsc across all packages
pnpm lint           # eslint across the repo
pnpm test           # tests across all packages
pnpm format         # prettier --write
```

A git pre-commit hook (Husky + lint-staged) runs Prettier and ESLint on staged files.
CI (`.github/workflows/ci.yml`) runs typecheck, lint and test on every push and PR.
