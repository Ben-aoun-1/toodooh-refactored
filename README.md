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
pnpm typecheck      # tsc across all packages (--no-bail: every package is reported)
pnpm lint           # eslint across the repo
pnpm test           # tests across all packages
pnpm format         # prettier --write
```

### The typecheck gate — exact commands

`pnpm typecheck` fans out to each package's own `typecheck` script. **The two
projects differ, and the difference is load-bearing:**

```bash
pnpm --filter @toodooh/api typecheck   # tsc --noEmit -p tsconfig.test.json  (tests INCLUDED)
pnpm --filter @toodooh/web typecheck   # tsc --noEmit -p tsconfig.app.json
```

Run bare `tsc --noEmit` in `apps/api` and you get the **source-only** project
(`tsconfig.json`), which reports clean while test files are broken — that blind
spot hid six type errors for two commits. Always use the package script.

The root script carries `--no-bail` deliberately. Without it, `pnpm -r` aborts at
the first failing package, so a broken `apps/api` kills `apps/web`'s tsc before it
reports — which _lowers_ the error count. Do not remove the flag.

A git pre-commit hook (Husky + lint-staged) runs Prettier and ESLint on staged files.
CI (`.github/workflows/ci.yml`) runs **four gates** on every push and PR — typecheck,
lint, test, build — and is **green on `main`**. Typecheck and lint are _baseline-gated_:
CI fails only on a regression _past_ the committed baseline, not on the baseline
itself. Typecheck is counted **per package** against its own baseline — currently
**api 0** (hold it there) and **web 14** (react-leaflet, file-saver, the dooh engine;
they clear with the Supabase typed client, issue #15). Lint's baseline is **0**.
See `docs/audit.md` §4 "Step 13" for the original mechanism and the Typecheck step
in `ci.yml` for why the count is per package.
