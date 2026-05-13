# Step 5 — Console purge + `pino` logger introduction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every `console.*` call from production source under `apps/web/src/` (901 lint-flagged occurrences), introduce a configured `pino` logger module, and re-enable the `no-console` ESLint rule as a hard project-wide error — while preserving every legitimate error-reporting site as a `logger.error` / `logger.warn` call rather than deleting it.

**Architecture:** Six commits. **Commit 0** renumbers the audit-doc roadmap before any code changes, because every subsequent commit message refers to "Step 5" and the audit has it as Step 9 today. **Commit 1** introduces `lib/logger.ts` (pino-backed, dev/prod/test-configured, child-logger pattern) with its own tests. A **pre-flight verification** (no commit) re-confirms Cat 2a / 2b counts on top of Commit 1 before any deletion. **Commit 2** bulk-deletes Category 1 (debug detritus — every `console.log` + `console.info`, ~447 calls). **Commit 3** bulk-deletes Category 2a + 2b (`console.error` followed by `throw` or `toast.*` on the next line — 126 + 68 = 194 calls — the error is already signalled). **Commit 4** promotes Category 2c + 3 (~220 caught-and-continues `console.error` + 33 `console.warn` → `logger.error` / `logger.warn`, with child loggers per module). **Commit 5** re-enables `no-console` as a project-wide ESLint error, refreshes the audit-doc snapshot, and adds a console-free invariant paragraph to `apps/web/src/lib/dooh/README.md`.

**Tech stack:** TypeScript 5.7 strict, Vite, Vitest, pnpm 9 monorepo, ESLint 9 flat config + Husky/lint-staged, `pino` (new dep). Node v20.20.2 (`.nvmrc`).

---

## Conventions for every task in this plan

- **Node:** all commands assume `nvm use` has been run in the shell (reads `.nvmrc` → v20.20.2). If `node --version` is not `v20.20.2`, run `nvm use` first.
- **Commands** (from repo root `~/Desktop/toodooh-platform/`): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @toodooh/web build`.
- **Live baseline** (captured at plan-writing time on `00f7587`):
  - `pnpm typecheck` → exit 2, **179** `error TS…` lines.
  - `pnpm lint` → exit 1, **1618 problems (1591 errors, 27 warnings)**; **901** of those are `no-console` (446 log + 421 error + 33 warn + 1 info).
  - `pnpm test` → exit 0, **5** Test Files pass / **63** tests pass.
  - `pnpm --filter @toodooh/web build` → exit 0, **110** `.js` chunks; main `index-*.js` = **441.88 kB / gzip 128.61 kB**; largest chunk `Dashboard-*.js` = **623.02 kB / gzip 165.56 kB**.
- **Pre-commit hook:** Husky runs lint-staged: `*.{ts,tsx,mts,cts}` → `eslint --fix` + `prettier --write`; `*.{js,cjs,mjs,json,md,yml,yaml,css}` → `prettier --write`. A commit touching a file with non-autofixable lint errors (e.g. pre-existing `console.*` in surrounding code, the 1591 pre-existing TS errors, the 27 jsx-a11y warnings, the 44 `as any`) makes lint-staged exit non-zero → use `git commit --no-verify` for those commits. Per-commit `--no-verify` policy is stated explicitly below.
- **`.prettierignore`** covers `docs/handoff/` and `docs/superpowers/` (so this plan file bypasses prettier) — but **not** `docs/audit.md` and **not** `apps/web/src/lib/dooh/README.md`; those get `prettier --write` on commit.
- **Repo for `gh` commands:** `Ben-aoun-1/toodooh-refactored`.

---

## Post-approval clarifications (authoritative — these win over any stale code block below)

1. **Logger API surface is locked.** Standard pino: `log.{debug,info,warn,error}(msg, ctx?)`. Error objects go in the second argument's `err` field — `logger.error('failed to load user', { err })`, **not** folded into the message string. Module-scoped logging uses child loggers: `const log = logger.child({ module: 'auth.service' })` at the top of each file that imports the logger. The exported root logger is named `logger`; consumers either use it directly (one-off scripts) or create a child. This shape is what Commit 4's ~250 sites get rewritten against.
2. **Bundle ceiling for Commit 1: 8 KB target, 10 KB hard halt.** Measure the gzipped delta of the **main `index-*.js` chunk** between the baseline (128.61 kB gzip) and post-Commit-1 build. If delta > 10 KB → **halt**, swap pino for `loglevel` (`pnpm remove pino && pnpm add loglevel`), update `CLAUDE.md` to note the override (one sentence under the existing "Logging: pino…" rule). The bundle metric is the actual main-chunk gzip line, not `pino`-the-package's bundled size — pino has transitive deps that may or may not tree-shake.
3. **Cat 2a + Cat 2b are mechanically detectable and verified clean.** Re-run on current `main`:
   - `grep -rn -A1 "console\.error" apps/web/src --include="*.ts" --include="*.tsx" --exclude-dir=__tests__ --exclude-dir=scripts | grep -B1 -E "^[^-].*-[[:space:]]*throw" | grep -c "throw"` → **126**
   - same with `toast\.` → **68**
   - 10-sample false-positive check (already done at plan-writing): 0/10 false positives in either. The pre-flight verification block between Commit 1 and Commit 2 re-confirms before deletion fires.
4. **Cat 2b is DELETE, not PROMOTE.** `console.error` followed by `toast.error` gets the console line deleted; the toast is left alone. Rationale: there is no remote log sink yet, so promoting to `logger.error` writes to nowhere. Phase 1 will wire remote sinks deliberately at the toast sites where ops alerts are actually warranted.
5. **No-console rule is re-enabled in Commit 5.** Without this, future code regresses. Re-enable as `error` for `**/*.{ts,tsx}` under `apps/web/src/`, preserving the existing exceptions for `**/scripts/**` and `**/__tests__/**`. The `lib/logger.ts` file itself gets the exception too (it calls `console.*` internally only if pino's browser default writes to console — verify after Commit 1).
6. **Commit 4 — `--no-verify` policy:** try clean first. If lint-staged passes on the files touched in Commit 4, commit *without* `--no-verify`. If it fails (residual unrelated lint issues in surrounding code on the touched files), drop to `--no-verify` and document the specific cause in the commit body.

---

## File structure (what gets created / modified across the whole plan)

**Created:**

- `apps/web/src/lib/logger.ts` — pino logger module + child-logger factory + env-driven config.
- `apps/web/src/lib/logger.test.ts` — instantiation, child-logger context propagation, level configuration tests.

**Modified:**

- (Commit 0) `docs/audit.md` — §5 roadmap rows reordered + Step # column updated; §3 every "→ **Step N · #X**" footer updated; §6 maintenance step refs updated.
- (Commit 1) `apps/web/package.json` — `pino` added as dependency.
- (Commit 1) `apps/web/src/lib/dooh/README.md` — one paragraph documenting the console-free invariant.
- (Commit 2) ~85 files — `console.log` + `console.info` deletions across `apps/web/src/` (excluding `scripts/`, `__tests__/`).
- (Commit 3) ~50 files — `console.error` deletions matching the Cat 2a + 2b mechanical pattern.
- (Commit 4) ~60 files — `console.error` → `logger.error` and `console.warn` → `logger.warn` promotions, plus the `const log = logger.child({ module: '…' })` declaration at the top of each modified file.
- (Commit 5) `eslint.config.js` — re-enable `no-console: 'error'` project-wide; `docs/audit.md` — §2 snapshot row refreshed (lint problem count), §3 `console.*` subsection updated to past tense + count zero, §3 "Debug cruft" subsection updated.

**Unchanged** (verify, but no edits needed): `apps/web/src/lib/dooh/{config,dates,hourly-plan,v3-model}.ts` (console-free by design), `apps/web/src/hooks/**` (zero console calls), `apps/web/src/utils/statementRecipient.ts` (zero), all of `__tests__/`, all of `scripts/`.

---

## Verification gates summary (per-commit target numbers)

| Commit | typecheck (errors) | lint problems  | of which `no-console`     | test files | build chunks | main gzip          |
| ------ | ------------------ | -------------- | ------------------------- | ---------- | ------------ | ------------------ |
| 0      | 179 (unchanged)    | 1618           | 901                       | 5          | 110          | 128.61 kB          |
| 1      | 179                | 1618           | 901                       | **6**      | **111\***    | **≤ 138.61 kB**    |
| 2      | 179                | **≤ 1171**     | **≤ 454**                 | 6          | 111          | 128.61 kB ± 200 B  |
| 3      | 179                | **≤ 977**      | **≤ 260**                 | 6          | 111          | 128.61 kB ± 200 B  |
| 4      | 179                | **= 717**      | **= 0**                   | 6          | 111          | 128.61 kB ± 200 B  |
| 5      | 179                | **= 717**      | **= 0** (rule re-enabled) | 6          | 111          | 128.61 kB ± 200 B  |

\* Chunk count increases by exactly 1 in Commit 1 because pino likely emits a standalone vendor chunk. If it stays at 110 (pino bundled into `index`) or jumps to 112+ (extra transports leaked), halt and investigate.

The "≤" entries are upper bounds; actual numbers may be lower if I undercounted Cat 1 in the inventory. The Commit 4 row is `= 0` because every remaining `console.*` must be promoted or its presence is a bug.

---

# COMMIT 0 — Audit-doc roadmap renumbering

(Docs-only commit. No code touches. Must land before any other Step-5 commit, because Commit-1's commit message references "Step 5" and the audit currently says Step 9.)

## Task 0.1: Propose the renumbering for sign-off

**Files:** none modified yet.

The current audit (`docs/audit.md` §5) has the roadmap ordered for the original cleanup sequence. The proposed re-ordering puts console-purge / typing-pass earlier, with Dashboard/NewCampaign decomposition pushed later (so the mechanical passes don't have to be re-run on the decomposed files). The full mapping:

| New # | Old # | Step                                                       | Issue |
| ----- | ----- | ---------------------------------------------------------- | ----- |
| 1     | 1     | Cleanup audit & roadmap (this doc) ☑                       | —     |
| 2a    | 2a    | Resolve duplicate pages ☑                                  | #1    |
| 2b    | 2b    | Resolve duplicate services ☑                               | #14   |
| 3     | 3     | Consolidate auth-state layer ☑                             | #2    |
| 4     | 4     | DOOH engine decouple + v3.0 pricing IP ☑                   | #12   |
| **5** | **9** | **Frontend logger + `console.*` purge** ← **this plan**    | #7    |
| **6** | 10    | Typing pass: fix `as any`, reduce tsc baseline             | #8    |
| **7** | 5     | Decompose `Dashboard.tsx` / `NewCampaign.tsx`              | #3    |
| 8     | 6     | Restructure `src/` into `src/features/<domain>/`           | #4    |
| 9     | 7     | Replace `window.location.reload()` in `MyAccount.tsx`      | #5    |
| 10    | 8     | Introduce React Query for server state                     | #6    |
| 11    | 11    | `jsx-a11y` + `exhaustive-deps` cleanup                     | #9    |
| 12    | 12    | Tailwind `brand` token: replace hardcoded `#00B3A6`        | #10   |
| 13    | 13    | Get CI green                                               | #11   |
| 14    | 14    | Hoist duplicate devDependencies to root                    | #13   |

**Rationale for the new ordering:**

- **Old 9 + 10 → New 5 + 6 (move earlier).** Console-purge and typing-pass are mechanical sweeps over the entire frontend. Doing them BEFORE Dashboard/NewCampaign decomposition means the sweeps run once on the current file shape, not twice (once now, once after the decomposed files exist). Diffs in Step 7 (decomp) stay clean and reviewable because the mechanical noise is gone.
- **Old 5 → New 7 (move later, but only +2 places).** Dashboard decomposition is the largest single piece of work in the roadmap; doing it on a codebase that has been mechanically cleaned + typed is strictly easier than doing it on the current mess.
- **Old 6, 7, 8 → New 8, 9, 10 (cascade-shifted +2).** Folder restructure, `window.location.reload`, React Query slot in after decomposition.
- **Old 11, 12, 13, 14 → unchanged.** Late mechanical passes + CI / devDeps are unchanged in spirit AND in number; only old 5–10 shuffle.

**Why no separate "decomposition discovery" roadmap step.** Every step in this roadmap follows a brainstorm → spec → plan → execute cycle (see Step 4's discovery, plan, and execution as the recent precedent). The brainstorm has never been a separate roadmap entry — it's part of the step's planning phase. Decomposition is large but not categorically larger than e.g. the v3.0 IP work in Step 4: both touch substantial code, both benefit from a careful discovery report before plan-writing. Treating decomp's brainstorm as a separate roadmap row would be inconsistent with prior practice; treating it as part of new-Step-7's planning is the consistent choice. The discovery report happens; it just doesn't get a roadmap number.

**Sign-off:** Before any audit edits, the executor pastes this mapping table back to the prompt-writer for explicit "go." If the prompt-writer revises the mapping, the executor updates this section and re-asks.

## Task 0.2: Apply the renumbering to `docs/audit.md`

Once the mapping is signed off, edits:

- [ ] **§5 Roadmap table** (`docs/audit.md` lines ~309-326): rewrite the rows in the new order with the new `#` column. The `Status` column stays the same — Steps 1, 2a, 2b, 3, 4 are still `☑`. Renumber Steps 5-10 per the mapping above (Steps 11-14 keep their current numbers). The `Issue` column stays the same — issue numbers do NOT change, only step numbers do.
- [ ] **§3 anti-pattern inventory footers** — every "→ **Step N · #X**" line gets updated. Lines below reference current audit line numbers; verify against the file before editing:
  - Line 59 (`Dashboard.tsx` god-component): `Step 5 · #3` → `Step 7 · #3`
  - Line 98 (Duplicate pages): `Step 2a · #1 · Step 5 · #3 · Step 6 · #4` → `Step 2a · #1 · Step 7 · #3 · Step 8 · #4`
  - Line 138 (Duplicate services): `Step 2b · #14 · Step 6 · #4` → `Step 2b · #14 · Step 8 · #4`
  - Line 182 (DOOH): `Step 4 · #12` — unchanged.
  - Line 218 (Auth-state): `Step 3 · #2 · Step 5 · #3` → `Step 3 · #2 · Step 7 · #3`
  - Line 224 (`console.*`): `Step 9 · #7` → **`Step 5 · #7`**.
  - Line 229 (`as any`): `Step 10 · #8` → **`Step 6 · #8`**.
  - Line 238 (localStorage): `Step 5 · #3` → `Step 7 · #3`
  - Line 243 (`window.location.reload`): `Step 7 · #5` → `Step 9 · #5`
  - Line 247 (Hardcoded `#00B3A6`): `Step 12 · #10` — **unchanged**.
  - Line 253 (jsx-a11y / exhaustive-deps): `Step 11 · #9` — **unchanged**.
  - Line 258 (Flat folder structure): `Step 6 · #4` → `Step 8 · #4`
  - Line 263 (No server-state layer): `Step 8 · #6` → `Step 10 · #6`
  - Line 270 (Debug cruft): `Step 9 · #7` → `Step 5 · #7`
  - Line 276 (`tsconfig` softening): `Step 10 · #8` → `Step 6 · #8`
  - Line 283 (Duplicate devDeps): `Step 14 · #13` — **unchanged**.
- [ ] **§3 inline prose mentions of step numbers** — every "Step N" in flowing prose:
  - Lines 70-87 (the Duplicate pages section's prose): "Step 5" mentions → "Step 7" (where they refer to Dashboard decomposition).
  - Lines 94-95: "Step 5 (`/owner-campaigns` … overlaps …)" → "Step 7 (…)"; "Step 6 (folder/route …)" → "Step 8 (folder/route …)".
  - Line 117: "Step 5/Step 6 concern" → "Step 7/Step 8 concern".
  - Line 206: "Step 6 concern" → "Step 8 concern".
- [ ] **§2 Snapshot row** — line 46 references "Step 13" for CI green; **unchanged** (CI green stays at Step 13). Verify by eye.
- [ ] **§3 `console.*` subsection** (lines 220-224) — keep the text describing the current 938/917 state for now (Commit 5 refreshes it to "purged in Step 5"). Only the footer's step number changes here.
- [ ] **§4 Already resolved** — verify any "Step N" references. (Likely Steps 1, 2a, 2b, 3, 4 already-done sections; no renumbering needed there.)
- [ ] **§6 Maintenance** — verify any step refs and update.

**Verification gate (Commit 0):**

- [ ] `pnpm typecheck` → exit 2, 179 errors (unchanged — no source touched).
- [ ] `pnpm lint` → 1618 problems (unchanged).
- [ ] `pnpm test` → 5 files, 63 tests (unchanged).
- [ ] `pnpm --filter @toodooh/web build` → 110 chunks, main gzip 128.61 kB (unchanged).
- [ ] `grep -E "Step [0-9]+" docs/audit.md` reviewed by eye — no stale numbers remain.

**Commit:**

```
docs(audit): renumber roadmap — console purge → Step 5, typing → Step 6, decomp → Step 7

Reorder the cleanup roadmap so mechanical sweeps (console-purge, typing pass)
land BEFORE the Dashboard/NewCampaign decomposition. Doing the sweeps on the
current file shape means they run once; doing them after decomposition would
re-run them on 10+ new files with shared patterns.

Six rows move (old 5/6/7/8/9/10 shuffle); four rows unchanged (11-14).
Issue numbers (#1-#14) do NOT change; only step numbers move. Every "Step N"
reference in §3 and §6 updated to the new mapping.
```

**`--no-verify` policy:** NO. Docs-only; prettier will auto-format `docs/audit.md` cleanly.

---

# COMMIT 1 — `pino` logger module + dev/prod/test config

## Task 1.1: Add `pino` as a dependency

**Files:**

- Modify: `apps/web/package.json`

- [ ] **Step 1: install pino** in the web app:
  ```bash
  cd apps/web && pnpm add pino
  ```
  This adds `pino` to `dependencies` (NOT `devDependencies` — the logger is shipped to production). Do NOT add `pino-pretty` — pino's browser default writes to `console.{log,info,warn,error}` directly, which is exactly what we want; `pino-pretty` is Node-only and would never run in the Vite bundle.

- [ ] **Step 2: verify lockfile.** `pnpm install` from the repo root re-locks; commit the updated `pnpm-lock.yaml`. Do not edit the lockfile by hand.

## Task 1.2: Create `apps/web/src/lib/logger.ts`

**Files:**

- Create: `apps/web/src/lib/logger.ts`

- [ ] **Step 1: write the module.** Exact content:

```ts
/**
 * Frontend logger — pino-backed.
 *
 * Pure: no I/O at module load (just configuration). All log output goes through
 * pino's browser shim, which by default writes to `console.{log,info,warn,error}`
 * — so this module satisfies the `no-console` ESLint rule by routing every log
 * call through a single point rather than scattering raw console statements.
 *
 * Levels by environment:
 *   - test (`import.meta.env.MODE === 'test'`) → silent (no output during vitest)
 *   - dev  (`import.meta.env.DEV`)             → debug
 *   - prod (else)                              → info
 *
 * Module-scoped usage (preferred):
 *
 *   const log = logger.child({ module: 'auth.service' });
 *   log.error('failed to load profile', { err, userId });
 *
 * Error objects go in the second argument (the context object) under `err`, not
 * folded into the message string — pino's serialisers extract `err.message` /
 * `err.stack` automatically.
 *
 * This file is the ONLY place `console.*` is permitted in production source
 * (via pino's browser shim, indirectly). Lint exempts this path explicitly.
 */

import pino, { type Logger } from 'pino';

const isTest = import.meta.env.MODE === 'test';
const isDev = import.meta.env.DEV;

const level: pino.LevelWithSilent = isTest ? 'silent' : isDev ? 'debug' : 'info';

export const logger: Logger = pino({
  level,
  browser: {
    asObject: false,
  },
});

export type { Logger };
```

  Notes on shape:
  - `asObject: false` keeps log lines as readable strings in the browser console (e.g. `'INFO: user loaded'`) rather than serialised JSON objects, which would be opaque in DevTools. Phase 1 (with a remote sink) will likely flip this to `true`.
  - No `transmit` config — Phase 1's remote-sink wiring goes here, but not now.
  - No custom serialisers — pino's defaults handle `err`.

- [ ] **Step 2: confirm import-time purity.** `apps/web/src/lib/logger.ts` must have zero side effects beyond constructing the logger. No `console.*` at top level, no fetches, no `window` access, no `Date.now()`. Same invariant as `lib/dooh/*`.

## Task 1.3: Create `apps/web/src/lib/logger.test.ts`

**Files:**

- Create: `apps/web/src/lib/logger.test.ts`

- [ ] **Step 1: write the test.** Exact content:

```ts
import { describe, it, expect } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
  it('exposes pino-shaped level methods', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('is silent in test mode', () => {
    expect(logger.level).toBe('silent');
  });

  it('creates child loggers that inherit level and add bindings', () => {
    const child = logger.child({ module: 'unit-test' });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
    expect(child.level).toBe('silent');
  });

  it('child logger bindings persist across calls', () => {
    const child = logger.child({ module: 'unit-test' });
    const grandchild = child.child({ requestId: 'abc' });
    expect(grandchild.level).toBe('silent');
    expect(typeof grandchild.warn).toBe('function');
  });

  it('does not throw when called with structured context', () => {
    const child = logger.child({ module: 'unit-test' });
    expect(() => child.error('test error', { err: new Error('boom'), id: 1 })).not.toThrow();
  });
});
```

- [ ] **Step 2: run the test.** `pnpm test` → expect 6 Test Files passing / 68 tests passing (5 new tests added).

## Task 1.4: Add console-free invariant paragraph to `apps/web/src/lib/dooh/README.md`

**Files:**

- Modify: `apps/web/src/lib/dooh/README.md`

- [ ] **Step 1: add the paragraph.** Insert after the existing "Assumptions" section (after the bullet list ending around line 84), as a new section titled "Logging stance":

```markdown
## Logging stance

`lib/dooh/*` never uses `console.*` or `logger.*` itself. Errors propagate via
thrown `Error` (e.g. `clampSpotSeconds` would throw on a non-finite input —
not in practice today because the wizard validates first, but the type
boundary is clean). Structured logging happens at the caller — services that
wire these functions into the app log at *their* boundary, not from inside the
math. When this module moves to `apps/api/` in Phase 1, that pattern is
unchanged: the math is pure, the caller logs.
```

## Task 1.5: Verify pino does not leak `pino-pretty` or transport code into the browser bundle

**Files:** none modified.

- [ ] **Step 1: build and inspect.**
  ```bash
  pnpm --filter @toodooh/web build
  ```
- [ ] **Step 2: check for transport leaks.**
  ```bash
  grep -rl "pino-pretty\|pino/file\|pino-syslog\|sonic-boom" apps/web/dist/assets/
  ```
  → expected empty. If any match: halt, investigate, likely a Vite resolve issue.
- [ ] **Step 3: check chunk count and main gzip.**
  ```bash
  ls apps/web/dist/assets/*.js | wc -l
  ```
  → expect **111** (baseline 110 + 1 for the pino vendor chunk; if pino is bundled into `index` it stays 110, which is also fine — note which case in the commit message).
  Main `index-*.js` gzip from the build output → expect **≤ 138.61 kB** (baseline 128.61 + 10 KB hard halt). Target ≤ 136.61 kB (baseline + 8 KB).

**HALT CONDITIONS for Task 1.5:**

- If main gzip > 138.61 kB → halt. Swap to `loglevel`:
  ```bash
  cd apps/web && pnpm remove pino && pnpm add loglevel
  ```
  Rewrite `lib/logger.ts` to use loglevel (simpler API: `log.debug/info/warn/error`, no child-logger first-class, no JSON output). Re-run Task 1.4. Add one sentence to `CLAUDE.md` under the "Logging" rule: "*Note: pino's browser bundle exceeded the 10 KB budget; loglevel is the fallback. Phase-1 backend still uses pino.*"
- If main gzip > 136.61 kB but ≤ 138.61 kB → soft warning, proceed but flag in commit body.
- If chunk count ≠ 110 and ≠ 111 → halt, investigate (a transport leaked or pino's deps fragmented unexpectedly).
- If any `pino-pretty` / `sonic-boom` / etc. matches in `dist/` → halt, investigate.

**Verification gate (Commit 1):**

- [ ] `pnpm typecheck` → 179 errors (unchanged).
- [ ] `pnpm lint` → 1618 problems (unchanged — `lib/logger.ts` is lint-clean; no new `no-console` from it).
- [ ] `pnpm test` → **6** Test Files pass, **68** tests pass.
- [ ] `pnpm --filter @toodooh/web build` → 110 or 111 chunks; main `index-*.js` gzip ≤ 138.61 kB; no `pino-pretty` in `dist/`.

**Commit:**

```
feat(logging): pino logger module + dev/prod/test config

Add apps/web/src/lib/logger.ts (pino-backed, level by env, child-logger
factory) with its own tests, plus pino as a production dependency. The
module is pure: no side effects at import, no console.* at top level,
no module-level state. Phase-1 will pivot to a remote sink via pino's
`transmit` config; for now the browser default (writes to console.{log,
info,warn,error}) is the sink.

Bundle delta: main index-*.js gzip 128.61 → <NEW> kB (target +8, hard
halt +10). Chunk count 110 → <NEW> (pino either bundles into index or
emits one vendor chunk; both are fine).

Add a "Logging stance" paragraph to lib/dooh/README.md documenting that
the v3.0 IP never logs internally — callers log at their boundary, math
is pure. Same pattern will hold when lib/dooh/ moves to apps/api/.
```

**`--no-verify` policy:** NO. New files only (`lib/logger.ts`, `lib/logger.test.ts`); the lib/dooh/README.md edit is one paragraph; package.json is auto-formatted.

---

# PRE-FLIGHT VERIFICATION (no commit, runs between Commit 1 and Commit 2)

## Task PF.1: Re-verify Cat 2a count on top of Commit 1

- [ ] Run:
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" -A1 "console\.error" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts \
    | grep -B1 -E "^[^-].*-[[:space:]]*throw" | grep -c "throw"
  ```
- [ ] Expected: **126**. Tolerance: ±3. If drift > 3 → halt, recount, report to prompt-writer.

## Task PF.2: Re-verify Cat 2b count on top of Commit 1

- [ ] Run:
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" -A1 "console\.error" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts \
    | grep -B1 -E "^[^-].*-[[:space:]]*toast\." | grep -c "toast"
  ```
- [ ] Expected: **68**. Tolerance: ±3. If drift > 3 → halt.

## Task PF.3: Sample 10 Cat 2a matches; spot-check for false positives

- [ ] Run:
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" -A1 "console\.error" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts \
    | grep -B1 -E "^[^-].*-[[:space:]]*throw" | shuf | head -30
  ```
  (Without `shuf` if unavailable: just `head -30`. Read 10 distinct match pairs.)
- [ ] For each match, read the file at the cited line range. Verify:
  - The `console.error` and the `throw` are in the same `try`/`catch` block or guard, not separated by other statements.
  - The `throw` references an `Error` that carries the relevant context (i.e. the throw IS the signal, not the console).
  - The `console.error` does NOT have any side effect beyond emitting (no `error.recoveryHook(); console.error(...); throw`).
- [ ] Halt threshold: > 3/10 false positives → halt, reclassify, report to prompt-writer.

## Task PF.4: Sample 10 Cat 2b matches; spot-check for false positives

Same procedure as PF.3, replacing `throw` with `toast\.`. Halt threshold > 3/10.

## Task PF.5: Report

- [ ] Paste back: Cat 2a count, Cat 2b count, false-positive sample results (line refs of any false positives flagged), proceed/halt decision. Prompt-writer reviews before Commit 2 fires.

---

# COMMIT 2 — Bulk-delete Category 1 (debug detritus: every `console.log` + `console.info`)

## Task 2.1: Delete all `console.log` calls

**Files:** ~85 source files across `apps/web/src/` (excluding `scripts/`, `__tests__/`, `lib/logger.ts`).

- [ ] **Step 1: enumerate.**
  ```bash
  grep -rln --include="*.ts" --include="*.tsx" "console\.log" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts | wc -l
  ```
  → record file count (should be ~85).
- [ ] **Step 2: delete in two passes — single-line and multi-line.**

  **Pass A — single-line `console.log` (~95% of cases).** A line that matches:
  ```
  ^\s*console\.log\([^;]*\);\s*$
  ```
  is a complete statement on its own line. Delete the entire line.

  **Pass B — multi-line `console.log` (e.g. `console.log({ ... });` split across lines).** A `console.log(` opener without a closing `)` on the same line. Delete from the opener line through the line containing the matching closing `);`, inclusive.

  These can be done with a script (preferred) or by hand per file. If by hand: process top-down to keep line numbers stable. If by script: it MUST handle both passes; suggested approach is a small Node script using `@babel/parser` to find `ExpressionStatement` nodes whose expression is `CallExpression` with `callee.object.name === 'console'` and `callee.property.name === 'log'`, and delete those nodes' source ranges. Plain-text regex deletion is brittle for multi-line case — prefer AST.

- [ ] **Step 3: delete the 1 `console.info` call.** Find it:
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" "console\.info" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts
  ```
  Delete the line(s) the same way as Pass A or B above.

- [ ] **Step 4: verify count drop.**
  ```bash
  pnpm lint 2>&1 | grep -c "no-console"
  ```
  → expect **≤ 454** (= 901 − 446 − 1; allowance for ±10 if Pass B missed a few multi-liners).

- [ ] **Step 5: re-grep for stragglers.**
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" "console\.\(log\|info\)" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts
  ```
  → expect zero matches. If any remain: fix by hand, re-verify, repeat.

## Task 2.2: Test that nothing visible to the user broke

- [ ] **Step 1:** `pnpm typecheck` → expect 179 errors (unchanged; deletions don't change types).
- [ ] **Step 2:** `pnpm test` → expect 6 Test Files / 68 tests pass.
- [ ] **Step 3:** `pnpm --filter @toodooh/web build` → expect 110 or 111 chunks; main gzip within ±200 B of post-Commit-1 value.
- [ ] **Step 4:** spot-check in dev with `pnpm --filter @toodooh/web dev` — open the app, navigate to Dashboard → NewCampaign → Cart → MyInvoices. Browser console should be quiet (no errors, no warnings from the app code itself — third-party libs may still log). Compare against pre-Commit-2 dev console (which was flooded with emoji debug output) — should be a night-and-day difference.

**Verification gate (Commit 2):**

- [ ] `pnpm typecheck` → 179 errors.
- [ ] `pnpm lint` → ≤ 1171 problems; `no-console` count ≤ 454.
- [ ] `pnpm test` → 6 files / 68 tests.
- [ ] `pnpm build` → 110 or 111 chunks; gzip ±200 B.
- [ ] Manual spot-check passes (dev console quiet).

**Commit:**

```
refactor(logging): purge Category-1 console debug detritus (~447 calls)

Delete every console.log + console.info call across apps/web/src/ (excluding
scripts/ and __tests__/). These were pure debug traces — emoji-prefixed
progress/state-inspection lines a developer added and never removed.
Nothing in this commit promotes anything to logger; that comes in Commit 4.

Verified: no test breaks (pre-existing tests don't assert on console);
no UI behavior changes (the calls had no side effects beyond emitting).
Lint no-console count: 901 → <NEW>.
```

**`--no-verify` policy:** YES. The commit touches ~85 files, most of which have other pre-existing lint errors (jsx-a11y, TS errors); lint-staged would either fail or try to autofix surrounding code, creating cascade noise. Use `--no-verify` and verify cleanliness via the gate above.

---

# COMMIT 3 — Bulk-delete Category 2a + 2b (`console.error` followed by `throw` / `toast.*`)

## Task 3.1: Delete Cat 2a — `console.error` followed by `throw` on the next line

**Files:** ~50 source files.

- [ ] **Step 1: enumerate.** Re-run the PF.1 grep on top of Commit 2 — count must still be 126 (Commit 2 only deleted `console.log` / `console.info`, not `console.error`).

- [ ] **Step 2: delete via script.** Suggested approach (AST-based, more reliable than regex):
  - Walk every `.ts` / `.tsx` file under `apps/web/src/` (excluding `__tests__/`, `scripts/`, `lib/logger.ts`).
  - Find every `ExpressionStatement` whose expression is `console.error(...)`.
  - Check the immediately-following AST node in the same block. If it's:
    - a `ThrowStatement`, OR
    - an `IfStatement` whose body starts with a `ThrowStatement`, OR
    - a `ReturnStatement` (some cases combine error+return, NOT in Cat 2a — leave these for Commit 4),
  - then delete the `console.error` statement.
  - Specifically: only delete if the very next non-comment, non-whitespace statement is a `ThrowStatement` directly (not nested).
  - If by hand: process files in reverse line order to preserve line numbers, or process top-down and recompute line numbers.

- [ ] **Step 3: verify count.** Re-run PF.1 grep — expect **0** matches (or close to 0; allow ±3 for edge cases — comments / nested blocks).

## Task 3.2: Delete Cat 2b — `console.error` followed by `toast.*` on the next line

**Files:** ~40 source files.

- [ ] **Step 1: enumerate.** Re-run PF.2 grep — count must still be 68.
- [ ] **Step 2: delete via script.** Same AST approach as Task 3.1, but match on next-statement being:
  - `ExpressionStatement` of `toast.error(...)` / `toast.success(...)` / `toast(...)` / `toast.warn(...)`, OR
  - same wrapped in a try/finally / if-guard where the toast is the immediate next statement.
- [ ] **Step 3: verify.** Re-run PF.2 grep — expect 0 matches (±3).

## Task 3.3: Run tests and build

- [ ] `pnpm typecheck` → 179 errors (unchanged — deletions don't change types).
- [ ] `pnpm test` → 6 files / 68 tests.
- [ ] `pnpm --filter @toodooh/web build` → 110/111 chunks; gzip ±200 B.

## Task 3.4: Manual smoke test — does error UX still work?

This is the highest-risk commit because Cat 2b deletion removes the dev-time error log that paired with a user-facing toast. If we mis-classified, the user gets a toast but the developer has nothing to debug against — except this is mitigated by Commit 4 (Cat 2c promotion adds `logger.error` for non-toast paths, and the toast still tells the user).

- [ ] **Step 1:** `pnpm --filter @toodooh/web dev`.
- [ ] **Step 2:** trigger a known error path — e.g. try to log in with a wrong password, try to upload an invalid CIN doc in Onboarding, try to load a deleted campaign by URL. Toast should appear, browser console should be quiet (no console.error from us; the underlying fetch may still 401 in DevTools Network — that's fine).
- [ ] **Step 3:** if anything looks broken (toast doesn't appear, UI crashes), halt — likely the deletion accidentally removed a non-console-error line via a script bug. Revert with `git checkout -- .`, fix the script, retry.

**Verification gate (Commit 3):**

- [ ] `pnpm typecheck` → 179 errors.
- [ ] `pnpm lint` → ≤ 977 problems; `no-console` count ≤ 260.
- [ ] `pnpm test` → 6 files / 68 tests.
- [ ] `pnpm build` → 110/111 chunks; gzip ±200 B.
- [ ] Smoke test passes (toasts appear, no crashes).

**Commit:**

```
refactor(logging): purge Category-2 console.error redundancies (~194 calls)

Delete every console.error followed on the next line by `throw` (126 calls)
or by `toast.*` (68 calls). In both patterns, the error is already signalled
elsewhere — the throw propagates, the toast informs the user. The console
line was dev-time inspection that became permanent.

Verified mechanically (grep) before and after; manually smoke-tested error
paths (toast still appears, no UI crashes). Lint no-console: <prev> → <NEW>.

Category 2c (~220 caught-and-continues console.error without throw or toast)
is left for Commit 4, which promotes them to logger.error.
```

**`--no-verify` policy:** YES. Same reasoning as Commit 2.

---

# COMMIT 4 — Promote Category 2c + 3 (`console.error` + `console.warn` → `logger.*`)

## Task 4.1: Enumerate remaining `console.error` and `console.warn`

**Files:** ~60 source files.

- [ ] **Step 1: count remaining.**
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" "console\.error" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts | wc -l
  ```
  → expect ~220 (= 421 − 126 − 68 − any miscategorisation drift).
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" "console\.warn" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts | wc -l
  ```
  → expect 33.
- [ ] **Step 2: per-file inventory.** Produce a sorted list of `{file, console.error count, console.warn count}` for every file with non-zero remaining calls. This is the work plan for the per-file pass.

## Task 4.2: For each file, add the child-logger import + declaration

**Files:** ~60 source files.

- [ ] **Step 1: per file**, add at the top (after the last `import`):
  ```ts
  import { logger } from '@/lib/logger';
  const log = logger.child({ module: '<relative-path-without-extension>' });
  ```
  For `apps/web/src/services/auth.service.ts`, the binding is `module: 'services/auth.service'`. For a page `apps/web/src/pages/Dashboard.tsx`, it's `module: 'pages/Dashboard'`. Same pattern as the v3.0 simulator-fixture naming (predictable mapping from path).

  If the file does NOT have an `@/`-prefixed import yet, check `vite.config.ts` / `tsconfig.app.json` for the alias — TOODOOH uses `@/` for `apps/web/src/`. If for some reason the alias is missing in this file's path, use the relative path (`../lib/logger`).

- [ ] **Step 2: skip files that have only `console.warn` and 0 `console.error`** if there's any awkwardness; warns can still use the child-logger but verify the import added correctly.

## Task 4.3: Replace `console.error` calls with `log.error`

- [ ] **Step 1: per file, per call**, transform:
  ```ts
  console.error('failed to load X:', err);
  ```
  →
  ```ts
  log.error('failed to load X', { err });
  ```

  Rules:
  - Drop emoji prefixes (`❌`, `🔴`, etc.) from the message — they were dev-time visual markers; structured logs don't need them.
  - Move `Error` objects from second positional argument to `{ err }` in a context object.
  - Move identifier arguments (`userId`, `campaignId`, etc.) into the context object: `console.error('msg:', userId)` → `log.error('msg', { userId })`.
  - Where the original was a multi-argument log like `console.error('A', x, 'B', y)`, fold into a single message + context: `log.error('A B', { x, y })`.
  - When the original message ends with a colon (`'foo:'`), drop the colon — pino renders context separately, the colon is leftover from string concatenation.

- [ ] **Step 2: edge cases:**
  - `console.error(error)` (single Error arg, no message) → `log.error('error', { err: error })`. The bare Error case loses semantic info; flag in the commit body and prompt-writer review.
  - `console.error(JSON.stringify(err, null, 2))` — pino serialises errors natively, so this becomes `log.error('error details', { err })`. Drop the manual JSON.
  - `componentDidCatch(error, info)` in error boundaries — `log.error('react error boundary', { err: error, componentStack: info.componentStack })`.

## Task 4.4: Replace `console.warn` calls with `log.warn`

Same transformation rules as Task 4.3, but the call name is `log.warn`. There are 33 of these, all legitimate fallback warnings — no judgement calls expected. Spot-check each one to verify the message remains informative after rewriting.

## Task 4.5: Verification — every `console.*` is gone

- [ ] **Step 1:** zero remaining `console.error`:
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" "console\.error" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts --exclude="lib/logger.ts"
  ```
  → expect zero.
- [ ] **Step 2:** zero remaining `console.warn`:
  ```bash
  grep -rn --include="*.ts" --include="*.tsx" "console\.warn" apps/web/src \
    --exclude-dir=__tests__ --exclude-dir=scripts --exclude="lib/logger.ts"
  ```
  → expect zero.
- [ ] **Step 3:** lint no-console count:
  ```bash
  pnpm lint 2>&1 | grep -c "no-console"
  ```
  → expect **0**.

## Task 4.6: Tests + build

- [ ] **Step 1:** `pnpm typecheck` → 179 errors (unchanged; the imports + child-logger declarations are type-safe; only file-level imports + line-level call rewrites changed).
- [ ] **Step 2:** `pnpm test` → 6 files / 68 tests pass.
- [ ] **Step 3:** `pnpm --filter @toodooh/web build` → 110 or 111 chunks; main gzip within ±300 B of post-Commit-3 (small drift expected because ~60 new imports of `@/lib/logger` may add a few bytes; pino itself is already bundled from Commit 1, so the marginal cost is the new top-level child-logger calls).

**Verification gate (Commit 4):**

- [ ] `pnpm typecheck` → 179 errors.
- [ ] `pnpm lint` → expect **717** problems (= 1618 − 901); `no-console` count = **0**.
- [ ] `pnpm test` → 6 files / 68 tests.
- [ ] `pnpm build` → 110/111 chunks; gzip ±300 B.
- [ ] Spot-check in dev: trigger an error path, observe `log.error` output in browser console (pino's browser shim writes to `console.error`, so it shows up there as expected — but routed through pino, structured with the `module` binding visible).

**Commit:**

```
refactor(logging): promote remaining console.error/warn to logger (~253 calls)

Per-file promotion of console.error → log.error and console.warn → log.warn
across ~60 files. Each touched file gets an `import { logger } from '@/lib/logger'`
and a `const log = logger.child({ module: <path> })` at the top; every call
site rewritten to pino's structured form (message + context object).

Lint no-console: <prev> → 0. The console.* purge is complete in source; the
ESLint rule re-enable for project-wide enforcement is Commit 5.
```

**`--no-verify` policy:** try **NO** first. If lint-staged passes on every touched file (it might, because most no-console errors are gone from the file before this commit's edits land), proceed clean. If it fails on a residual issue in a touched file (pre-existing jsx-a11y warning, pre-existing `as any`, etc.), drop to `--no-verify` and document the specific cause in the commit body.

---

# COMMIT 5 — Re-enable `no-console` ESLint rule + refresh audit-doc snapshot

## Task 5.1: Re-enable `no-console` project-wide in ESLint config

**Files:**

- Modify: `eslint.config.js` (repo-root)

- [ ] **Step 1: read `eslint.config.js`** to find the current `no-console` rule. Today the rule is either disabled, set to `warn` for source, or has exceptions for `**/scripts/**` and `**/__tests__/**`.

- [ ] **Step 2: set it to `'error'` for all `**/*.{ts,tsx}` under `apps/web/src/`**, with exceptions kept for:
  - `**/scripts/**` (build scripts may need console)
  - `**/__tests__/**` (test setup may need console)
  - `**/*.test.{ts,tsx}` (test files themselves)
  - `apps/web/src/lib/logger.ts` (the only file allowed to wrap console; if pino's browser shim doesn't actually trigger this lint rule, the exception is moot but harmless).

  Example shape (verify against actual `eslint.config.js`):
  ```js
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['**/scripts/**', '**/__tests__/**', '**/*.test.{ts,tsx}', 'apps/web/src/lib/logger.ts'],
    rules: {
      'no-console': 'error',
    },
  }
  ```

- [ ] **Step 3: verify.**
  ```bash
  pnpm lint 2>&1 | grep -c "no-console"
  ```
  → expect **0**. If it reports any: the rule re-enable surfaced a missed `console.*`. Fix by hand (promote or delete per Commits 2-4 rules), re-verify.

## Task 5.2: Refresh `docs/audit.md` snapshot

**Files:**

- Modify: `docs/audit.md`

- [ ] **Step 1: §2 Snapshot row** — update the `pnpm lint` row to reflect the post-Step-5 numbers. Was something like `~1618 problems (1591 errors, 27 warnings)`; new value is **717 problems** (1591 − 901 errors removed + warnings unchanged = 690 errors + 27 warnings = 717).
- [ ] **Step 2: §3 `console.*` subsection** (lines ~220-224) — rewrite to past tense:
  ```
  ### `console.*`
  
  Purged in Step 5. The frontend logger is `apps/web/src/lib/logger.ts` (pino-backed,
  child-logger pattern). 0 lint-flagged `console.*` calls remain in production source;
  `no-console` ESLint rule is enabled as an error project-wide (except `scripts/`,
  `__tests__/`, test files, and `lib/logger.ts` itself).
  → **Step 5 · #7** ☑
  ```
- [ ] **Step 3: §3 "Debug cruft" subsection** (lines ~265-270) — update the post-Step-3 paragraph to also note that the emoji `console.log`s in `auth.service.ts` / `auth.store.ts` are gone (Step 5). Update the footer to `→ **Step 5 · #7** ☑`.
- [ ] **Step 4: §4 Already resolved** — add a Step 5 row at the bottom describing what landed:
  ```
  ### Step 5 — Frontend logger + console.* purge

  Pino logger module landed at `apps/web/src/lib/logger.ts` with dev/prod/test
  config. 901 `console.*` calls removed/promoted across ~60 files. `no-console`
  ESLint rule re-enabled as an error. → Issue #7.
  ```
- [ ] **Step 5: §5 Roadmap row 5** — mark `Status` as `☑`, leave the rest.

## Task 5.3: Close GitHub issue #7

- [ ] **Step 1:** verify issue #7 is open:
  ```bash
  gh issue view 7 --repo Ben-aoun-1/toodooh-refactored
  ```
- [ ] **Step 2:** update the issue body with the link to the merged commit(s) and the final lint number.
- [ ] **Step 3:** close it:
  ```bash
  gh issue close 7 --repo Ben-aoun-1/toodooh-refactored --comment "Done in Step 5 — see commits <list>. 901 console.* → 0; pino logger landed; no-console rule re-enabled."
  ```

## Task 5.4: Final verification

**Verification gate (Commit 5):**

- [ ] `pnpm typecheck` → 179 errors (unchanged — no source code edits in this commit, only `eslint.config.js` + docs).
- [ ] `pnpm lint` → **717** problems (= 1618 baseline − 901 no-console), no `no-console` reports.
- [ ] `pnpm test` → 6 files / 68 tests.
- [ ] `pnpm --filter @toodooh/web build` → 110/111 chunks; gzip unchanged from Commit 4 (no source touched).
- [ ] `gh issue view 7` → closed.

**Commit:**

```
chore(logging): re-enable no-console ESLint rule + audit snapshot refresh

Set `no-console: 'error'` project-wide for apps/web/src/**/*.{ts,tsx} with
the standard exceptions (scripts/, __tests__/, *.test files, lib/logger.ts
itself). Lint is now 717 problems (down from 1618), 0 of which are no-console.

Refresh docs/audit.md §2 snapshot, §3 console.* subsection (past tense), §3
Debug-cruft subsection, §4 add a Step 5 "Already resolved" entry, §5 mark
Step 5 as ☑.

Closes #7.
```

**`--no-verify` policy:** NO. `eslint.config.js` + `docs/audit.md` only; both lint-staged-friendly.

---

## Key design points to sign off on

These are the explicit decisions in this plan; if the prompt-writer disagrees with any, push back before plan archival:

1. **Six commits, in this order**: 0 renumber → 1 logger → 2 Cat 1 → 3 Cat 2a+2b → 4 Cat 2c+3 → 5 ESLint + docs. Commit 0 is mandatory before any other; Commits 2/3/4 could in theory be combined but the diff would be unreviewable.
2. **Renumbering mapping** as in Task 0.1 — console-purge → **Step 5**, typing-pass → **Step 6**, Dashboard decomp → **Step 7**, folder restructure → **Step 8**, `window.location.reload` → **Step 9**, React Query → **Step 10**. Steps 11–14 unchanged. No separate "decomposition discovery" roadmap row — decomp's brainstorm is part of Step 7's planning (consistent with every prior step's brainstorm→spec→plan→execute cycle).
3. **Cat 2b = DELETE not PROMOTE.** Already approved; reiterated here so it survives review.
4. **Logger API: pino default shape**, child-logger per module, error in context object's `err` field. Locked before Commit 4 fires.
5. **Bundle ceiling 8 KB target / 10 KB hard halt** for Commit 1. loglevel is the documented fallback if pino exceeds.
6. **Commit 4 `--no-verify` policy: try clean first.** Halt and document if it fails for non-obvious reasons.
7. **Issue #7 is closed in Commit 5**, not earlier — keeps the issue alive as the umbrella tracker until the last piece (ESLint rule re-enable) lands.

---

## Cross-references

- `apps/web/src/lib/dooh/README.md` — receives the "Logging stance" paragraph in Commit 1 (Task 1.4). Documents that `lib/dooh/*` itself never logs; callers log.
- `CLAUDE.md` — only edited if the pino fallback to loglevel triggers (Task 1.5 halt condition). One sentence under the "Logging: pino…" rule.
- `docs/handoff/04-how-to-write-prompts.md` — already documents the "capture live baselines" pattern that this plan's verification gates follow. No edits needed.
- `docs/audit.md` — Commit 0 renumbers; Commit 5 refreshes snapshot. Both edits are explicit in their respective tasks.

---

## Risks (recap for the executor)

These were surfaced in the discovery report; they are restated here so the executor can read this plan stand-alone:

1. **Silent loss of real error reporting** — mitigated by the mechanical pattern (only delete `console.error` followed by `throw` or `toast.*`; never delete a `console.error` alone). Pre-flight verification + post-commit smoke test catches it if it happens.
2. **Pino bundle exceeds the 10 KB ceiling** — mitigated by Commit 1's halt condition; loglevel is the documented fallback.
3. **`console.error+throw` pattern misses a richer message than the Error carries** — mitigated by spot-check during Task PF.3 and Task 3.1; if the console message is richer, fold the detail into `new Error(...)` before deleting the console.
4. **Re-running the purge after decomposition would double the work** — mitigated by this plan's existence (Commit 0 reorders so this lands BEFORE decomposition).
5. **Pino-pretty / sonic-boom leaks into the browser bundle** — mitigated by Task 1.5's grep check on `dist/`.

---

**End of plan.** Awaiting prompt-writer approval before any commit fires.
