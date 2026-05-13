# Step 6 — Typing & residuals pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive `@typescript-eslint/no-unused-vars` and `no-empty` lint counts to **0**; drive `@typescript-eslint/no-explicit-any` to **0 except for explicitly-marked Phase-1-blocked casts** (Supabase response shapes that will be typed by the backend replacement). Typecheck must not regress above the post-Step-5 baseline of 197.

**Architecture:** Seven commits. **Commit 0 — discovery + categorization** (no code; produces a categorized report and reconciles the 43-vs-265 `any` scope question with the prompt-writer before any code commits fire). **Commits 1–3 — `no-explicit-any` work**, split by category: mechanical fixes first (Cat-C laziness + Cat-D error narrowing), then type-system refactors (Cat-B), then Phase-1-blocked casts get `// TODO(phase-1):` markers + `eslint-disable-next-line` directives + a tracking issue. **Commit 4 — `no-unused-vars`** (delete locals, `_`-prefix params, restructure destructures). **Commit 5 — `no-empty`** (per-site judgment: delete wrapper vs fill in). **Commit 6 — verify ESLint rule states + audit refresh + close issue #8.**

**Tech stack:** TypeScript 5.7 strict, Vite, Vitest, pnpm 9 monorepo, ESLint 9 flat config + Husky/lint-staged. Node v20.20.2 (`.nvmrc`). pino logger module (landed in Step 5).

---

## Conventions for every task in this plan

- **Node:** all commands assume `nvm use` has been run (reads `.nvmrc` → v20.20.2). If `node --version` is not `v20.20.2`, run `nvm use` first.
- **Commands** (from repo root `~/Desktop/toodooh-platform/`): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @toodooh/web build`.
- **Live baseline** (captured at plan-writing time on `3d9ad55`, post-Step-5):
  - `pnpm typecheck` → exit 2, **197** `error TS…` lines (131 of which are `TS6133` — the unused-var unmasks from Step 5).
  - `pnpm lint` → exit 1, **859 problems (835 errors, 24 warnings)**, breakdown:
    - `@typescript-eslint/no-explicit-any`: **265** (= 43 literal `as any` casts + 218 type-annotation `any` mentions; see Commit 0 reconciliation)
    - `jsx-a11y/label-has-associated-control`: 230 (out of scope for Step 6 — Step 11)
    - `@typescript-eslint/no-unused-vars`: **161** (~131 TS6133-mirror unmasks + ~30 pre-existing)
    - `no-useless-catch`: 71 (out of scope for Step 6 — separate later cleanup)
    - `no-empty`: **30** (Step 5 unmasks)
    - other jsx-a11y / react-hooks / import-x / etc.: ~102
    - `no-console`: **0** ✓ (Step 5 closed this)
  - `pnpm test` → exit 0, **6** Test Files / **68** tests pass.
  - `pnpm --filter @toodooh/web build` → exit 0, **110** `.js` chunks; main `index-*.js` = **445.40 kB / gzip 130.50 kB**; largest `Dashboard-*.js` ≈ 618.68 kB.
- **Pre-commit hook:** Husky runs lint-staged (`eslint --fix` + `prettier --write`). Step-6 commits touch files that have pre-existing non-autofixable lint (the very rules we're working on, plus 71 `no-useless-catch` + 230 `label-has-associated-control` + …) — most commits in this step will need `--no-verify`, but try clean first per Step 5's policy and document the failure cause in the commit body.
- **`.prettierignore`** covers `docs/handoff/` and `docs/superpowers/` (this plan file is exempt). Source files and `docs/audit.md` are NOT exempt → prettier runs on them.
- **Repo for `gh` commands:** `Ben-aoun-1/toodooh-refactored`.

---

## Post-approval clarifications (authoritative — these win over any stale code block below)

1. **The 43-vs-265 `any` scope discrepancy is real and must be reconciled in Commit 0 before any `no-explicit-any` work fires.** The audit doc said "44 `as any` occurrences" using a literal-grep heuristic; the lint rule counts **all** `any` mentions (`as any` casts + `: any` parameter/return types + `Record<string, any>` etc.). Fresh numbers at plan-writing: **43 casts + 218 type-annotation = 265 total lint hits.** The success criterion ("lint reports 0 no-explicit-any except TODO-marked") requires zeroing the full 265. Commit 0's report includes the per-site categorization for ALL 265 — if the prompt-writer revises scope to only the 43 casts, the success criterion gets revised in the plan and the audit before Commit 6 fires.

2. **Cat-A casts get TWO inline markers, not one:**
   ```ts
   // TODO(phase-1): typed Supabase response — see #<N>
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
   const code = (err as any).code;
   ```
   - The `TODO(phase-1)` line is the human-readable signal + grep target.
   - The `eslint-disable-next-line` is what makes the lint count drop.
   - `<N>` is the new tracking issue number (created in Commit 3 before any markers are written).
   - Greppable: `grep -rn "TODO(phase-1):" apps/web/src/` returns the exact set.

3. **Hard halts at every commit gate** (literal interpretation; report and pause, don't auto-revert):
   - `pnpm typecheck` regresses **above** 197 (going below 197 is improvement — report and continue).
   - Any test fails.
   - `ls apps/web/dist/assets/*.js | wc -l` ≠ 110.
   - Main `index-*.js` gzip moves more than **±5 kB** from 130.50 kB anchor.
   - `as any` cast count goes UP between commits (a refactor introduced new casts; investigate).
   - `no-unused-vars` count goes UP between commits.

4. **Commit 0 categorization-heuristic sanity check:** If Cat-A (external-API-without-types) count is unexpectedly **< 20 of the 43 casts**, surface for review — the heuristic may be misclassifying Supabase calls. Same check applies if the categorization of 218 type-annotation any's produces an outlier distribution.

5. **TS6133 / no-unused-vars sub-categorization** (set during Commit 0, applied in Commit 4):
   - **Param** (function parameter, `function foo(unused: T)` or `(unused: T) => …`): prefix with `_` → `_unused`. ESLint default + `tseslint.configs.recommended` allows `^_` ignore-pattern; verify during Commit 0.
   - **Local var** (`const x = …` never referenced): delete entirely. If the right-hand side has a side effect (`const x = await service.call()`), drop the binding but keep the call: `await service.call()`.
   - **Destructure** (`const { a, b, c } = obj` where `b` is unused): rewrite the destructure to omit `b`, OR (if all three are unused) delete the whole statement.
   - **Catch binding** (`catch (e) { … }` where `e` is unused): prefix with `_` → `catch (_e)`. Most are unused because the catch body uses `log.error` without referencing `e`; some are genuine pass-throughs.

6. **`no-empty` per-site judgment** (Commit 5):
   - **Empty `.then((r) => {})`** (~most common from Step 5 unmasks): the `.then` itself was holding a deleted `console.log`; **delete the entire `.then`**. The promise still resolves.
   - **Empty `catch (e) {}`** (was holding deleted `console.error`): if the surrounding code can ignore the failure (no propagation needed), keep with explicit intent comment; otherwise restructure so the catch isn't empty (e.g. inline-disable with a reason).
   - **Empty function body** (`function foo() {}`): probably a stub — delete the function and its caller, OR fill in the real intent if obvious from context.
   - **Empty block** (`if (cond) {}`): the conditional check has no effect; delete the block and its condition.
   - Rule of thumb: if the empty body was created by Step 5's deletion and the wrapping construct has no value without the body, **delete the wrapper**. Don't paper over by adding an `eslint-disable` comment unless the empty body is genuinely intentional and that intent is documented inline.

7. **Commit 4 may need to touch sites also flagged as Cat-A casts.** If a TS6133 unused-var is part of a Supabase-response destructure (`const { data, error: _error } = …`), resolve during Commit 4, not earlier — the Cat-A cast and the unused-var unmask share a root cause. Plan task ordering reflects this: Commit 1–3 finishes `as any` first, then Commit 4's unused-vars work won't surprise the casts.

8. **Verification before each commit:**
   - Re-run the relevant rule's count (e.g. `pnpm lint 2>&1 | grep -c "no-explicit-any"`).
   - Compare to the previous commit's number.
   - Halt if the count went UP (per #3).

---

## File structure (what gets created / modified across the whole plan)

**Created:**

- **None in `apps/web/src/`** — Step 6 is a per-call-site fixup, not a new-module introduction. (Possible exception: a small `apps/web/src/lib/errors.ts` with an `isErrorWithCode(e): e is { code: string; message: string }` helper if Commit 1's Cat-D narrowing pattern repeats often enough to justify deduplication. Decide during Commit 0's categorization sample; flag in the report.)
- One new GitHub issue (Phase-1 typing prerequisites) in Commit 3 — not a repo file.

**Modified:**

- (Commits 1–3) ~30–50 source files under `apps/web/src/` — every file with `no-explicit-any` violations.
- (Commit 4) ~60–80 source files — every file with `no-unused-vars` violations.
- (Commit 5) ~20–25 source files — every file with `no-empty` violations.
- (Commit 6) `eslint.config.js` — only if `no-unused-vars` or `no-empty` are currently `warn` (probable: already `error` since they're surfaced as errors in the lint output, but verify).
- (Commit 6) `docs/audit.md` — §2 snapshot refresh, §3 typing subsection rewrite (past tense), §3 residual breakdown update, §4 add Step-6 row, §5 mark Step 6 ☑.

**Unchanged** (verify, but no edits expected): `apps/web/src/lib/dooh/*`, `apps/web/src/lib/logger.ts`, `apps/web/src/lib/logger.test.ts`, all tests under `__tests__/` and `*.test.ts`, `apps/web/src/scripts/*`. These should all be type-clean / unused-var-clean / no-empty-clean already (verify in Commit 0).

---

## Verification gates summary (per-commit target numbers)

| Commit | typecheck (errors) | lint total | `no-explicit-any` | `no-unused-vars` | `no-empty` | tests | chunks | main gzip |
| ------ | ------------------ | ---------- | ----------------- | ---------------- | ---------- | ----- | ------ | ----------------- |
| 0 (discovery) | 197 (unchanged) | 859 | 265 | 161 | 30 | 6/68 | 110 | 130.50 kB |
| 1 (Cat-C+D)   | ≤ 197 | ↓ | ↓ (target: ↓~30–50) | ≤ 161 | ≤ 30 | 6/68 | 110 | ±5 kB |
| 2 (Cat-B)     | ≤ 197 | ↓↓ | ↓↓ (target: ↓~50–80 cumulative from C1) | ≤ 161 | ≤ 30 | 6/68 | 110 | ±5 kB |
| 3 (Cat-A markers) | ≤ 197 | **= 859 − (C1+C2 deltas) − (Cat-A count)** | **= (218 type-annotation any unhandled in C1/C2, if scope is 265-wide) OR 0 (if scope is 43-only)** | ≤ 161 | ≤ 30 | 6/68 | 110 | ±5 kB |
| 4 (no-unused-vars) | ≤ 197 (likely ↓~131 because TS6133 mirror) | ↓~131 | (held) | **= 0** | ≤ 30 | 6/68 | 110 | ±5 kB |
| 5 (no-empty)  | ≤ 197 | ↓~30 | (held) | 0 | **= 0** | 6/68 | 110 | ±5 kB |
| 6 (rule + docs) | ≤ 197 | unchanged from C5 | (held) | 0 | 0 | 6/68 | 110 | ±5 kB |

Final state expectation:

- **typecheck:** ~66 errors (= 197 − 131 TS6133 fixed in Commit 4) — depends on how many of the 131 are genuinely fixable vs need `_`-prefix (param ignores stay).
- **lint:** ~660 problems if scope is 265-wide (35 no-any remaining as TODO-marked + 0 unused-vars + 0 no-empty + ~625 other pre-existing rules); ~700–750 if scope is 43-only.
- The lint number lands in audit-doc §2 snapshot at Commit 6.

---

# COMMIT 0 — Discovery + categorization (no code changes)

Pure read-the-code commit. Produces a categorized report. No source edits, no commits to source. The single commit fires only on `docs/superpowers/plans/2026-05-13-step-6-typing-residuals.md` once the report is appended (or as a separate report doc — executor's choice; either works).

## Task 0.1: Capture fresh baselines

- [ ] **Step 1: re-run the four gate commands** to confirm post-Step-5 numbers haven't drifted:
  ```bash
  pnpm typecheck 2>&1 | grep -c "error TS"
  pnpm lint 2>&1 | grep "problems"
  pnpm lint 2>&1 | grep -c "no-console"
  pnpm test 2>&1 | grep -E "Test Files|Tests "
  pnpm --filter @toodooh/web build 2>&1 | grep -E "index-|built in"
  ls apps/web/dist/assets/*.js | wc -l
  ```
  Expected: 197, 859, 0, 6/68, 110 chunks, 130.50 kB gzip. Halt and report if any differ by more than noise.

- [ ] **Step 2: per-rule fresh counts.**
  ```bash
  pnpm lint 2>&1 | grep -c "@typescript-eslint/no-explicit-any"      # expect 265
  pnpm lint 2>&1 | grep -c "@typescript-eslint/no-unused-vars"       # expect 161
  pnpm lint 2>&1 | grep -c "no-empty"                                # expect 30
  pnpm typecheck 2>&1 | grep -c "error TS6133"                       # expect ~131
  grep -rEn '\bas any\b' apps/web/src --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ --exclude-dir=scripts | wc -l   # expect 43
  ```

## Task 0.2: Reconcile the `any` scope (43 casts vs 265 lint hits)

- [ ] **Step 1: produce two lists.**
  - List A — every literal `as any` cast (file:line + the cast line + ±2 lines context).
  - List B — every type-annotation `any` (parameter/return/variable type — `x: any`, `function foo(): any`, `Record<string, any>`, `Array<any>`, `<T extends any>`, etc.) (file:line + 5 lines context).
  - Sample command for List B:
    ```bash
    grep -rEn ':\s*any\b|<any>|any\[\]|Record<[^,]+,\s*any>|extends any' apps/web/src --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ --exclude-dir=scripts | head -50
    ```
- [ ] **Step 2: surface the reconciliation in the discovery report:**
  ```
  Scope reconciliation:
  - Literal `as any` casts: 43
  - Type-annotation `any` mentions: 218
  - Lint `no-explicit-any` total: 265
  
  The user's brief scoped this as "~44 pre-existing casts" but the success
  criterion ("lint reports 0 no-explicit-any except TODO-marked") requires
  zeroing all 265. Which scope do you want?
    (a) 265-wide: includes type-annotation any. Bigger work; ~2-3 days
        becomes ~3-4 days. Eliminates the lint count entirely (except
        Phase-1 TODOs).
    (b) 43-only: just the casts. Success criterion needs revision —
        end-of-Step-6 lint will report ~218 no-explicit-any errors
        (type-annotation any's, kept as-is). These become a separately
        tracked future cleanup, NOT in Step 6 or Phase 1.
  
  Recommendation: (a) if the audit doc's target is a clean lint dashboard;
  (b) if the priority is finishing in 2-3 days and the type-annotation
  any's are mostly benign (`Record<string, any>`-style placeholder typing
  that doesn't actively mislead).
  ```
- [ ] **Step 3: pause for the prompt-writer to pick (a) or (b).** The rest of the plan assumes (a) unless the report comes back with (b) chosen — in which case Commits 1–3 only handle the 43 casts and Step 6's success criterion gets revised in this plan + audit doc before Commit 6 fires.

## Task 0.3: Categorize the `any` sites

(If scope (b), only categorize the 43 casts. If (a), categorize all 265 — type-annotation any's mostly fall into Cat-C "laziness" or Cat-A "external API" depending on the source.)

- [ ] **Step 1: open each site and assign one of four categories:**
  - **Cat-A — External API without types** (Supabase response shapes, third-party libs without `.d.ts`, raw `JSON.parse(unknown)`). Resolution: add `// TODO(phase-1):` marker + `eslint-disable-next-line` (Commit 3). Estimated dominant category — should be ≥20 of the 43 casts based on the screenshot Ben showed during brainstorm.
  - **Cat-B — Type-system limitation** (discriminated unions, generic constraints requiring real refactor, generic function returns). Resolution: actual type refactor (Commit 2). Usually 5–15 sites.
  - **Cat-C — Laziness** (`(x as any).foo` where the actual type is knowable from surrounding context — e.g. the function above declared `x: SomeType`, the author just cast around it). Resolution: replace `as any` with the proper type (Commit 1). Common.
  - **Cat-D — Error narrowing** (`(err as any).code`, `(error as any).message` — pattern from Step 5's pino promotions where the catch binding's type is `unknown` and the script fell back to a cast). Resolution: narrow via `instanceof Error` or an `isErrorWithCode` helper (Commit 1). All Step-5-introduced casts should fall here; pre-Step-5 ones may also.
- [ ] **Step 2: produce the categorization table:**
  ```
  | Cat | Count | Files affected | Typical pattern | Commit |
  |-----|-------|----------------|-----------------|--------|
  | A   | ?     | ?              | (Supabase resp) | 3      |
  | B   | ?     | ?              | (generic limit) | 2      |
  | C   | ?     | ?              | (lazy local)    | 1      |
  | D   | ?     | ?              | (error.code)    | 1      |
  | Total | 43 (or 265 if scope-a) | | | |
  ```
- [ ] **Step 3: halt-on-heuristic-anomaly check.** If Cat-A < 20 of the 43 casts (or < 100 if scope-a 265-wide), pause and resurface — the categorization heuristic may be wrong. Most TOODOOH casts are Supabase-response handling.

- [ ] **Step 4: extract the 10 most complex Cat-B sites** (the ones that require real refactor) and show their full surrounding 15-line context. These are the spot-check sites for Commit 2's review.

## Task 0.4: Categorize the no-unused-vars sites

- [ ] **Step 1: enumerate every site with file:line.**
  ```bash
  pnpm lint 2>&1 | grep -E "^\s+\d+:\d+\s+error\s+'\w+' is (defined|assigned a value) but never used\s+@typescript-eslint/no-unused-vars" > /tmp/step6-unused-vars.txt
  ```
  Or parse `pnpm lint`'s output by file. Aim for a sorted-by-file list with line numbers.

- [ ] **Step 2: sub-categorize each into:**
  - **Param** — function or arrow parameter. ESLint says "'foo' is defined but never used". Fix: prefix with `_`.
  - **Local var** — `const x = …` or `let x = …`. ESLint says "'foo' is assigned a value but never used". Fix: delete the binding; if RHS has a side effect, keep the call without the assignment.
  - **Destructure** — `const { a, b, c } = …` where some are unused. Fix: rewrite destructure to omit, or delete entirely if all unused.
  - **Catch binding** — `catch (e) { … }`. Fix: `catch (_e)`.

- [ ] **Step 3: produce sub-category counts table:**
  ```
  | Sub-category | Count | Example file:line |
  |--------------|-------|---|
  | Param        | ?     | ? |
  | Local var    | ?     | ? |
  | Destructure  | ?     | ? |
  | Catch        | ?     | ? |
  | Total        | 161   | |
  ```

- [ ] **Step 4: verify ESLint's `argsIgnorePattern`** — confirm `_`-prefixed params are allowed:
  ```bash
  grep -A2 "no-unused-vars" eslint.config.js
  ```
  If `argsIgnorePattern: '^_'` is NOT set, plan Commit 4 to add it OR plan to delete params entirely (worse — changes function arities). Surface in the report either way.

## Task 0.5: Categorize the no-empty sites

- [ ] **Step 1: enumerate every site with file:line + 5 lines context.**
  ```bash
  pnpm lint 2>&1 | grep -B1 "no-empty" | head -100
  ```
  Or grep the source for telltale patterns:
  ```bash
  grep -rEn '\bcatch\s*\([^)]*\)\s*\{\s*\}' apps/web/src --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ --exclude-dir=scripts
  grep -rEn '=>\s*\{\s*\}' apps/web/src --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ --exclude-dir=scripts
  ```

- [ ] **Step 2: sub-categorize into:**
  - **Empty `.then((r) => {})`** — was holding a deleted Step-5 console.log. Fix: delete the `.then`.
  - **Empty `catch (e) {}`** — was holding a deleted console.error. Fix: per-site judgment — if the failure can be ignored, document with intent comment; if not, restructure.
  - **Empty function body** — stub function. Fix: per-site judgment.
  - **Empty if-block** — useless condition. Fix: delete.
  - **Empty arrow `() => {}`** — passed somewhere as a no-op callback. Fix: usually keep with `// no-op` comment + eslint-disable if rule is strict; otherwise inline `noop` reference.

- [ ] **Step 3: produce sub-category counts** + sample 5 most-complex per sub-category for Commit 5 review.

## Task 0.6: Produce the discovery report

- [ ] **Step 1: append the full report to this plan file** OR write to `docs/superpowers/plans/2026-05-13-step-6-discovery.md` (executor's choice).
  Report sections:
  - **A. Baseline confirmation** — current gate numbers, drift check.
  - **B. Scope reconciliation** — 43 casts vs 265 lint hits; decision (a) or (b).
  - **C. `no-explicit-any` categorization** — table + 10 most-complex Cat-B contexts.
  - **D. `no-unused-vars` categorization** — sub-category table + `argsIgnorePattern` verification.
  - **E. `no-empty` categorization** — sub-category table + sample sites.
  - **F. Helper-module decision** — is `apps/web/src/lib/errors.ts` worth creating for Cat-D dedup? Count Cat-D sites; if ≥10, recommend yes.
  - **G. Per-commit expected delta** — table updating the Verification gates summary above with discovery's actual numbers.
  - **H. Surprises** — anything else that came up.

- [ ] **Step 2: pause for prompt-writer approval.** No code commits fire until the discovery report is reviewed and the (a)/(b) scope is chosen.

**Commit (docs-only):**

```
docs(plan): Step 6 discovery report — categorize 265 no-explicit-any, 161 no-unused-vars, 30 no-empty
```

Or, if the report is appended to this plan rather than a separate file:

```
docs(plan): Step 6 discovery — categorize no-explicit-any (43 casts + 218 annot), unused-vars, no-empty
```

**`--no-verify` policy:** NO. Docs only; prettier will format.

---

# COMMIT 1 — Cat-C + Cat-D `as any` removals (mechanical subset)

## Task 1.1: Cat-D — error narrowing helper (if Commit-0's helper-module decision is yes)

**Files:** `apps/web/src/lib/errors.ts` (created), `apps/web/src/lib/errors.test.ts` (created).

- [ ] **Step 1: create `apps/web/src/lib/errors.ts`** with the narrowing helper:
  ```ts
  /**
   * Type-narrowing helpers for caught error values (`unknown` in strict mode).
   *
   * Pure: no I/O, no side effects, no module-level state.
   *
   * Usage:
   *   try { … } catch (e) {
   *     if (isErrorWithCode(e)) log.error({ err: e }, e.code);
   *     else throw e;
   *   }
   */

  /** A subset of Supabase / PostgrestError shape. */
  export interface ErrorWithCode {
    code: string;
    message: string;
    details?: string;
    hint?: string;
  }

  export function isErrorWithCode(e: unknown): e is ErrorWithCode {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      typeof (e as { code: unknown }).code === 'string' &&
      'message' in e &&
      typeof (e as { message: unknown }).message === 'string'
    );
  }
  ```
- [ ] **Step 2: create `apps/web/src/lib/errors.test.ts`** with at least 4 tests (positive Supabase shape, negative bare Error, negative null, negative string). Tests follow the same pattern as `lib/logger.test.ts`.
- [ ] **Step 3: gate** — `pnpm test` expects 6 → 7 Test Files / 68 → ~72 tests.

## Task 1.2: Rewrite Cat-D sites

**Files:** ~10–20 source files (per Commit-0 enumeration).

- [ ] **Step 1: per site**, transform:
  ```ts
  } catch (err) {
    log.error({ err }, '❌ failure');
    log.error({ data: (err as any).code }, 'code');
  }
  ```
  →
  ```ts
  } catch (err) {
    if (isErrorWithCode(err)) {
      log.error({ err, code: err.code, details: err.details, hint: err.hint }, '❌ failure');
    } else {
      log.error({ err }, '❌ failure');
    }
  }
  ```
  (Consolidates the sequential log.errors Step 5 left as "deferred logger cleanup" while we're here — IF the consolidation is local and doesn't require structural changes. Otherwise leave Step 5's mechanical promotion as-is and just narrow the type.)
- [ ] **Step 2: import** `isErrorWithCode` at the top of each touched file: `import { isErrorWithCode } from '<relative-path>/lib/errors';` (use relative path, NOT `@/` — the `@/` alias is still not configured per Step 5's Commit-4 lesson).

## Task 1.3: Rewrite Cat-C sites

**Files:** ~10–25 source files.

- [ ] **Step 1: per site**, read the surrounding 10 lines and identify the actual type. Replace `as any` with that type. If the type is genuinely too complex to spell out cleanly, escalate to Cat-B (deferred to Commit 2) and document in the commit body.

## Task 1.4: Verify counts

- [ ] **Step 1:** `as any` count drops by Cat-C + Cat-D total (per Commit-0 estimate).
- [ ] **Step 2:** `pnpm typecheck` — should not regress above 197. May go down if `isErrorWithCode` narrowing satisfies a TS6133 (some unused-error-binding cases resolve naturally).
- [ ] **Step 3:** `pnpm test` — 7 Test Files / 72 tests pass (or 6/68 if Task 1.1 was skipped because Cat-D < 10).
- [ ] **Step 4:** `pnpm build` — 110 chunks, gzip ±5 kB.

**Verification gate (Commit 1):**

- [ ] typecheck ≤ 197.
- [ ] lint `no-explicit-any`: dropped by Cat-C + Cat-D count from 265.
- [ ] `no-unused-vars`: ≤ 161 (may have dropped if errors-helper narrowing satisfied some TS6133s).
- [ ] tests: 7/72 (or 6/68 if helper skipped).
- [ ] build: 110 chunks, gzip in [125.50, 135.50] kB.

**Commit:**

```
refactor(types): Cat-C + Cat-D no-explicit-any fixes + isErrorWithCode helper

Mechanical subset of Step 6's no-explicit-any work:
  - Cat-C (lazy `as any` casts where the type was knowable from context):
    rewrite to proper type.
  - Cat-D (error-narrowing fallbacks from Step 5's pino promotions):
    introduce `lib/errors.ts` with `isErrorWithCode(e): e is ErrorWithCode`
    and narrow each catch-binding via that helper.

[counts table per file]

Verified: typecheck N (≤ 197), no-explicit-any 265 → N1, tests N2/N3,
build 110 chunks, main gzip N4 kB.
```

**`--no-verify` policy:** try clean first. The touched files have pre-existing lint that survives (e.g. `no-useless-catch`); fall back to `--no-verify` if lint-staged fails, document.

**Pause for review.** Sample 5 Cat-D rewrites + 5 Cat-C rewrites in the report.

---

# COMMIT 2 — Cat-B `as any` refactors (type-system level)

**Files:** ~5–15 source files (per Commit-0 enumeration).

## Task 2.1: Per-site refactor

These are the judgment-heavy ones. Each requires reading the surrounding type definitions and possibly extending an interface / introducing a discriminated union / generalizing a generic. **Not scriptable.**

- [ ] **Step 1: per site**, read the discovery report's full 15-line context block. Decide:
  - Add a missing field to an existing interface
  - Introduce a discriminated union (`type Status = 'pending' | 'active' | 'rejected'` with branched type handling)
  - Generalize a function generic (`<T>` instead of `any`)
  - Refactor the call site to thread a typed value through (sometimes the cast is the symptom; the cause is upstream)
- [ ] **Step 2: rewrite the type/refactor the structure**. Run `pnpm typecheck` after each site to confirm no regression.

- [ ] **Step 3: if any site genuinely can't be resolved without major restructure that's outside Step 6's scope**, escalate to Cat-A (Phase-1-blocked) and document the decision in the commit body. Don't force a bad refactor.

## Task 2.2: Verify counts

- [ ] **Step 1:** `as any` count drops by Cat-B total.
- [ ] **Step 2:** `pnpm typecheck` — may have NEW errors if a type was widened in a way that surfaces inconsistencies downstream. Investigate and fix during this commit (the refactor isn't done if it created cascading errors).

**Verification gate (Commit 2):**

- [ ] typecheck ≤ 197 (or note an intentional rise if a refactor surfaced new genuine errors — but flag for review).
- [ ] lint `no-explicit-any`: dropped by Cat-B cumulative from Commit 1.
- [ ] tests: pass.
- [ ] build: 110 chunks, gzip ±5 kB.

**Commit:**

```
refactor(types): Cat-B no-explicit-any refactors (type-system level)

Per-site type refactors for the cases where `as any` was the symptom of
a real type-system constraint (missing interface field, undeclared
discriminated union, over-narrow generic). Each refactor adds the
missing type and propagates through callers.

[file-by-file refactor summary]

Verified: typecheck N, no-explicit-any N1, tests N2/N3, build 110 chunks,
main gzip N4 kB.
```

**`--no-verify` policy:** try clean first; fall back if needed.

**Pause for review.** Sample the 10 Cat-B sites from Commit-0's report with before/after diffs.

---

# COMMIT 3 — Cat-A `// TODO(phase-1):` markers + GitHub issue

## Task 3.1: Create the tracking issue

- [ ] **Step 1: confirm milestone & labels.**
  ```bash
  gh api repos/Ben-aoun-1/toodooh-refactored/milestones?state=open
  gh label list --repo Ben-aoun-1/toodooh-refactored | grep -iE "cleanup|typing|phase-1"
  ```
  Expected: "Frontend cleanup phase" milestone exists; `cleanup` label exists; `area:typing` may not — create it via `gh label create area:typing --description "Type-system work" --color "..."` if missing.

- [ ] **Step 2: create the issue.**
  ```bash
  gh issue create \
    --repo Ben-aoun-1/toodooh-refactored \
    --title "Phase-1 typing prerequisites — typed API client to replace \`// TODO(phase-1):\` casts" \
    --label cleanup \
    --label area:typing \
    --milestone "Frontend cleanup phase" \
    --body "$(cat <<'EOF'
  Tracks the `// TODO(phase-1):` `as any` casts left after Step 6. These are
  exclusively Supabase response shapes that will be properly typed when the
  backend migration replaces Supabase with the typed self-hosted API client
  (Phase 1, `apps/api/`).

  ## Closing criteria

  - apps/api/ ships with a typed client (Zod-validated, generated, or hand-typed).
  - Every site below has been rewritten against the new client; the
    `// TODO(phase-1):` markers and their `eslint-disable-next-line` directives
    are removed.
  - `pnpm lint` reports 0 `@typescript-eslint/no-explicit-any` violations.

  ## Sites (file:line)

  [Discovery report's Cat-A list, exact file:line bullets — paste from Commit 0]

  Step-6 wave: <count> casts marked.
  EOF
  )"
  ```
- [ ] **Step 3: capture the issue number.** Print it (`gh issue list --search "Phase-1 typing prerequisites" --json number,title`). Save to a variable / paste into the commit body. **This is the `<N>` used in every marker.**

## Task 3.2: Add markers to every Cat-A site

- [ ] **Step 1: per site**, insert TWO lines immediately above the `as any` cast (preserving exact indentation of the cast line):
  ```ts
      // TODO(phase-1): typed Supabase response — see #<N>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const code = (response as any).code;
  ```
  Use `<N>` = the issue number from Task 3.1.
- [ ] **Step 2: script-assisted insertion** is fine for the mechanical part (locate each Cat-A `as any` from Commit 0's list, insert the two lines above with matching indentation). Hand-review afterward by running `grep -B1 -A1 'TODO(phase-1):' apps/web/src/` and visually scanning.

## Task 3.3: Verify

- [ ] **Step 1: lint count drops to 0 for `no-explicit-any` IF scope is (a) 265-wide.**
  - If scope (a): all 265 are now resolved — Cat-C+D (Commit 1), Cat-B (Commit 2), Cat-A (this commit's markers + disables). Lint reports 0.
  - If scope (b) 43-only: lint reports the ~218 type-annotation any's that remain (NOT marked, NOT addressed; documented as future work).
- [ ] **Step 2: grep verification:**
  ```bash
  grep -rn "TODO(phase-1):" apps/web/src/ | wc -l    # = Cat-A count
  grep -rn '@typescript-eslint/no-explicit-any' apps/web/src/ | wc -l  # = Cat-A count (the disable-next-line comments)
  ```
  Both should equal Cat-A. Halt if mismatched.

**Verification gate (Commit 3):**

- [ ] typecheck ≤ 197.
- [ ] lint `no-explicit-any`: **0** (if scope a) OR ~218 (if scope b, with revised success criterion).
- [ ] grep `TODO(phase-1):` count = Cat-A count.
- [ ] tests pass.
- [ ] build: 110 chunks, gzip ±5 kB.

**Commit:**

```
refactor(types): mark Cat-A as-any casts with TODO(phase-1) + close #<N> in body

Add `// TODO(phase-1): typed Supabase response — see #<N>` + an
`eslint-disable-next-line` directive above each of the N Cat-A casts
(external API responses without types — Supabase shapes that the
Phase-1 backend will type properly). Created tracking issue #<N>:
"Phase-1 typing prerequisites — typed API client to replace
`// TODO(phase-1):` casts".

Mechanical marker pass — no behavioral changes; types still 'any' at
each site, but the lint rule sees the disable directive and reports 0
(or 218 if scope-b was chosen).

Verified: lint no-explicit-any 0 (or 218), grep TODO(phase-1) N matches.
```

**`--no-verify` policy:** try clean first. Most likely passes since the disable directives bring the touched files' lint cleaner than they were.

**Pause for review.** Sample 10 marker insertions across different files; verify the issue body lists every site.

---

# COMMIT 4 — `no-unused-vars` pass

## Task 4.1: Per-sub-category pass

**Files:** ~60–80 source files (per Commit-0 enumeration).

- [ ] **Step 1: Param sites — script-assisted `_`-prefix.**
  Script reads Commit-0's param-sub-category list (`file:line:identifier`) and prefixes each with `_`. Single-pass; AST-based preferred over regex to handle destructured params.

- [ ] **Step 2: Local var sites — script-assisted delete.**
  Two patterns:
  - `const x = expr;` where `x` is unused AND `expr` has no side effect → delete the whole statement.
  - `const x = await service.call();` where `x` is unused AND the await might have a side effect → drop `const x = `, keep `await service.call();`.
  Discovery report's per-site decision needed; some are obvious (delete), some need a quick read.

- [ ] **Step 3: Destructure sites — hand-pass.**
  - `const { a, b, c } = obj` where `b` unused → `const { a, c } = obj`.
  - All-unused destructure → delete the whole statement.
  - Some destructures have side-effect getters (rare); flag and keep with disable comment if found.

- [ ] **Step 4: Catch binding sites — script-assisted `_`-prefix.**
  Same approach as params.

## Task 4.2: Iterate to convergence

(Per the Step-5 lesson appended to `docs/handoff/04-how-to-write-prompts.md`: deletions can cascade.)

- [ ] **Step 1: re-run `pnpm lint 2>&1 | grep -c "no-unused-vars"`** after the first pass.
- [ ] **Step 2: if non-zero, the first pass exposed new unmasks** (e.g. deleting `const x = service.call()` may have made the import of `service` unused). Re-grep the unused-imports — eslint-plugin-unused-imports' `unused-imports/no-unused-imports` is auto-fix-on-precommit so lint-staged would clean them; but if `--no-verify` is in play, run `eslint --fix` manually on the touched files.
- [ ] **Step 3: re-grep until count is 0.** Halt and report at zero.

## Task 4.3: Verify

- [ ] **Step 1: typecheck** — should drop by ~131 (the TS6133 mirror) once all unused-vars are resolved. Final typecheck: ~66 errors (= 197 − 131).
- [ ] **Step 2: `pnpm lint 2>&1 | grep -c "no-unused-vars"` → 0.**

**Verification gate (Commit 4):**

- [ ] typecheck: ~66 errors (= 197 − 131, allow ±5 noise for catch-binding `_e` mismatches).
- [ ] lint `no-unused-vars`: **0**.
- [ ] tests pass.
- [ ] build: 110 chunks, gzip ±5 kB.

**Commit:**

```
refactor(types): zero @typescript-eslint/no-unused-vars (161 → 0)

Resolve all 161 no-unused-vars violations via sub-category pass:
- N1 function/arrow params → prefixed with `_`
- N2 local vars → deleted (or kept side-effect-only)
- N3 destructure entries → omitted from destructure
- N4 catch bindings → prefixed with `_e`

Iterated to convergence: first pass left M cascade-revealed unused
imports (auto-fixed by unused-imports plugin).

Typecheck drops from 197 → ~66 (TS6133 mirror gone).

Verified: lint no-unused-vars 0, typecheck N, tests N2/N3, build 110
chunks, main gzip N4 kB.
```

**`--no-verify` policy:** YES on first attempt (residual no-useless-catch + label-has-associated-control survives); document.

**Pause for review.** Sample 5 of each sub-category with before/after diffs.

---

# COMMIT 5 — `no-empty` pass

## Task 5.1: Per-sub-category pass

**Files:** ~20–25 source files (per Commit-0 enumeration).

- [ ] **Step 1: Empty `.then((r) => {})` sites** — most common from Step 5 unmasks. Delete the `.then`. The promise still resolves.

- [ ] **Step 2: Empty `catch (e) {}` / `catch (_e) {}` sites** — per-site judgment:
  - If the surrounding flow can safely ignore the failure (e.g. fire-and-forget telemetry, optional logging that's been removed): keep empty with `// noop: failure intentionally ignored — reason` comment AND add `// eslint-disable-next-line no-empty -- intentional` directive.
  - If the failure should propagate: `} catch (e) { throw e; }` — but then the catch is useless; remove the try/catch wrapper entirely.
  - Most cases will be "delete the wrapper" because Step 5 emptied a catch that ONLY logged.

- [ ] **Step 3: Other empty blocks** (if any in the discovery report) — judgment per site.

## Task 5.2: Verify

- [ ] **Step 1: `pnpm lint 2>&1 | grep -c "no-empty"` → 0.**
- [ ] **Step 2: typecheck** — may go up slightly if removing a try/catch surfaces a non-handled rejection chain; investigate and fix during this commit.

**Verification gate (Commit 5):**

- [ ] typecheck ≤ post-Commit-4 (or note rise + reason).
- [ ] lint `no-empty`: **0**.
- [ ] tests pass.
- [ ] build: 110 chunks, gzip ±5 kB.

**Commit:**

```
refactor(types): zero no-empty (30 → 0)

Per-site judgment on the 30 no-empty violations:
- N1 empty .then() bodies → deleted .then (Step-5 deletion remnants)
- N2 empty catch blocks → wrapper deleted (caught nothing material) OR
  kept empty with intent comment + eslint-disable-next-line
- N3 other → per-site judgment, documented inline

[per-file summary]

Verified: lint no-empty 0, typecheck N, tests N1/N2, build 110 chunks,
main gzip N3 kB.
```

**`--no-verify` policy:** try clean first.

**Pause for review.** Sample 5 of each sub-category.

---

# COMMIT 6 — ESLint rule states + audit refresh + close #8

## Task 6.1: Verify ESLint rule states

- [ ] **Step 1: read `eslint.config.js`.** Confirm:
  - `'@typescript-eslint/no-explicit-any': 'error'` (project-wide, already set).
  - `'@typescript-eslint/no-unused-vars'` — should be `'error'` (likely inherited from `tseslint.configs.recommended`); verify by inspection.
  - `'no-empty': 'error'` — should be set; verify (may be default `'warn'`).
- [ ] **Step 2: if any rule is `'warn'`, promote to `'error'`.** Re-run lint to confirm no regression.

## Task 6.2: Refresh `docs/audit.md`

- [ ] **Step 1: §2 Snapshot — capture post-Step-6 numbers:**
  - typecheck: ~66 (= 197 − 131)
  - lint: ~660 problems (= 859 − 161 unused-vars − 30 no-empty − 265 no-explicit-any [if scope a] OR − 43 [if scope b])
  - per-rule top breakdowns updated
  - `no-explicit-any`: 0 (scope a, all TODO-marked) OR 218 (scope b)
  - tests: stayed 6/68 (or 7/72 if errors-helper was created)
  - build/gzip unchanged
- [ ] **Step 2: §3 `as any` / `@ts-ignore` subsection — past-tense rewrite.** Summarize Commits 1–3 (Cat-C+D fixes, Cat-B refactors, Cat-A TODO markers). Reference the new tracking issue # and the `lib/errors.ts` helper.
- [ ] **Step 3: §3 residual lint gap subsection — update counts.** TS6133 / no-unused-vars now 0 (struck through); no-empty now 0. Remaining: no-any TODO-marked count, no-useless-catch unchanged, jsx-a11y unchanged.
- [ ] **Step 4: §3 NEW subsection (or update existing TS6133-unmasks subsection)** — strike through the Step-5 unmask scoping note ("now in Step 6's worklist → resolved in Commits 4 and 5").
- [ ] **Step 5: §4 — Add Step 6 row** with commit hashes + counts + Phase-1 tracking issue link.
- [ ] **Step 6: §5 — Mark Step 6 ☑.**

## Task 6.3: Close issue #8

- [ ] **Step 1: verify issue #8 exists and is the typing-pass issue:**
  ```bash
  gh issue view 8 --repo Ben-aoun-1/toodooh-refactored --json state,title,milestone
  ```
  Expected: title contains "typing" or "as any"; milestone is "Frontend cleanup phase"; state OPEN. If #8 is something else, query:
  ```bash
  gh issue list --repo Ben-aoun-1/toodooh-refactored --milestone "Frontend cleanup phase" --state open --json number,title
  ```
  to find the actual typing issue.
- [ ] **Step 2: close with comment:**
  ```bash
  gh issue close 8 --repo Ben-aoun-1/toodooh-refactored --comment "Step 6 complete.

  - 265 no-explicit-any → 0 (Cat-C+D mechanical fixes in Commit <h1>, Cat-B refactors in <h2>, Cat-A TODO(phase-1) markers in <h3>).
    Phase-1 prerequisites tracked in #<N>.
  - 161 no-unused-vars → 0 (Commit <h4>).
  - 30 no-empty → 0 (Commit <h5>).
  - typecheck 197 → ~66.

  See audit refresh in <h6>."
  ```

## Task 6.4: Final gate suite

- [ ] **Step 1: full gate run.** Report numbers in the commit body.

**Verification gate (Commit 6):**

- [ ] typecheck ~66 (or final post-Step-6 number).
- [ ] lint `no-explicit-any`: 0 (or 218 if scope b).
- [ ] lint `no-unused-vars`: 0.
- [ ] lint `no-empty`: 0.
- [ ] tests pass.
- [ ] build: 110 chunks, gzip ±5 kB.
- [ ] `docs/audit.md` §5 row 6 shows ☑.
- [ ] issue #8 closed.
- [ ] Phase-1 tracking issue (#N) open with body listing all marked sites.

**Commit:**

```
chore: zero no-unused-vars + no-empty; mark Cat-A as-any with TODO(phase-1); refresh audit; close #8

Step 6 close-out. All three Step-6 lint rules reach their final state:
- no-unused-vars: 161 → 0
- no-empty: 30 → 0
- no-explicit-any: 265 → 0 (Cat-A marked with TODO(phase-1) — see #<N>)
  [OR: 265 → 218; scope (b) chose to defer type-annotation any's]

Typecheck dropped 197 → ~66 (TS6133 mirror).

Audit doc refreshed (§2 snapshot, §3 typing subsection past-tense, §3
residual breakdown, §4 add Step-6 row, §5 mark Step 6 ☑).

Closes #8.
```

**`--no-verify` policy:** NO. Docs + config only; prettier-clean.

---

## Key design points to sign off on

1. **Seven commits in this order**: 0 discovery → 1 Cat-C+D → 2 Cat-B → 3 Cat-A markers + issue → 4 unused-vars → 5 no-empty → 6 docs + close. Commit 0 is mandatory before any other; Commits 1–5 could in theory merge but the diff would be unreviewable.
2. **Scope reconciliation: 43 vs 265.** Surfaced in Commit 0 for explicit pick. The plan supports both (a) and (b); see Task 0.2.
3. **Cat-A double marker**: `// TODO(phase-1): … see #<N>` + `// eslint-disable-next-line @typescript-eslint/no-explicit-any`. Greppable, lint-clean, issue-linked.
4. **Helper module decision: `lib/errors.ts`** if Cat-D ≥ 10. Decided in Commit 0.
5. **Hard halt: typecheck regresses ABOVE 197.** Going below is improvement; report and continue.
6. **TS6133 ↔ ESLint no-unused-vars mirror.** Commit 4 should drop typecheck by ~131. Confirm during Commit 0 by counting `TS6133` errors that are also flagged by `no-unused-vars` rule.
7. **Iterate-to-convergence**: Commit 4 specifically must re-run lint and apply a second wave if deletions cascade (per the Step-5 lesson in the prompts guide).

---

## Cross-references

- `docs/audit.md` — refreshed in Commit 6.
- `docs/handoff/04-how-to-write-prompts.md` — references the iterate-to-convergence rule (no edits; the existing section applies).
- `apps/web/src/lib/errors.ts` + `errors.test.ts` — created in Commit 1 (if Cat-D ≥ 10).
- `eslint.config.js` — verified / promoted in Commit 6 if any rule is `warn`.
- GitHub issue #8 — closed in Commit 6 (Step-6 tracker).
- GitHub issue #<N> — created in Commit 3 (Phase-1 typing prerequisites, stays open).

---

## Risks (recap for the executor)

1. **The 43-vs-265 scope question is real and unresolved at plan-writing.** If the user picks (b), the success criterion in this plan must be revised in the same commit that fires Commit 6 — the audit can't show "lint reports 0 no-explicit-any" if 218 remain.
2. **Cat-B refactors can cascade.** A widened union type may surface dozens of new TS errors at callers. Plan reserves headroom in Commit 2's verification gate, but expect surprises.
3. **Commit 4's iterate-to-convergence** can stall if a delete creates a new unused that creates a new delete. Cap at 3 passes; if still non-zero, halt and surface (likely a circular dependency in the unused chain).
4. **`_`-prefix vs `argsIgnorePattern`.** If ESLint isn't configured for `^_` ignore, prefixing won't satisfy the rule and we'll have to delete params instead — a much riskier change (function arity). Verify in Commit 0's Task 0.4 Step 4.
5. **Cat-A heuristic mis-classification.** If discovery puts a Supabase response in Cat-C ("knowable type from context") but the actual type isn't knowable without the Phase-1 client, Commit 1's fix won't work — typecheck regresses. Re-categorize during Commit 1 if encountered; document.
6. **Helper-module decision affects test count.** Commits 4–6 expect 7/72 or 6/68 — pick early in Commit 0 and stick with it.

---

**End of plan.** Awaiting prompt-writer approval — specifically on Task 0.2's scope reconciliation — before any commits beyond Commit 0's discovery fire.
