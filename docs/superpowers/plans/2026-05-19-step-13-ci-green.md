# Step 13 — Get CI green (Issue #11)

_Plan doc. Written 2026-05-19 at baseline `75d5f1b` (Step 12 closed)._

---

## §0 Pre-flight verification

- **Baseline commit:** `75d5f1b` — Step 12 (brand-token migration) closed.
- **Working tree:** clean.
- **Gates (fresh at `75d5f1b`):** typecheck **51** · lint **1** (1e/0w) · test **160** (21 suites) · build main `index` gzip **139.80 kB** · **236** `.ts`/`.tsx` under `apps/web/src/`.
- **Audit:** roadmap row 13 (`Get CI green`, #11) is `☐`.
- **CI status:** `main` is **red** — has been for every Step-12 push (8 consecutive `failure` runs). Expected per `audit.md` §2 ("goes green at Step 13").

---

## §1 Locked constraints

- **Cleanup-phase contract resumes.** Step 13 is infrastructure configuration — no source/UI/UX change. Step 12's brand-refresh carve-out does **not** propagate.
- **The typecheck (51) and lint (1) baselines are accepted, deferred debt.** All 51 typecheck errors are Cat-A untyped-root cascades; the 1 lint error is `import-x/no-unresolved` on `src/lib/supabase.ts` → `./database.types`. **Both are blocked on the Phase-1 Supabase typed client (#15)** — they are *not* Step-13-fixable. CI must go green *with these baselines in place*, without suppressing the underlying debt.
- **D4 (wrap-don't-restructure):** `.github/workflows/ci.yml` exists and is mostly sound — extend/fix it, don't rewrite. It is not unsalvageable.
- **No `@ts-ignore` / `@ts-expect-error` / `any`** (CLAUDE.md) — rules out "make `tsc` exit 0 by suppressing the 51".
- CF-1…CF-18 apply as codebase-wide methodology.

---

## §2 Inventory

### Current `.github/workflows/ci.yml` (at `75d5f1b`)

```yaml
on: { push: { branches: [main] }, pull_request: {} }
job verify (ubuntu-latest):
  checkout@v4 → pnpm/action-setup@v4 → setup-node@v4 (node 20, cache pnpm)
  → pnpm install --frozen-lockfile
  → pnpm typecheck    ← FAILS
  → pnpm lint
  → pnpm test
```

The actions are all current (`@v4`). `pnpm/action-setup@v4` with no version pin reads `packageManager: pnpm@9.15.4` from the root `package.json` — correct. `cache: pnpm` is already configured.

### Why CI is red — verified from run `26091440057` (commit `75d5f1b`)

The **Typecheck** step runs `pnpm typecheck`, which exits **2** — `tsc` reports the 51 known Cat-A errors. CI treats any non-zero exit as failure → red. The run dies at Typecheck; **Lint and Test never execute**.

This is the crux of Step 13. **Two of the four gates have accepted non-zero baselines that are not Step-13-fixable:**

| Gate | Local result | Exit | CI verdict | Fixable in Step 13? |
| --- | --- | --- | --- | --- |
| `pnpm typecheck` | 51 errors | 2 | ❌ fails | **No** — Cat-A cascades, #15 / Phase 1 |
| `pnpm lint` | 1 error | 1 | ❌ would fail | **No** — `import-x/no-unresolved`, #15 / Phase 1 |
| `pnpm test` | 160 pass | 0 | ✅ | n/a |
| `pnpm build` | succeeds | 0 | ✅ | n/a (not currently in CI) |

A naïve "fix the gates" is impossible — the 51+1 are deferred by design. CI must verify **"no regression beyond the committed baseline"**, not "exit 0".

### Gap inventory

| # | Gap | Class |
| --- | --- | --- |
| G1 | Typecheck step demands exit-0; baseline is 51 (accepted, #15). | **JUDGMENT** — needs baseline-comparison gating |
| G2 | Lint step demands exit-0; baseline is 1 (accepted, #15). | **JUDGMENT** — baseline-gate, or `eslint-disable` the one import |
| G3 | No **build** step — the four-gate set includes build; CI runs only 3. | MECHANICAL — add `pnpm build` |
| G4 | Node pinned to `20` (floating 20.x), not `20.20.2` per `.nvmrc` / CLAUDE.md. | MECHANICAL — pin exact for local/CI parity |
| G5 | Baseline numbers need a home + a regression-vs-baseline comparison. | **JUDGMENT** — storage + ratchet policy |

Non-gaps (verified sound): pnpm version (inferred from `packageManager`), pnpm-store caching (`cache: pnpm`), triggers (`push:[main]` + `pull_request`), action versions (all `@v4`). `pnpm build` does **not** need Supabase secrets — Vite inlines `VITE_*` env at build and tolerates them being unset; the bundle builds regardless (verified locally all through Step 12 with an empty `.env.local`).

---

## §3 Commit factoring

| Commit | Scope |
| --- | --- |
| **1** | Plan doc (this commit). |
| **2** | `ci.yml` rewrite of the gate steps — baseline-comparison gating for typecheck + lint (G1/G2/G5), add the build step (G3), pin Node `20.20.2` (G4). Single commit — the changes are one coherent unit and all in one file. |
| **3** | Audit refresh (§2 `CI: green`, §5 row 13 ☑), close #11. |

3 commits. No Commit-4 caching commit — caching is already present and adequate; §2 found no optimization worth its own commit.

---

## §4 Per-commit verification gates

Commit 2 touches only `.github/workflows/ci.yml` — **no source change**, so:

- typecheck **= 51** · lint **= 1** · test **= 160** · build main gzip **139.80 ± 0.5 kB** · file count **236** (new file only under `.github/`, outside the `src/` count) — all must be flat.

**Step-13-specific load-bearing gate:** the CI run *itself* must show **green** on GitHub for Commit 2's push. Local four-gate verification is necessary but not sufficient — the deliverable is the green checkmark. Commit 2 is not "done" until `gh run view` confirms green.

---

## §5 Standing operating procedure

- **CF-7 amendment** — code/config commits push in the gate-sweep flow. Commit 2 is config-only and produces no rendered change → normal flow, no visual-QA pause.
- After Commit 2 pushes, **watch the CI run to completion** (`gh run watch` / `gh run view`). The run's verdict is the commit's real gate. Do not declare Commit 2 done on local gates alone.
- Truncation safeguards per the established pattern.
- The baseline-comparison step must **fail loudly on regression** (count > baseline) and **pass on equality** (count == baseline). It may optionally emit a notice when count < baseline (the baseline should then be ratcheted down) — see D-3.

---

## §6 Hard-halt conditions

- CI run is red after Commit 2 ships while local gates are green → a CI-vs-local environment divergence; surface and diagnose before Commit 3 (do not paper over with `continue-on-error`).
- The baseline-comparison logic passes when it should fail (e.g. a real new error slips under a too-loose comparison) — verify with a deliberate throwaway regression test before trusting it, or reason through the comparison explicitly.
- `pnpm build` fails in CI despite succeeding locally (missing env, path, memory) → surface; do not drop the build step to force green.
- Caching produces inconsistent run-to-run results → surface.

---

## §7 Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| CI environment differs from local (Node patch, locale, sandbox) producing spurious gate output. | Low–Med | Pin Node `20.20.2` exact (G4); the baseline comparison is count-based, tolerant of ordering noise. |
| `tsc` error **count** differs between CI and local (e.g. case-sensitive FS on Linux surfaces an import-casing error). | Low | The CI run already shows exactly the 51 — verified from run `26091440057`'s log; CI and local agree at 51. |
| Baseline-comparison step is itself buggy (grep pattern, pipefail) and silently passes. | Med | `set -o pipefail`; count with an explicit, tested `grep -c`; reason the logic through in the Commit-2 pause summary. The §6 halt covers a too-loose comparison. |
| `pnpm build` needs secrets. | Low | Verified — Vite tolerates unset `VITE_*`; built clean locally all of Step 12. |
| Future real regressions hide under the baseline if it is set as a ceiling and never ratcheted down. | Med | D-3 — the comparison fails on `>`, and emits a notice on `<` prompting a ratchet. When #15 lands, the baseline drops to 0 and the comparison becomes a strict `== 0`. |

---

## §8 Cross-references

- `audit.md` §5 roadmap row 13; §2 `CI (main)` line; §4 will gain the Step 13 entry.
- Issue **#11** (Get CI green).
- Issue **#15** — Phase-1 Supabase typed client; owns the 51 typecheck + 1 lint baseline. CI's baseline drops to 0/0 when #15 lands.
- `CLAUDE.md` — Node `>=20 <21`, `.nvmrc` `20.20.2`, pnpm 9.
- Step-8 notes file — CF-1…CF-18.

---

## §9 Carry-forward methodology

- **Applies:** CF-7 (push policy), CF-12 (measure gates in the committed end-state), CF-9 (pause-summary format).
- **New CF candidates Step 13 may surface:**
  - *Baseline-as-ceiling CI gating* — when a project carries accepted, deferred debt (a tracked typecheck/lint baseline), CI verifies "no regression past the committed baseline", not "exit 0". The baseline is a committed number; the gate fails on `>`, and the baseline ratchets down as debt is paid. Promote at Commit 3 if it reads as generally useful (it will recur whenever a cleanup phase hands off to CI before all debt is cleared).
  - *CI-vs-local parity discipline* — pin every tool version exactly (Node patch, pnpm via `packageManager`), because a floating version is a spurious-failure source. Likely an audit sub-note rather than a numbered CF.

---

## Numbered decisions — lock before Commit 2

1. **Typecheck + lint gating mechanism.** Recommend: **baseline-comparison, inline in the workflow** — each step runs the tool, counts errors, fails only if `count > baseline`. Baselines (`51`, `1`) inline in the `ci.yml` step as shell variables, with a comment pointing at #15. No separate script file (keeps it D4-minimal; the logic is ~3 lines of bash per step). **Confirm, or prefer a committed `ci-baseline.json` + a `scripts/` checker.**
2. **Lint specifically.** The 1 lint error *could* instead be killed outright with an `// eslint-disable-next-line import-x/no-unresolved` on the `supabase.ts` import (referencing #15) → `pnpm lint` exits 0 → CI lint needs no baseline wrapper. Recommend **against** — it hides the #15 debt marker the audit has tracked all phase, and typecheck needs the baseline wrapper anyway, so baseline-gating both is uniform and honest. **Confirm baseline-gate lint, or pick the disable.**
3. **Baseline ratchet policy.** Recommend: baseline is a **manually-maintained committed number**; the gate fails on `count > baseline`, and emits a CI **notice** (not failure) on `count < baseline` prompting a manual ratchet-down. No auto-rewrite of the baseline by CI (auto-commit-from-CI is fragile). **Confirm.**
4. **Add the build step** (`pnpm build`) to CI — the fourth gate. **Confirm.**
5. **Pin Node `20.20.2`** exact in `setup-node` (matches `.nvmrc`). **Confirm.**
