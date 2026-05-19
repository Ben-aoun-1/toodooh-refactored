# Phase 1a Commit 1 — `apps/api/` scaffold

First commit of Phase-1 backend foundation, vertical-slice 1 (screenhost
signin/signup). Plan-document scope: the package skeleton (Fastify v5,
TypeScript strict, tsx-driven dev), workspace registration, and four
verification gates. No routes, no logger, no env validation, no DB, no
auth — those land in Phase 1a Commits 2 + 3 and Phase 1b respectively.

This is the first Phase-1 commit and the first time `apps/api/` touches
the repo. Halt-on-finding bias is high.

---

## §0 — Pre-flight verification

**Working tree state.** Branch `main`, clean, up to date with
`origin/main` at `cfd4168` (the P0b closeout). `git status` reports
"nothing to commit, working tree clean".

**Repo baseline gates at HEAD `cfd4168` (CF-10, re-baselined plan-time).**
This is the floor Commit 1 must not regress.

| Gate                                  | Count                                        | Source                                                              |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm typecheck`                      | **51 errors** (all Cat-A, in `@toodooh/web`) | `pnpm typecheck` re-run plan-time; matches audit §2 snapshot         |
| `pnpm lint`                           | **1 error** (`import-x/no-unresolved` in `apps/web/src/lib/supabase.ts:3`) | `pnpm lint` re-run plan-time; matches audit §2                       |
| `pnpm test`                           | **21 suites pass, 160 tests, 0 failures**    | `pnpm test` re-run plan-time; matches audit §2                       |
| `pnpm build` (main `index-*.js` gzip) | **139.80 kB**                                | `pnpm build` re-run plan-time; matches audit §2 (`139.80` post-Step-12) |

All four gates re-baselined plan-time. No drift from the post-Step-14
snapshot (audit §2 commit `3db8aec` → current `cfd4168`; P0a + P0b were
docs-only and code metrics held). Phase 1's CI also exists (Step 13) and
is gating on the same four-gate set with baselines `TYPECHECK_BASELINE=51`
/ `LINT_BASELINE=1`.

**Node version on the operating machine.** Default `node` is v24; the
repo pins `engines.node >=20 <21`. Per the methodology Part 4 (and
project memory `pnpm-via-corepack`), every gate command prepends
`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`. The
verification gates in §4 below assume this PATH.

**Confirmed absent.** `apps/api/` does not exist. `ls apps/` shows only
`web/`. `find . -name api -maxdepth 3` (excluding `node_modules` and
`.git`) returns no hits. No collision; no pre-existing residue to merge
with. (CF-18: assume inherited residue — sweep performed, none found.)

**Workspace glob.** `pnpm-workspace.yaml` declares `apps/*` and
`packages/*`. A new `apps/api/` directory with a `package.json` is
auto-picked-up on `pnpm install`; no workspace-file edit required.

---

## §1 — Locked constraints

**In-scope for Commit 1 (this plan):**

1. `apps/api/package.json` — name `@toodooh/api`, private, type module,
   scripts `dev` / `build` / `start` / `typecheck` / `lint` / `test`,
   dependencies on Fastify, devDependencies on TypeScript / tsx /
   `@types/node`.
2. `apps/api/tsconfig.json` — strict, NodeNext module + moduleResolution
   (overrides the bundler resolution from `tsconfig.base.json`), outDir
   `dist`, rootDir `src`, target ES2022, lib ES2023.
3. `apps/api/src/server.ts` — minimal Fastify v5 instance, no routes,
   listens on `0.0.0.0:4000`, graceful shutdown on SIGINT/SIGTERM. No
   logger config (Fastify default off; pino arrives Commit 2).
4. `apps/api/.gitignore` — `dist/`, `node_modules/`, `.env`, `.env.local`.
5. `apps/api/README.md` — 5–10 lines: purpose, dev/build/start commands,
   port, the Commit 2 + 3 placeholder note.
6. `pnpm-lock.yaml` — regenerated on `pnpm install` from repo root.

**Out-of-scope, deferred (do not include):**

- `/health` endpoint or any other route → **Phase 1a Commit 2**.
- pino, env validation, zod, dotenv, error handlers → **Phase 1a Commit 2**.
- Drizzle, postgres-js, any DB code, docker-compose, migrations →
  **Phase 1a Commit 3**.
- better-auth, sessions, screenhost auth, schema → **Phase 1b**.
- Frontend changes, API client wiring → **Phase 1f**.
- `packages/shared/` — defer until cross-app types emerge (no shared
  surface exists yet; YAGNI).
- `apps/player-api/` — Phase 1 later track (out of this slice).

**Pinned versions (plan-time, exact pins where the architect specified):**

| Package        | Version    | Pin style | Why                                                                                       |
| -------------- | ---------- | --------- | ----------------------------------------------------------------------------------------- |
| `fastify`      | `5.8.5`    | exact     | Latest stable v5 at plan time. Pin exact for first-commit reproducibility.                |
| `typescript`   | `5.7.2`    | exact     | Per architect instruction: "PIN EXACT to root's 5.7.2, no caret". Prevents drift from root's `^5.7.2` (which currently resolves to `5.9.3`). |
| `tsx`          | `4.22.3`   | exact     | Latest stable v4 at plan time. Pin exact for first-commit reproducibility.                |
| `@types/node`  | `20.19.41` | exact     | Latest within the v20 LTS line — matches the Node 20.20.2 runtime exactly. Greenfield discipline: aligning types to runtime eliminates the foot-gun where v22-only API surfaces would type-check but fail at runtime. Supersedes the initial "v22 latest" call (architect lock-1, 2026-05-20). |

Engines policy: `apps/api/package.json` inherits the root `engines.node`
constraint via `pnpm install` workspace policy — the field is **not**
re-declared on the sub-package (avoids drift if the root pin moves).

---

## §2 — Inventory phase

### §2.1 — Root configs that affect `apps/api/`

**`eslint.config.js` scoping — PROCEED (no halt).**
Read in full plan-time. Findings:

- The frontend-only plugins (`react-hooks`, `unused-imports`) are scoped
  to `apps/web/**/*.{ts,tsx}` (line 55). Comment at line 52-53 explicitly
  anticipates this: _"scoped to the web app only; backend packages don't
  need React rules and will get their own tsconfig later."_
- `jsx-a11y` is in the flat-config sequence (line 20) repo-wide, but its
  rules only fire on JSX/TSX nodes — a backend `.ts` file produces no
  JSX, so the rules don't trigger. No-op for `apps/api/`.
- `import-x/resolver-next` for TypeScript is scoped to `apps/web/**`
  (line 55) and points at `apps/web/tsconfig.app.json` (line 60). It
  does **not** apply to backend imports; backend imports get the default
  `import-x` resolver, which resolves CommonJS-style + node_modules
  correctly.
- `no-console: error` is **global** (line 31). Applies to `apps/api/`
  source. This matches CLAUDE.md non-negotiable rule #2 ("no console.*
  in committed code; use pino"). pino arrives Commit 2; in the
  meantime Commit 1's `server.ts` contains no console calls (Fastify's
  default logger is off in this commit; the only output is from Fastify's
  internal startup which does not call `console`).
- The scripts/tests carve-out at line 84-93 turns `no-console` off in
  `**/scripts/**`, `**/__tests__/**`, `**/*.test.{ts,tsx,js,jsx}`,
  `**/*.config.{js,ts,mjs,cjs}`. Commit 1 doesn't add any scripts or
  tests; this is forward-compatible.

**Conclusion:** No `0.5` pre-commit (root config scoping fix) is needed.
The config is already prepared for backend packages.

**`tsconfig.base.json` — must override two settings for backend.**
Read in full plan-time. Base settings include `module: "ESNext"`,
`moduleResolution: "Bundler"`. Both are bundler-mode (Vite) settings.
For a Node-runtime backend they must be overridden:

- `module: "NodeNext"` (or `"Node16"` — NodeNext preferred, matches
  Node 20 LTS ESM behaviour).
- `moduleResolution: "NodeNext"` to match.
- `allowImportingTsExtensions: false` (default) — tsc emits real .js so
  imports use `.js` extensions per NodeNext ESM rules. tsx (the dev
  runner) tolerates extensionless imports.
- `verbatimModuleSyntax: true` (inherited from base, **kept on**) — base
  sets it; apps/web softened it for the cleanup phase (`tsconfig.app.json`
  line 39), but new code in `apps/api/` starts disciplined.
- `noUncheckedIndexedAccess: true` (inherited, kept on).
- `noPropertyAccessFromIndexSignature: true` (inherited, kept on).

Apps/web's `tsconfig.app.json` is the precedent — it `extends` the base
and overrides bundler-mode settings + temporarily softens three strict
flags. Apps/api follows the same extension pattern but does NOT soften
the strict flags (new code, no inherited residue justifying a softener).

**`.prettierrc` + `.prettierignore`.** Prettier config standard
(`semi: true, singleQuote, trailingComma: all, tabWidth: 2,
printWidth: 100`). `.prettierignore` does **not** exclude `apps/api/`;
new files auto-format on commit via the lint-staged hook.

**`.husky/pre-commit` + `package.json` lint-staged.** Hook content:
single line `pnpm lint-staged`. Lint-staged globs (root `package.json`):
- `*.{ts,tsx,mts,cts}` → `eslint --fix` + `prettier --write`
- `*.{js,cjs,mjs,json,md,yml,yaml,css}` → `prettier --write`

Both globs match `apps/api/` files transparently. No hook edit required.

**`apps/web/package.json` scripts (precedent for the scripts block).**
- `dev`: `vite`
- `build`: `vite build`
- `lint`: `eslint .`
- `test`: `vitest run`
- `typecheck`: `tsc --noEmit -p tsconfig.app.json`

Apps/api scripts follow the same naming, with backend-appropriate
implementations (`tsx watch` for dev, `tsc` for build, `node dist/server.js`
for start, plain `tsc --noEmit` for typecheck, `eslint .` for lint,
`echo` for test until Commit 2 adds a real test runner).

### §2.2 — Workspace registration mechanics

`pnpm install` from repo root, with a `package.json` under `apps/api/`,
adds `@toodooh/api` to the workspace automatically (via `apps/*` glob).
Verification: `pnpm -r ls --depth -1` should show `@toodooh/api`
alongside `@toodooh/web`. Failure mode if silent: package missing from
the listing — surface as a HARD-HALT (§6).

### §2.3 — Resolved version inventory (plan-time, 2026-05-20)

| Package        | Resolved   | Notes                                                                                |
| -------------- | ---------- | ------------------------------------------------------------------------------------ |
| `fastify`      | `5.8.5`    | `npm view fastify version` → 5.8.5                                                   |
| `typescript`   | `5.7.2`    | Architect-mandated exact pin. Root `^5.7.2` currently resolves to 5.9.3 — apps/api isolates. |
| `tsx`          | `4.22.3`   | `npm view tsx version` → 4.22.3                                                      |
| `@types/node`  | `20.19.41` | `npm view '@types/node@20'` → 20.19.41 (latest v20 LTS patch; matches Node 20.20.2 runtime exactly per architect lock-1). |

---

## §3 — Commit factoring

This plan covers **Commit 1.0 + Commit 1.1**. Phase 1a's full sequence
(reference for context, not in scope of this plan):

| Commit  | Scope                                                                                        |
| ------- | -------------------------------------------------------------------------------------------- |
| **1.0** | **Plan document** (this file). Halt; architect approves; commit + push (docs-only).            |
| **1.1** | **Scaffold:** `apps/api/{package.json,tsconfig.json,src/server.ts,.gitignore,README.md}` + `pnpm-lock.yaml`. Halt; CF-9 pause summary; architect approves; commit + push. |
| 2       | Env validation (zod), pino logger, `/health` route, error handler. Separate plan.            |
| 3       | Drizzle config, local Postgres via Docker Compose, migration runner. Separate plan.          |

Commit factoring rationale: 1.0 lands the plan only (docs commit, no code
state change; reviewable on its own per CF-6). 1.1 lands the scaffold
atomically (package.json + lock + source). Splitting 1.1 further (e.g.
package.json before tsconfig before server.ts) creates intermediate
states that don't typecheck or boot — worse than atomic.

Mechanical-vs-judgment: Commit 1.1 is **mechanical** (deterministic
file creation from a fixed template; per-commit verification is "did
the four gates pass and did Fastify boot on 4000?"). No judgment calls
expected during execution.

---

## §4 — Per-commit verification gates

Four gates for Commit 1.1, all must pass before push. Boot verification
is the new fifth gate specific to this commit (not part of the
standing four-gate set, but required for first-time package proof).

### Gate 1 — Workspace registration

```bash
pnpm -r ls --depth -1
```

**Expected output (relevant lines):**

```
@toodooh/api@0.0.0 /home/benaoun/Desktop/toodooh-platform/apps/api
@toodooh/web@0.0.0 /home/benaoun/Desktop/toodooh-platform/apps/web
```

If `@toodooh/api` is missing → HARD-HALT (§6).

### Gate 2 — Per-package gates (greenfield floor)

`apps/api` is greenfield. Per-package counts are **floor = 0** for
both typecheck and lint. Any non-zero count from `@toodooh/api` is a
regression at the per-package level **even if root-level totals stay
flat** (the regression would be hidden by the unchanged apps/web 51 /
1 numbers; the per-package filter exposes it). This is greenfield
discipline locked by the architect (lock-2, 2026-05-20).

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

pnpm --filter @toodooh/api typecheck       # expect: exit 0, 0 errors (greenfield floor)
pnpm --filter @toodooh/api lint            # expect: exit 0, 0 errors (greenfield floor)
pnpm --filter @toodooh/api build           # expect: exit 0; apps/api/dist/server.js exists; no size target yet
pnpm --filter @toodooh/api test            # expect: exit 0 (placeholder echo until Commit 2); 0 failures if any tests run
```

| Filter gate            | Floor      | Note                                                  |
| ---------------------- | ---------- | ----------------------------------------------------- |
| typecheck (apps/api)   | **0**      | Greenfield — any error fails the gate                 |
| lint (apps/api)        | **0**      | Greenfield — any error fails the gate                 |
| test (apps/api)        | **0 or N, 0 failures** | Placeholder echo until Commit 2 adds vitest |
| build (apps/api)       | **success**, no specific bundle target yet | `dist/server.js` must exist |

### Gate 3 — Root no-regression (against cfd4168 baseline)

Root-level totals must hold exactly; the cleanup-phase floor must not
move. Both Gate 2 (per-package floor) and Gate 3 (root no-regression)
must pass — they are complementary, not substitutable.

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

pnpm typecheck   # expect: 51 errors (all @toodooh/web, Cat-A — unchanged from §0)
pnpm lint        # expect: 1 problem (1 error, 0 warnings — @toodooh/web import-x/no-unresolved, unchanged)
pnpm test        # expect: 21 suites, 160 tests, 0 failures — unchanged
pnpm build       # expect: main index-BPl-L7SH.js gzip 139.80 kB ±0.5 kB
```

| Root gate  | Floor (cfd4168)                                  |
| ---------- | ------------------------------------------------ |
| typecheck  | **51** (all @toodooh/web)                        |
| lint       | **1** (all @toodooh/web)                         |
| test       | **160** passing, 0 failures                      |
| build      | main `index-BPl-L7SH.js` gzip **139.80 kB ±0.5** |

Apps/api adds **no** typecheck or lint errors at root level. Apps/web's
bundle is untouched (the build script runs per-package; apps/api's
`build` only emits to `apps/api/dist/`).

### Gate 4 — Boot verification

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

# Terminal A:
pnpm --filter @toodooh/api dev
# Expect: process starts, server listens on 0.0.0.0:4000, no errors

# Terminal B:
curl -i http://localhost:4000/
# Expect: HTTP/1.1 404 Not Found (Fastify default — no routes registered)
# Body: {"message":"Route GET:/ not found","error":"Not Found","statusCode":404}

# Terminal A: send SIGINT (Ctrl-C)
# Expect: process exits cleanly within 2s, exit code 0
```

The 404 response **proves** the server is up; the absence of routes is
the deliberate scope of Commit 1. The graceful-shutdown timing (2s) is
the SLO; longer indicates a stuck connection or handler.

### Gate 5 — CI on push (post-push)

Per Step-13 methodology: after pushing Commit 1.1 to `main`, watch CI
via `gh run watch` against the push's headSha. CI runs the four-gate set
(`typecheck`, `lint`, `test`, `build`) repo-wide and gates against
`TYPECHECK_BASELINE=51` / `LINT_BASELINE=1`. CI green is the final seal.

---

## §5 — Standing operating procedure

- **CF-7 push flow (code).** Local commit → gate sweep → CF-9 pause
  summary → architect approves push → `git push origin main` →
  `gh run watch` against the new headSha → CI green confirmation.
- **CF-6 push flow (docs).** Commit 1.0 is a docs commit. Push immediately
  after architect approves; no gate sweep required (docs don't move
  gates). Still `gh run watch` to confirm CI ignores docs paths
  correctly.
- **Node PATH prefix.** Every gate command and every git commit prefixes
  the PATH export. The husky/lint-staged hook on commit requires Node
  20.x; default v24 will reject.
- **CF-18 sweep before file creation.** Already performed (§0 confirmed
  `apps/api/` absent). Re-verify with `ls apps/api/ 2>/dev/null` before
  the first Write — should return empty.
- **CF-10 drift check at session start.** Already performed (§0
  re-baselined the four gates plan-time).

---

## §6 — Hard-halt conditions

The executor halts and surfaces (does not work around) on any of:

1. **`apps/api/` exists in any form** before Commit 1.1 starts. Sweep
   immediately after PATH export, before any Write.
2. **Workspace registration silently fails** — `pnpm -r ls` after
   `pnpm install` does not list `@toodooh/api`. Investigate
   `pnpm-workspace.yaml`, the `name:` field, and `private: true` before
   working around.
3. **TypeScript version drift detected** — installed `@toodooh/api`'s
   `typescript` resolves to anything other than `5.7.2`. Means the pin
   in `package.json` was caret-escaped, or pnpm hoisted root's 5.9.3
   over the local pin. Verify with
   `pnpm --filter @toodooh/api list typescript --depth 0`.
4. **`@types/node` major drift** — anything outside the `20.x` line.
5. **Boot verification fails** — port 4000 in use, Fastify import error,
   tsx watcher crash. Do not chase symptoms; surface and resolve before
   pushing.
6. **Husky pre-commit hook errors on the new files** — likely Node
   version on PATH; verify PATH export before retrying. If a real
   lint/typecheck error surfaces, fix the source (do not bypass with
   `--no-verify`).
7. **Any of Gates 1–4 fails or any root gate regresses** vs §0
   baseline.
8. **Inventory finding mid-execution** — anything not anticipated in
   §2 (e.g., an unforeseen plugin firing on apps/api/ files, an unknown
   tsconfig inheritance issue). Halt → CF-9 → architect decides.

---

## §7 — Risk register

| Risk                                                                                       | Likelihood | Surface                                                                  | Mitigation                                                                          |
| ------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **ESLint repo-wide rule fires on `apps/api/` files** (e.g., the `import-x/order` global)  | Low        | Gate 2 (`pnpm --filter @toodooh/api lint`) fails                          | Fix imports per rule; rules are not React-specific and apply uniformly. Acceptable. |
| **`@types/node@20` drifts to a 20.x patch with regressions vs current LTS line**           | Very low   | Gate 2 (`pnpm --filter @toodooh/api typecheck`) catches                  | Exact pin to `20.19.41` matches the v20 runtime; type surface tracks LTS releases.       |
| **pnpm hoists root's `typescript@5.9.3` into apps/api despite exact pin**                  | Low        | Gate 6 (§6.3 drift check) catches                                        | Use exact-pin (no caret). If pnpm still hoists, add `.pnpmfile.cjs` override (defer). |
| **husky/lint-staged hook fires on the new files and rejects due to ESLint rule drift**     | Low        | Commit fails                                                             | Run `pnpm lint --filter @toodooh/api` before staging; fix any issues.               |
| **Apps/web build bundle moves ≥0.5 kB** (Gate 3 violation)                                 | Very low   | Gate 3 (`pnpm build`) shows bundle delta                                 | apps/api code is workspace-isolated; no apps/web import path touches it. If delta surfaces, investigate before pushing. |
| **`pnpm install` regenerates lockfile in unexpected ways** (e.g., updates apps/web deps)   | Low        | `git diff pnpm-lock.yaml` shows non-apps/api changes                     | Inspect lock diff; if apps/web deps moved, surface in CF-9 and decide whether to revert with `pnpm install --frozen-lockfile` strategy. |
| **`tsx` v4.22.3 has a breaking change vs v4.x docs**                                       | Very low   | Gate 4 (boot) fails                                                      | Use `tsx watch src/server.ts` (the stable v4 invocation).                           |
| **Port 4000 already in use on the operating machine**                                      | Medium     | Gate 4 (boot) fails with EADDRINUSE                                      | Check with `lsof -i:4000` before boot. If occupied, surface for port reassignment — but port choice is locked by the architect, do not unilaterally change. |

---

## §8 — Cross-references

- **Audit row.** No existing roadmap row (cleanup phase complete). Phase 1
  entry is `docs/audit.md` §10 (entry conditions met).
- **Target architecture.** `docs/handoff/00-PROJECT_HANDOFF.md` §4 —
  Fastify v5, TypeScript strict, pnpm workspaces. `apps/api/` is the
  marketplace backend; `apps/player-api/` is the separate APK service
  (out of this slice).
- **Methodology.** `docs/handoff/methodology-and-prompt-format.md` —
  plan-first, inventory-first, halt-on-finding, CF-9 pause summaries,
  per-commit four-gate verification.
- **CF-18 reference.** `docs/handoff/cf-18-source-target-axis.md` —
  applied here as the sweep for inherited residue (§0 confirmation of
  apps/api absence).
- **Prior plans (format precedent).** `docs/superpowers/plans/2026-05-19-step-14-devdep-hoist.md`,
  `docs/superpowers/plans/2026-05-19-step-13-ci-green.md`.

---

## §9 — Carry-forward methodology

**Applied CFs:**

- **CF-9** — Commit 1.1's pause summary must surface: plan filename,
  ESLint scoping finding, exact resolved versions for the four pinned
  packages, `server.ts` content verbatim, `package.json` scripts block
  verbatim, `tsconfig.json` verbatim, `pnpm-lock.yaml` diff line count,
  Gate 1–4 results (exit codes + counts), boot verification (boot
  timestamp, curl response, shutdown timestamp), deviations from this
  plan with reasoning, full list of touched files.
- **CF-10** — Re-baselined the four gates plan-time at §0. The audit's
  post-Step-14 counts (typecheck 51, lint 1, test 160, build 139.80 kB)
  hold at `cfd4168`; no drift across P0a + P0b docs commits.
- **CF-18** — Swept for residue: apps/api/ absent, no inherited file
  collision. Three-axis check: Axis 1 (neighborhood) clean — no
  `apps/server/`, `apps/backend/`, `apps/marketplace-api/` either.
  Axis 2 (representation) clean — no package named `@toodooh/api` in
  root devDeps or apps/web deps. Axis 3 (source/target) clean — this is
  greenfield; no source-state value to migrate from.

**Phase-1 methodology expectations (per audit §10 + methodology Part 3
"When to adjust the pattern"):**

- Commit shapes are larger than cleanup-phase but the plan-first /
  per-commit-verify / halt-on-finding discipline holds.
- Plan documents grow to cover scaffold + boot proof + workspace
  registration in one document (this plan exemplifies the shape).
- Verification adds **boot proof** as a per-commit gate when new
  runtime surfaces land (Gate 4 above).
- CI green remains the post-push seal (Gate 5).

**Candidate new CF (proposal, defer promotion until worked-example
evidence accumulates):**

- **CF-19 candidate — "Greenfield-extension exact pinning."** When
  extending the repo with a new sub-package whose dependency tree
  should not drift from a first-commit reproducibility baseline, pin
  exact (no caret) on the first scaffold commit, even when other
  packages in the workspace use caret. Trade-off: lock-in vs drift
  surface; favoured when the package will be re-validated against
  every subsequent feature commit. Worked example here: TypeScript
  5.7.2 exact pin against root's `^5.7.2` (resolving to 5.9.3) — the
  intent is to validate that 5.7.2 boots the scaffold cleanly before
  later commits opt in to a newer version.

Promote to CF-19 only if a second worked example emerges (e.g., player-api
scaffold makes the same choice with the same rationale).

---

## §10 — Push policy + sequencing

Two-commit sequence for this plan's work:

**Commit 1.0 — Plan document**

```bash
# After architect approval of this plan content:
git add docs/superpowers/plans/2026-05-20-phase-1a-commit-1-api-scaffold.md
git commit -m "docs(plan): Phase 1a Commit 1 — apps/api/ scaffold plan"
git push origin main
gh run watch  # CF-6 docs-only push; verify CI passes
```

**Commit 1.1 — Scaffold**

```bash
# After architect approval of the CF-9 pause summary:
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): scaffold @toodooh/api Fastify package

Add the marketplace backend package skeleton under apps/api/:
- package.json with Fastify 5.8.5, TypeScript 5.7.2 (exact pin),
  tsx 4.22.3, @types/node 20.19.41
- tsconfig.json extending tsconfig.base.json with NodeNext module
  resolution overriding the bundler-mode defaults
- src/server.ts — minimal Fastify v5 instance, listens on 0.0.0.0:4000,
  graceful SIGINT/SIGTERM shutdown, no routes yet
- .gitignore, README.md

Workspace registration via the existing apps/* glob — no
pnpm-workspace.yaml edit required.

First commit of Phase 1a, vertical-slice 1 (screenhost signin/signup).
Commit 2 adds env validation + pino + /health; Commit 3 adds Drizzle +
local Postgres. No auth, no DB, no routes in this commit."

git push origin main
gh run watch  # CF-7 code push; verify CI passes
```

Both commits land on `main` directly (solo project, no PR per CLAUDE.md).
Pause-before-push is the review point on both. No `Co-Authored-By:
Claude` trailer (CLAUDE.md non-negotiable rule #9).

---

## §11 — Exact file contents (Commit 1.1)

### `apps/api/package.json`

```json
{
  "name": "@toodooh/api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "echo \"no tests yet — added in Phase 1a Commit 2\" && exit 0"
  },
  "dependencies": {
    "fastify": "5.8.5"
  },
  "devDependencies": {
    "@types/node": "20.19.41",
    "tsx": "4.22.3",
    "typescript": "5.7.2"
  }
}
```

### `apps/api/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": false,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### `apps/api/src/server.ts`

```ts
import Fastify, { type FastifyInstance } from 'fastify';

const PORT = 4000;
const HOST = '0.0.0.0';

const app: FastifyInstance = Fastify();

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
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
```

Notes on the source:
- `void start()` to satisfy `@typescript-eslint/no-floating-promises`
  (the rule is not currently enabled at the repo root, but the pattern
  is idiomatic and forward-compatible with Phase 1's strictness ratchet).
- `app.log` uses Fastify's default logger (off by default, so log calls
  no-op in this commit). Commit 2 attaches pino; the call sites here
  stay unchanged.
- `type { FastifyInstance }` import respects `verbatimModuleSyntax: true`
  (inherited from base).
- No `console.*` calls — complies with the global `no-console: error`
  ESLint rule.

### `apps/api/.gitignore`

```
dist/
node_modules/
.env
.env.local
```

### `apps/api/README.md`

```markdown
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
```

---

## §12 — Fire instruction

This is **Commit 1.0** (plan document). Architect: review the plan
above. On approval, commit + push as a docs-only commit per §10.
**Halt** until then. No code edits in `apps/api/` until the
**Commit 1.1** prompt fires.

**Watch items for the architect on plan review:**

1. ESLint scoping finding (§2.1) — confirm "no Commit 0.5 needed" matches
   the architect's read of `eslint.config.js`.
2. Pinned-version table (§1) — `@types/node@20.19.41` matches the Node
   20.20.2 runtime exactly per architect lock-1; greenfield discipline.
3. `server.ts` content (§11) — confirm the `void start()` /
   `void shutdown(...)` idiom and the no-`console` discipline match the
   intended starting shape; pino arrives Commit 2.
4. Boot verification approach (Gate 4) — confirm port 4000, default 404
   response, and 2s shutdown SLO are acceptable.
