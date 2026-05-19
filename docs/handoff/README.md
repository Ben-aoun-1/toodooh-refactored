# Handoff folder README

> **Note (cleanup-phase exit, 2026-05-19):** this README documents the handoff
> state at project pickup and is preserved as a historical record. The cleanup
> phase is now **complete** — see `docs/audit.md` §10 for the cleanup-phase exit
> state and current project status.

This folder contains everything needed to continue the TOODOOH platform migration from a new Claude project.

## What to read, in order

1. **`00-PROJECT_HANDOFF.md`** — the central context document. Read this first. Covers who I am, what TOODOOH is, why this migration exists, the architecture target, the current state of the repo, what's done, what's next, and how I work.

2. **`02-migration-notes.md`** — source artifact inventory and hostage status. Critical operational context. Tells you what's mine vs. what's contested vs. what's missing. Also documents the unfinished Phase 0 data-extraction work that should happen before backend code is written.

3. **The repo's root `CLAUDE.md`** — engineering rules for Claude Code. Not in this folder; lives at the monorepo root. Authoritative on coding standards, commit conventions, and forbidden patterns.

4. **`03-cleanup-roadmap.md`** — the cleanup plan. _Historical:_ as planned it was a 15-step roadmap; the audit's renumbering consolidated it to **14 rows, all now ☑ (completed 2026-05-19)**. See `docs/audit.md` §5 for the row-by-row status and §10 for the closing summary. Read the rationale for each step, not just the headers — the *why* matters for the *how*.

5. **`01-initial-audit.md`** — the audit I produced at the very beginning of this project, before any cleanup work. Long, detailed, and the foundation everything else rests on. Note: two findings have been corrected by direct inspection — see section 7 of `00-PROJECT_HANDOFF.md`.

## What to reference as needed

**`prompt-archive/`** — every paste-ready prompt I've written for Claude Code, one file per step. Demonstrates the prompt style this project uses: plan-first, approval-gated, surgical scope, explicit constraints, defined "done" state. Read these when writing new prompts to match the established style.

**`step-reports/`** — Claude Code's structured outputs for each completed step. The numerical record of what changed. Read these when you need to know what the current state of the codebase actually is without running commands.

**`current-state/`** — snapshots of key files at handoff time. The current `App.tsx`, the current `apps/web/package.json`, the env var inventory. Lets you see real code without grepping the full repo.

## First message to send when starting

> I'm continuing a project. Read `docs/handoff/00-PROJECT_HANDOFF.md`, then `docs/handoff/02-migration-notes.md`, then the root `CLAUDE.md`, then `docs/handoff/03-cleanup-roadmap.md`. Then tell me what you understand of the current state and what you need clarified before we continue with step 4 (the mechanical lint autofix pass). Don't start writing prompts yet.

## Files I need to assemble myself

Some pieces of this handoff aren't in this folder yet because they live in my own materials. To complete the folder, I need to add:

- **`01-initial-audit.md`** — copy the original `===BEGIN PROMPT===` message from the previous conversation, verbatim, into this file.
- **`prompt-archive/step-1-bootstrap.md`** — the pnpm monorepo bootstrap prompt
- **`prompt-archive/step-2-frontend-copy.md`** — the frontend copy prompt
- **`prompt-archive/step-3-hooks-fix.md`** — the react-hooks/rules-of-hooks fix prompt
- **`prompt-archive/step-4-itstrategix-fix.md`** — the env-driven app URL prompt
- **`prompt-archive/step-5-lazy-routes.md`** — the React.lazy() codemod prompt
- **`prompt-archive/step-6-lint-autofix.md`** — generated and included in this folder; corresponds to the next step (step 4 of the cleanup roadmap)
- **`step-reports/step-1` through `-5`** — copy each structured report Claude Code produced (from terminal scrollback or the previous conversation history)
- **`current-state/App.tsx`** — `cp ~/Desktop/toodooh-platform/apps/web/src/App.tsx docs/handoff/current-state/`
- **`current-state/package.json`** — `cp ~/Desktop/toodooh-platform/apps/web/package.json docs/handoff/current-state/`
- **`current-state/env-vars.md`** — a short doc listing every `VITE_*` env var the frontend references, with a note that `VITE_PUBLIC_APP_URL` falls back to `window.location.origin` when unset
