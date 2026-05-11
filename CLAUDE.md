# TOODOOH Platform — Engineering Rules for Claude Code

You are working on TOODOOH, a Tunisian DOOH advertising marketplace. This repository is being migrated from a fragile single-package frontend on Supabase to a self-hosted Node.js + Postgres + nginx stack. The current phase is **cleanup and restructuring of the existing frontend**. Backend work has NOT started.

## Repository shape

This is a pnpm monorepo. Packages live under:

- `apps/web/` — React 18 + Vite frontend (currently the only app; existing TOODOOH code lives here)
- `apps/api/` — Node.js + Fastify backend (does not exist yet; do not create until told)
- `apps/player-api/` — Node.js service for the Android TV APK (does not exist yet)
- `packages/shared/` — TypeScript types shared between apps (created as needed)
- `infra/` — Docker Compose, nginx config, SQL migrations (created as needed)

**Source code never lives at repo root.** Permitted root-level files and directories are limited to monorepo tooling and documentation: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.npmrc`, `.nvmrc`, `README.md`, `CLAUDE.md`, the `.github/` directory (CI), and the `.husky/` directory (git hooks). Adding any other file at root requires explicit user approval.

## Non-negotiable rules

These are absolute. Violating them is a bug, regardless of how the user phrases a request.

1. **TypeScript strict mode is on.** No `any`. No `@ts-ignore`. No `@ts-expect-error`. If you need to escape the type system, stop and ask the user. The only acceptable escape is `unknown` followed by a real type guard.

2. **No `console.log`, `console.warn`, or `console.error` in committed code.** Use the project logger (pino). Lint will fail on console calls.

3. **No `window.location.reload()`, ever.** Use React Router navigation. If you find yourself wanting to reload, the state is wrong — fix the state.

4. **No `localStorage` outside Zustand `persist` middleware.** All persisted state goes through one store layer.

5. **One concept per file.** Pages over 400 lines are presumed broken. If you write a 1000-line file, you are doing something wrong — stop and ask.

6. **No new files in repo root.** See repository shape above.

7. **Every task ends green.** Before declaring a task complete: `pnpm typecheck`, `pnpm lint`, and `pnpm test` must all pass. If they don't, you revert your changes and ask the user. Do not commit broken code under any circumstance.

8. **Plan before you act.** Every non-trivial task starts with a numbered plan (3–10 bullets) that the user approves. Do not start editing files before approval. "Non-trivial" means anything touching more than one file or any task that takes more than a single tool call.

9. **Commits use Conventional Commits.** `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`. Commit messages describe the *what* and *why*, not "update files." One logical change per commit.

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

## What this phase is and isn't

**This phase IS**: cleaning up the existing frontend codebase — deleting dead code, consolidating duplicate services, restructuring folders, replacing the God-component router, collapsing dual auth stores, adding tooling and CI. The goal is a frontend that the *next* phases (backend migration, auth rewrite) can build on.

**This phase IS NOT**: rewriting the backend, replacing Supabase, redesigning the UI, decomposing `NewCampaign.tsx` (that's a later, scoped task), or fixing the TV/APK side. If the user asks you to do something in those categories during this phase, remind them of the phase scope and ask whether they want to expand it.

## How to handle the existing code

The codebase has known anti-patterns documented separately (see `docs/audit.md` once created). When you encounter them during cleanup:

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
