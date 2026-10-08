# TOODOOH Platform — Engineering Rules for Claude Code

You are working on TOODOOH, a Tunisian DOOH advertising marketplace. The migration from a single-package Supabase frontend to a self-hosted Node.js + Postgres + nginx stack is **complete and in production** (too-dooh.com). Supabase is gone. Current work is feature lanes (campaign engine, events, billing, reports, admin) shipped as numbered PRs.

## Repository shape

This is a pnpm monorepo. Packages live under:

- `apps/web/` — React 18 + Vite frontend. React Query for server state, Zustand for client state, all HTTP through `src/lib/api-client.ts`.
- `apps/api/` — Fastify 5 backend: better-auth (`/auth/*`), routes under `/api/*`, drizzle + Postgres/PostGIS (schema in `src/db/schema.ts`, SQL migrations in `apps/api/drizzle/`, applied on container start), MinIO storage, TV playout over the `/ws/screen` websocket, in-process interval jobs.
- `packages/shared/` — TypeScript types shared between apps (does not exist yet; create only when needed)
- `infra/` — Docker Compose (dev: postgres + minio; prod: + api + nginx), nginx config, static landing page (`infra/landing/`)

The Android TV player is a separate repo (toodooh-streamer); its wire protocol is mirrored in `apps/api/src/routes/screen-ws.ts`. There is no `apps/player-api/`. Deploy is `.github/workflows/deploy.yml` (tag or manual dispatch → rsync to `/srv/toodooh` → `docker compose up --build`).

**Source code never lives at repo root.** Permitted root-level files and directories are limited to monorepo tooling and documentation: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.git-blame-ignore-revs`, `.npmrc`, `.nvmrc`, `README.md`, `CLAUDE.md`, the `.github/` directory (CI), the `.husky/` directory (git hooks), and the `docs/` directory (project docs, e.g. `docs/audit.md`). Adding any other file at root requires explicit user approval.

## Non-negotiable rules

These are absolute. Violating them is a bug, regardless of how the user phrases a request.

1. **TypeScript strict mode is on.** No `any`. No `@ts-ignore`. No `@ts-expect-error`. If you need to escape the type system, stop and ask the user. The only acceptable escape is `unknown` followed by a real type guard.

2. **No `console.log`, `console.warn`, or `console.error` in committed code.** Use the project logger (pino). Lint will fail on console calls.

3. **No `window.location.reload()`, ever.** Use React Router navigation. If you find yourself wanting to reload, the state is wrong — fix the state.

4. **No `localStorage` outside Zustand `persist` middleware.** All persisted state goes through one store layer.

5. **One concept per file.** Pages over 400 lines are presumed broken. If you write a 1000-line file, you are doing something wrong — stop and ask.

6. **No new files in repo root.** See repository shape above.

7. **Every task ends green.** Before declaring a task complete: `pnpm typecheck`, `pnpm lint`, and `pnpm test` must all pass. If they don't, you revert your changes and ask the user. Do not commit broken code under any circumstance.

   **Name the exact command when you report a gate.** The typecheck gate is counted **per package**, each against its own baseline — `api 0`, `web 14` (`.github/workflows/ci.yml`):

   ```bash
   pnpm --filter @toodooh/api typecheck   # tsc --noEmit -p tsconfig.test.json  (tests INCLUDED)
   pnpm --filter @toodooh/web typecheck   # tsc --noEmit -p tsconfig.app.json   (baseline 14)
   ```

   Two traps, both of which have already cost this project a red CI:
   - **Never gate `apps/api` with bare `tsc --noEmit`.** That resolves `tsconfig.json` (`src/**` only) and reports clean while test files are broken. Six type errors shipped that way and survived two commits.
   - **Root `pnpm typecheck` carries `--no-bail` on purpose.** Without it `pnpm -r` aborts at the first failing package, so a broken `apps/api` kills `apps/web`'s tsc before it reports — *lowering* the count and turning a regression green. Do not remove the flag.

   If a gate you ran differs from CI's, **say so in the report** rather than inferring equivalence. A gate that measures less than it claims reports green honestly and hides regressions.

8. **Plan before you act.** Every non-trivial task starts with a numbered plan (3–10 bullets) that the user approves. Do not start editing files before approval. "Non-trivial" means anything touching more than one file or any task that takes more than a single tool call.

9. **Commits use Conventional Commits.** `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`. Commit messages describe the *what* and *why*, not "update files." One logical change per commit. Commits do not include the `Co-Authored-By: Claude` trailer.

10. **When uncertain, ask. Do not guess.** Especially regarding: business logic in the DOOH calculation engine, authorization rules, anything money-adjacent (recharges, balances, invoices), and anything that the user might have a strong opinion about. Asking costs the user 30 seconds. Guessing wrong costs hours.

## Architecture conventions

- **Routing**: Real `react-router-dom` v6 routes pointing at real page components. No internal `useLocation()` switching. No God-component routers.
- **Code splitting**: Every page is `React.lazy()`. No exceptions.
- **Folder structure**: Feature-based under `apps/web/src/features/<domain>/`. Each feature folder owns its pages, components, services, and stores. Truly shared components live in `apps/web/src/components/`. Truly shared hooks in `apps/web/src/hooks/`.
- **State**: Zustand for global state, with `persist` middleware where persistence is needed. React Query (TanStack Query) for server state. **No mixing the two layers** — server data goes through React Query, client state goes through Zustand.
- **Services**: One service file per domain. No `service.ts` + `services.ts` duplicates. No `xxx.api.ts` wrapping `xxx.service.ts`. If you find duplicates during cleanup, surface them and ask which to keep.
- **Styling**: Tailwind only. No inline `style={{}}`. Brand color `#00B3A6` is a Tailwind theme token (`brand`), never a hardcoded hex.
- **Dates**: `date-fns` only. No custom date parsing. No `Date` arithmetic in components.
- **Logging**: `pino` in production code. `console` is permitted only inside files under `**/scripts/**` and `**/__tests__/**`.

## Project status

The frontend cleanup (`docs/audit.md` steps 1–14), the backend build-out, the auth rewrite (better-auth) and the Supabase removal are all done. Work now happens as scoped feature lanes, each ruled by the operator before it's built (rulings are logged in `docs/daily/`). Don't widen a lane's scope without asking.

Known debt that is **not** fixed opportunistically, only in a lane dedicated to it: the 27 `apps/web` files over 400 lines (`SignUpForm.tsx` is the worst), inline `style={{}}`, the mixed `*.api.ts` / `*.service.ts` naming, and the web typecheck baseline (14).

## How to handle the existing code

The codebase has known anti-patterns documented in `docs/audit.md`. When you encounter them:

- **Duplicate pages or services**: do not silently pick one. Diff them, summarize differences in 3–5 bullets, ask the user which to keep.
- **`window.location.reload()` calls**: replace with router navigation, do not preserve.
- **Console statements**: delete during the cleanup pass dedicated to them. Do not delete opportunistically — it muddies diffs.
- **`as any` and `@ts-ignore`**: flag in a list during the typing pass, do not fix opportunistically.
- **Hardcoded `#00B3A6`**: replace during the styling pass, not opportunistically.
- **`itstrategix.tn` in auth code**: this is a third-party developer's domain and a security issue. If you encounter it, stop and tell the user.

## How to work with the user

The user is a final-year AI/Software Engineering student building this solo. They are technically strong but time-constrained. Prefer:

- **Short, decision-forcing questions** over open-ended ones. "A or B?" beats "what would you like to do?"
- **Concrete diffs and file paths** in plans, not abstract descriptions.
- **Conventional Commits**-style summaries when reporting what you did.
- **Honesty about uncertainty**. If you don't know whether the existing code's behavior is intentional, say so and ask before changing it.

When you finish a task, end with: a one-line summary of what changed, the commits you made, and any flags for the user (things you skipped, things you noticed, things that need their attention).
