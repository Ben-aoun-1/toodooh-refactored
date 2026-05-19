# Step 14 — Hoist duplicate devDependencies to root (Issue #13)

_Plan doc. Written 2026-05-19 at baseline `91a427a` (Step 13 closed)._
_The cleanup phase's final step — after it lands, all 14 audit rows are ☑._

---

## §0 Pre-flight verification

- **Baseline commit:** `91a427a` — Step 13 (CI green) closed.
- **Working tree:** clean.
- **Gates (fresh at `91a427a`):** typecheck **51** · lint **1** (1e/0w) · test **160** · build main `index` gzip **139.80 kB** · **236** `.ts`/`.tsx` under `apps/web/src/` · **CI green** on `main`.
- **Audit:** roadmap row 14 (`Hoist duplicate devDependencies`, #13) is `☐`.
- **Workspace:** `pnpm-workspace.yaml` globs `apps/*` + `packages/*`; only `apps/web` exists → **2 importers** (root `.` + `apps/web`).

---

## §1 Locked constraints

- **Cleanup-phase contract:** no UI/UX change. Step 14 is `package.json` infrastructure only.
- **D4 (wrap-don't-restructure):** edit the existing `package.json` files in place; do not restructure the workspace.
- **Lockfile integrity:** `pnpm-lock.yaml` must regenerate cleanly via `pnpm install` — no version drift, no downgrades.
- All gates stay flat or improve; CI green on every pushed commit.
- CF-1…CF-18 + the Step-13 CI-gating discipline notes apply.

---

## §2 Inventory

### Root `package.json` — 14 devDependencies

`@eslint/js ^9.17.0` · `eslint ^9.17.0` · `eslint-config-prettier ^9.1.0` · `eslint-import-resolver-typescript ^4.4.4` · `eslint-plugin-import-x ^4.6.1` · `eslint-plugin-jsx-a11y ^6.10.2` · `eslint-plugin-react-hooks ^5.1.0` · `eslint-plugin-unused-imports ^4.4.1` · `globals ^15.14.0` · `husky ^9.1.7` · `lint-staged ^15.3.0` · `prettier ^3.4.2` · `typescript ^5.7.2` · `typescript-eslint ^8.19.0`.

All 14 are workspace-agnostic monorepo tooling (the root ESLint flat config + Prettier + Husky/lint-staged + TypeScript). All KEEP-IN-ROOT — no change.

### `apps/web/package.json` — 18 devDependencies, classified

| Dep | apps/web | root | Class |
| --- | --- | --- | --- |
| `@eslint/js` | ^9.9.1 | ^9.17.0 | **HOIST** |
| `eslint` | ^9.9.1 | ^9.17.0 | **HOIST** |
| `eslint-plugin-react-hooks` | ^5.1.0-rc.0 | ^5.1.0 | **HOIST** |
| `globals` | ^15.9.0 | ^15.14.0 | **HOIST** |
| `typescript` | ^5.5.3 | ^5.7.2 | **HOIST** |
| `typescript-eslint` | ^8.3.0 | ^8.19.0 | **HOIST** |
| `eslint-plugin-react-refresh` | ^0.4.11 | — | **REMOVE** (dead) |
| `@tanstack/react-query-devtools` | ^5.100.10 | — | KEEP-IN-WORKSPACE |
| `@types/react` | ^18.3.5 | — | KEEP-IN-WORKSPACE |
| `@types/react-datepicker` | ^6.0.1 | — | KEEP-IN-WORKSPACE |
| `@types/react-dom` | ^18.3.0 | — | KEEP-IN-WORKSPACE |
| `@vitejs/plugin-react` | ^4.3.1 | — | KEEP-IN-WORKSPACE |
| `autoprefixer` | ^10.4.18 | — | KEEP-IN-WORKSPACE |
| `postcss` | ^8.4.35 | — | KEEP-IN-WORKSPACE |
| `supabase` | ^1.145.4 | — | KEEP-IN-WORKSPACE |
| `tailwindcss` | ^3.4.1 | — | KEEP-IN-WORKSPACE |
| `vite` | ^7.0.0 | — | KEEP-IN-WORKSPACE |
| `vitest` | ^3.2.0 | — | KEEP-IN-WORKSPACE |

**6 HOIST · 1 REMOVE · 11 KEEP-IN-WORKSPACE.** Result: `apps/web` devDeps `18 → 11`; root unchanged.

### The version "drift" is apparent-only — no reconciliation decision

All 6 duplicates show `apps/web` carrying an *older* range than root — a partial-migration artifact (Step 8 added the root ESLint config + its deps; the pre-monorepo `apps/web` copies were never pruned; Step-12's partial-migration meta-note in action). **But the lockfile already dedupes both importers to one identical installed version** — verified from `pnpm-lock.yaml`:

| Dep | root spec → resolved | apps/web spec → resolved |
| --- | --- | --- |
| `@eslint/js` | `^9.17.0` → `9.39.4` | `^9.9.1` → `9.39.4` |
| `eslint` | `^9.17.0` → `9.39.4` | `^9.9.1` → `9.39.4` |
| `eslint-plugin-react-hooks` | `^5.1.0` → `5.2.0` | `^5.1.0-rc.0` → `5.2.0` |
| `globals` | `^15.14.0` → `15.15.0` | `^15.9.0` → `15.15.0` |
| `typescript` | `^5.7.2` → `5.9.3` | `^5.5.3` → `5.9.3` |
| `typescript-eslint` | `^8.19.0` → `8.59.2` | `^8.3.0` → `8.59.2` |

Both importers point at the same node in the store. **Removing the `apps/web` declarations changes no resolved version** — root's range was already the binding constraint, and root keeps it. So "version-reconcile" collapses to a plain HOIST (delete the `apps/web` lines); there is **no "which version wins" decision** to make. Root needs **no edit** — it already declares all 6 at the newer range.

### `eslint-plugin-react-refresh` — confirmed dead

Its only occurrence in the repo (excluding `node_modules` / `pnpm-lock.yaml`) is its own declaration line in `apps/web/package.json`. `eslint.config.js` does not import or reference it (the root flat config imports `@eslint/js`, `eslint-config-prettier`, `eslint-import-resolver-typescript`, `eslint-plugin-import-x`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`, `eslint-plugin-unused-imports`, `globals`, `typescript-eslint` — not `react-refresh`). **0 consumers → REMOVE.**

### CF-18 axis checks

- **Axis 1 (neighbourhood):** scanned both lists for aliased/forked duplicates (`@types/X` shadowing an `X`, range-overlap variants) — none. The 6 are exact-name duplicates.
- **Axis 2 (representation):** lockfile resolution vs declared ranges — checked above; the lockfile dedupes cleanly, no hidden second resolution.
- **Axis 3 (source/target):** N/A — Step 14 is not a migration.

---

## §3 Commit factoring

| Commit | Scope |
| --- | --- |
| **1** | Plan doc (this commit). |
| **2** | Delete the 6 HOIST + 1 REMOVE lines from `apps/web/package.json` `devDependencies` (18 → 11); run `pnpm install --frozen-lockfile=false` to regenerate `pnpm-lock.yaml`; `pnpm-lock.yaml` is staged in the same commit. Root `package.json` untouched. |
| **3** | Audit refresh (§2 `Files`/devDep note, §5 row 14 ☑), close #13, **cleanup-phase close-out** (§9). |

3 commits — no separate lockfile commit (the regen is part of Commit 2; the lockfile delta is small — one importer block loses 7 entries, no version nodes change).

---

## §4 Per-commit verification gates

Commit 2 changes only `package.json` + `pnpm-lock.yaml` — **no source change**, so:

- typecheck **= 51** · lint **= 1** · test **= 160** · build main gzip **139.80 ± 0.5 kB** · file count **= 236** (`package.json` is not a `.ts`/`.tsx` file).
- **`pnpm install` resolves with no errors/warnings**; `pnpm-lock.yaml` diff = the `apps/web` importer losing 7 devDep lines, **zero version-node changes** (verified resolution-identical in §2).
- All four workspace tools (`typecheck`/`lint`/`test`/`build`) run exactly as pre-hoist — `apps/web` now resolves `typescript`/`eslint`/etc. from root via pnpm's upward `node_modules` resolution.
- **CI green** on the Commit-2 push (load-bearing).

---

## §5 Standing operating procedure

- **CF-7 amendment** — config commits push in the gate-sweep flow; **verify CI green on each push** (`gh run watch`, headSha-checked per the Step-13 discipline).
- The Commit-2 message names the 6 hoisted + 1 removed deps explicitly, and summarizes the lockfile diff (importer-block shrink, 0 version changes).
- Truncation safeguards per the established pattern.
- Pause summary surfaces: which devDeps moved, the (apparent-only) drift, the lockfile diff.

---

## §6 Hard-halt conditions

- `pnpm install` fails or warns after the edit → workspace-resolution issue; surface.
- A gate green pre-hoist goes red post-hoist → a "duplicate" wasn't truly resolvable from root, or the hoist broke a tool's dependency lookup; surface.
- `pnpm-lock.yaml` regen shows a **version change** (any node moved) → unexpected; the §2 analysis predicted zero — halt and diagnose.
- CI red on a pushed commit → diagnose per the Step-13 headSha-verification discipline.
- `eslint-plugin-react-refresh` removal breaks something → would mean a consumer the grep missed; halt, classify per CF-18.

---

## §7 Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| `apps/web` tooling (`tsc`, `eslint`, `vitest`) can't resolve a hoisted dep from root. | Low | pnpm hoists root devDeps to the root store; workspace packages resolve upward. Standard monorepo behaviour. §4's "all 4 gates still green" + CI verify it. |
| Version drift is *deliberate* pinning, not accident. | Very low | The drift is uniformly "apps/web older" and the lockfile already dedupes both to one version — it is leftover, not intent. No pin is being overridden. |
| `pnpm-lock.yaml` regen reshuffles unrelated nodes. | Low | Removing a duplicate declaration where the other importer keeps the binding range produces a minimal diff; §6 halts on any version-node move. |
| `eslint-plugin-react-refresh` has a non-grep-visible consumer (a future Vite HMR config). | Very low | It is a Vite-HMR ESLint plugin; the project's ESLint config is the only place it could plug in, and that config doesn't reference it. Confirmed 0 consumers. |

---

## §8 Cross-references

- `audit.md` §5 roadmap row 14; §2 will note the devDep count; §4 gains the Step 14 entry.
- Issue **#13**.
- `CLAUDE.md` — pnpm `9.x` (`packageManager: pnpm@9.15.4`).
- Step-8 notes file — CF-1…CF-18 + the Step-13 CI-gating discipline section.
- **Step-12 partial-migration meta-note** — *applies directly*: the 6 drifted duplicates are exactly such an artifact (Step-8 monorepo restructure added root tooling; the pre-monorepo `apps/web` copies were never pruned). Step 14 closes that specific artifact.

---

## §9 Carry-forward methodology + cleanup-phase close-out

Commit 3's audit refresh is also the **cleanup-phase close-out**. It will include:

- **Cleanup-phase closing summary** — the 14 steps: audit/roadmap (1) → duplicate-page/service deletion (2a/2b) → auth-state consolidation (3) → DOOH-engine decouple + v3 pricing (4) → logger/`console` purge (5) → typing pass (6) → Dashboard/NewCampaign decomposition (7) → `features/<domain>/` restructure (8) → `window.location.reload()` removal (9) → React Query (10) → `jsx-a11y`/`exhaustive-deps` (11) → brand token + refresh (12) → CI green (13) → devDep hoist (14). Net structural outcome stated plainly.
- **CF-1…CF-18 + Step-13 notes consolidation statement** — these are the operating manual for structurally-similar Phase-1 work; pointer to the Step-8 notes file as the canonical home.
- **Standing TBD list** — `TBD-A…TBD-T` (the cleanup-phase follow-up issues): which are open, which are Phase-1 prerequisites (notably **#15** — the Supabase typed client, which owns the typecheck-51 / lint-1 baselines and the CI baseline constants), which are deferred. Enumerated from `gh issue list` at Commit 3.
- **Phase-1 entry conditions** — the cleanup phase ends when row 14 is ☑; Phase 1 (backend migration / auth rewrite / Supabase typed client) begins with its own brainstorm → spec → plan cycle. CI is green, gates are at their accepted floor (typecheck 51, lint 1 — both #15), the frontend is restructured and tokenized.

**New CF candidates from Step 14** — likely none worth a number; the step is small and the methodology (lockfile-vs-declared reconciliation, workspace-vs-root classification) is adequately covered by the §2 inventory discipline and CF-18's representation axis. Commit 3 decides; default is no new CF.
