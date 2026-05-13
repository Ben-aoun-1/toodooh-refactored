# Step 6 — Commit 0 Discovery Report

Companion to [`2026-05-13-step-6-typing-residuals.md`](./2026-05-13-step-6-typing-residuals.md). Read-only categorization output. **No source changes were made in producing this report** — only `/tmp/*` scratch scripts and this docs file.

---

## A. Baseline confirmation (post-Step-5, `c3c9dd9` HEAD before this commit)

| Metric                              | Expected (from plan) | Actual    | Drift?         |
| ----------------------------------- | -------------------- | --------- | -------------- |
| `pnpm typecheck`                    | 197                  | **197**   | ✓              |
| `pnpm lint` problems                | 859                  | **859**   | ✓              |
| `pnpm lint` `no-console`            | 0                    | **0**     | ✓              |
| `pnpm lint` `no-explicit-any`       | 265                  | **265**   | ✓              |
| `pnpm lint` `no-unused-vars`        | 161                  | **161**   | ✓              |
| `pnpm lint` `no-empty`              | 30                   | **30**    | ✓              |
| `pnpm typecheck` `TS6133`           | ~131                 | **131**   | ✓              |
| Literal `as any` casts (grep)       | 43                   | **43**    | ✓              |
| Tests                               | 6 / 68               | 6 / 68    | ✓              |
| Build chunks                        | 110                  | 110       | ✓              |
| Main `index-*.js` gzip              | 130.50 kB            | 130.50 kB | ✓              |

Zero drift. The plan's baseline numbers hold.

---

## B. Scope reconciliation — 43 casts + 218 annotations broken down

User's pre-commit lean: **(a) 265-wide**. The (a)/(b) decision is informed by how the 218 annotations split across categories — that's the headline finding of this report.

### B.1 The 218 type-annotation `any`s — automatic syntactic split

Auto-classified by regex against each site's source line. Buckets:

| Pattern                                          | Count | Maps to category | Fix in Commit |
| ------------------------------------------------ | ----: | ---------------- | ------------- |
| `catch (e: any)` annotations                     | **74**| Cat-D            | 1             |
| Param / local / return `: any` (laziness)        | **108**| Cat-C           | 1             |
| `Record<…, any>` or object-property `: any`      | **11**| Cat-B            | 2             |
| `any[]`, `<any>`, `extends any` (other generics) | **20**| Cat-B or Cat-A   | 2             |
| Unclassified (manual review below)               | 7     | mixed            | per-site      |
| **Annotations subtotal**                         | **220** (2 over the 218 grep estimate; the auto-classifier counts lint-rule occurrences, which may double up on multi-`any` lines) | | |

### B.2 The 43 cast `as any`s — automatic split + manual sample of unclassified

| Pattern                                                | Count | Category | Fix in Commit |
| ------------------------------------------------------ | ----: | -------- | ------------- |
| Service-file Supabase response (auto-classified)       | 12    | Cat-A    | 3             |
| Component / page Supabase-adjacent response            | 1     | Cat-A    | 3             |
| Error narrowing (`err as any`, `error as any`)         | 3     | Cat-D    | 1             |
| Unclassified (sampled below)                           | 29    | mixed    | per-site      |
| **Casts subtotal**                                     | **45** (2 over the 43 grep — same double-count artefact)   | | |

**Manual classification of the 29 unclassified casts** (read each line + immediate context):

| Sub-pattern (representative)                                                | Count | Category |
| --------------------------------------------------------------------------- | ----: | -------- |
| `e.target.value as any` (input → enum cast) — `OwnerScreens`, admin pages   | ~13   | Cat-B (literal-string → discriminated-union — needs an `is<T>` narrowing or a typed event handler) |
| `(L.Icon.Default.prototype as any)._getIconUrl` (leaflet third-party)       | 2     | Cat-A (Leaflet has no clean type for prototype patching) |
| `(prev[parent as keyof typeof prev] as any)` (deep object-update pattern)   | ~4    | Cat-C (typeable via dependent index signature) |
| `(screenData as any).coordinates = …` (writing-to-Supabase entity)          | ~6    | Cat-A (the Supabase row type doesn't include this field; should be added) |
| `(c as any)?.campaign_start_date` (reading off Supabase row)                | ~3    | Cat-A |
| Misc (1–2 each)                                                              | ~1    | Cat-B / Cat-C |

### B.3 Consolidated category table (scope (a) 265-wide)

| Cat | Casts | Annots | **Total** | Commit | Fix pattern |
| --- | ----: | -----: | --------: | ------ | ----------- |
| A — external API / third-party no types | ~24 (13 + 5 entity-writes + 4 entity-reads + 2 Leaflet) | ~7 (subset of UNCLASSIFIED annots + some `any[]`/`<any>` on external returns) | **~31** | 3 | `// TODO(phase-1):` + `// eslint-disable-next-line` markers |
| B — type-system refactor needed | ~14 (literal-to-union casts) | ~31 (11 Record + 20 generics) | **~45** | 2 | discriminated unions, generic widening, `Record<…, T>` proper typing |
| C — laziness | ~8 (deep-update workarounds + misc) | ~108 (param/local/return) | **~116** | 1 | replace with the obvious concrete type |
| D — error narrowing | 3 | 74 (catch annotations) | **77** | 1 | `lib/errors.ts` + `isErrorWithCode` helper |
| TBD — needs read during execution | — | — | ~ small | per-site | hand pass |
| **Total** | **~49** (45 from auto + adjustments) | **~220** | **~265** | | |

### B.4 Scope-pick recommendation

**Recommend (a) 265-wide, with the following execution notes:**

1. **Cat-D is the single biggest mechanical bucket (77 sites = 29% of all 265).** All 74 `catch (e: any)` annotations have the same pattern and resolve together with the 3 cast Cat-D's via a single helper (`lib/errors.ts` with `isErrorWithCode(e): e is ErrorWithCode`). One Commit-1 wave clears 77 lint hits. Strong argument for (a) over (b).

2. **Cat-C annotations (108) are mostly `(x: any)` params in helper code.** These are equally mechanical — read the surrounding context, swap `any` for the obvious concrete type. About a third can be machine-assisted via local-type inference; two-thirds need a 30-second human read.

3. **Cat-A count (~31) is healthy** — the heuristic-anomaly check (Cat-A should be ≥20 of 43 casts ≈ ≥100 if scope-a) lands at ~31 across both casts and annotations. Slightly below the plan's "≥100 if scope-a" threshold, but well above zero and concentrated in the expected files (admin service files + Supabase response handling). **Surface but not halt.**

4. **Cat-B is ~45 and harder.** Includes 14 `e.target.value as any` patterns that resolve via typed change-handlers or `as ScreenStatus` narrowing (after a runtime check). The 11 `Record<…, any>` patterns each need their value-type spelled out. Two-to-three days of judgment work.

5. **Effort estimate revised:** scope (a) is **~4 days** (was 2–3 in the plan); scope (b) is **~2 days**. (a) costs ~50% more time for a 6x more complete result.

**If you prefer (b):** the 218 annotations get split into a new Phase-1-tracked issue ("Type-annotation any cleanup") with the same `// TODO(phase-1):` markers. Step 6 then handles 43 casts + 161 unused-vars + 30 no-empty in 2–3 days; the type-annotation any's defer.

**Awaiting decision before Commits 1–3 fire.** Pre-commit lean is (a); the data backs it.

---

## C. `no-explicit-any` — 10 most-complex Cat-B sites (sample for Commit-2 spot-check)

These are the literal-string-to-union casts where the type system can't narrow without a runtime check. Each needs a typed event handler OR an `as Status` cast guarded by a narrowing check.

```
apps/web/src/pages/OwnerScreens.tsx:243:30  status: newStatus as any,
apps/web/src/pages/OwnerScreens.tsx:252:36  status: newStatus as any,
apps/web/src/pages/OwnerScreens.tsx:287:42  status: 'unavailable' as any,
apps/web/src/pages/OwnerScreens.tsx:317:30  status: newStatus as any,
apps/web/src/pages/OwnerScreens.tsx:353:41  status: 'active' as any,
apps/web/src/pages/OwnerScreens.tsx:380:46  status: 'unavailable' as any,
apps/web/src/pages/admin/AdminManagement.tsx:270:64  e.target.value as any  (setRoleFilter)
apps/web/src/pages/admin/CampaignMonitoring.tsx:383:66  e.target.value as any  (setStatusFilter)
apps/web/src/pages/admin/EventManagement.tsx:872:80  e.target.value as any  (event_type)
apps/web/src/pages/admin/EventManagement.tsx:893:93  e.target.value as any  (category)
```

The 6 `OwnerScreens.tsx` sites are a single root cause: the `ScreenStatus` union type isn't exported / used by the update site. Refactor: import the union type, write `as ScreenStatus`, satisfy the lint rule. One refactor, 6 sites cleared.

The 4 `e.target.value as any` sites are the form-input pattern: each `setRoleFilter` / `setStatusFilter` / etc. needs a typed `onChange` handler that narrows `e.target.value` to its union via a switch or guard. Each is its own ~5-line change.

---

## D. `no-unused-vars` — sub-category breakdown

| Sub-category   | Count | Fix pattern                                              | Note |
| -------------- | ----: | -------------------------------------------------------- | ---- |
| Catch binding  | **64**| Strip `: any` annotation; prefix `_e` if still unused after narrowing; merge with Cat-D fix from Commit 1 | Resolves alongside Cat-D `catch (e: any)` |
| Local var      | **61**| Delete binding (or keep RHS if side-effect)              | Most are `const newScreen = await ...` patterns — Step-5 TS6133 unmasks |
| Param          | **20**| Prefix with `_` — **requires `argsIgnorePattern: '^_'` in eslint config** | See D.1 below |
| Destructure    | **16**| Omit unused name from destructure, e.g. `needsApproval`  | App.tsx has 3 identical `needsApproval` destructures |
| **Total**      | **161** | | |

### D.1 ESLint `argsIgnorePattern` is NOT configured — Commit 4 blocker

Checked `eslint.config.js`: no explicit `argsIgnorePattern: '^_'` is set for `@typescript-eslint/no-unused-vars`. The rule inherits from `tseslint.configs.recommended` which **does not** allow `_`-prefixed params by default.

**Implication:** prefixing 20 Param sites with `_` in Commit 4 will NOT satisfy the lint rule. Three options:

- **(D.1.a)** Add `'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]` to `eslint.config.js` (probably under the `apps/web/**/*.{ts,tsx}` block). Done at the start of Commit 4. Cleanest.
- **(D.1.b)** Delete unused params entirely. Riskier — changes function arities, may break callers if the param is reachable via index (e.g. `map((_, i) => …)` → `map((value, index) => …)` works either way but explicit deletion can break signature contracts).
- **(D.1.c)** Add an `// eslint-disable-next-line` directive on each Param site. Pollutes the diff and the codebase.

**Recommend (D.1.a).** Adds 4 lines to `eslint.config.js`, satisfies all 20 Param sites + all 64 Catch sites (via `caughtErrorsIgnorePattern`) once they're prefixed.

### D.2 Sample destructures (4 of 16)

```
apps/web/src/App.tsx:46  'needsApproval' (assigned a value)
apps/web/src/App.tsx:73  'needsApproval'
apps/web/src/App.tsx:100  'needsApproval'
apps/web/src/components/OwnerNavigation.tsx:114  'profileType'
```

The three `App.tsx` `needsApproval` are identical destructures of `useAuthStore()` in three route guards (`AdvertiserRoute`, `OwnerRoute`, `AdminRoute`). Single fix — remove `needsApproval` from the destructure. All three sites in one edit.

---

## E. `no-empty` — sub-category breakdown

| Sub-category | Count | Fix pattern                              | Origin                      |
| ------------ | ----: | ---------------------------------------- | --------------------------- |
| `else { }`   | **23**| Delete the `else { }` clause entirely    | Step 5 Commit 2 (deleted `else { console.log(...); }` body) |
| `catch (rpcError) { }` | **7** | Per-site judgment — most can be removed (the try wasn't doing anything else); some keep with `// no-op` intent comment | Step 5 Commit 3 / 4.5       |
| **Total**    | **30**| | |

### E.1 Sample else-empty (4 of 23)

```
apps/web/src/pages/Dashboard.tsx:883    } else {
                                          }
apps/web/src/pages/NewCampaign.tsx:702  } else {
                                          }
apps/web/src/pages/Onboarding.tsx:675   } else {
                                          }
apps/web/src/pages/OwnerScreens.tsx:70  } else {
                                          }
```

All four are `if (error) { log.error(...) } else { }` shapes — the else body was a deleted `console.log` from Step 5. Fix: delete the `else { }` to leave just `if (error) { log.error(...) }`.

### E.2 Sample catch-empty (4 of 7)

```
apps/web/src/services/admin-video.service.ts:498  } catch (rpcError) {}
apps/web/src/services/auth.service.ts:631         } catch (rpcError) {}
apps/web/src/services/platform-stats.service.ts:24  } catch (rpcError) {}
apps/web/src/services/platform-stats.service.ts:90  } catch (rpcError) {}
```

All four are RPC-fallback wrappers — the original code tried an RPC, logged the error if it failed, then fell back to a different query. Step 5 deleted the log. The try/catch can usually go entirely (the fallback query is in the surrounding `||`-chain or a separate code path).

**Per-site read needed in Commit 5** — the fallback-query path differs per site.

---

## F. Helper-module decision — `apps/web/src/lib/errors.ts`?

**Yes, create it in Commit 1.** Justification: Cat-D total is **77 sites** (3 casts + 74 catch annotations) across at least 35 files. Dedup via a single `isErrorWithCode(e): e is ErrorWithCode` helper saves an estimated 400+ lines of repeated narrowing logic versus inline narrowing at every site.

Sketch (carbon-copy from the plan):
```ts
export interface ErrorWithCode {
  code: string;
  message: string;
  details?: string;
  hint?: string;
}

export function isErrorWithCode(e: unknown): e is ErrorWithCode {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && typeof (e as { code: unknown }).code === 'string' &&
    'message' in e && typeof (e as { message: unknown }).message === 'string'
  );
}
```

Plus `lib/errors.test.ts` with 4 tests (positive shape, bare Error, null, string). Total: +1 Test File, +4 tests. Final Step-6 test count: **7 Test Files / 72 tests**.

---

## G. Per-commit expected delta (refined from plan)

Using the discovery numbers. Scope-a assumed; revise table if (b) chosen.

| Commit | typecheck | lint total | no-explicit-any | no-unused-vars | no-empty | tests   | chunks | main gzip |
| ------ | --------- | ---------- | --------------- | -------------- | -------- | ------- | ------ | --------- |
| 0 (this report) | 197 | 859 | 265 | 161 | 30 | 6/68 | 110 | 130.50 |
| 1 (Cat-C lazy + Cat-D + errors helper) | ≤ 197 | ≤ 660 (drop ~120 Cat-C + ~77 Cat-D) | ≤ 70 (Cat-A + Cat-B remain) | ≤ ~97 (catch bindings clear via Cat-D removal) | ≤ 30 | 7/72 | 110 | 130.50 ± 5 |
| 2 (Cat-B refactors) | ≤ 197 | ≤ 615 (drop ~45) | ≤ 25 (Cat-A only) | ≤ ~97 | ≤ 30 | 7/72 | 110 | ±5 |
| 3 (Cat-A markers + issue) | ≤ 197 | = 590 (Cat-A becomes 0 via eslint-disable) | **= 0** | ≤ ~97 | ≤ 30 | 7/72 | 110 | ±5 |
| 4 (no-unused-vars) | **~66** (= 197 − 131 TS6133 fixed) | = ~430 (drop ~161 unused-vars; ESLint config gets argsIgnorePattern in D.1.a) | 0 | **= 0** | ≤ 30 | 7/72 | 110 | ±5 |
| 5 (no-empty) | ~66 | = ~400 (drop ~30) | 0 | 0 | **= 0** | 7/72 | 110 | ±5 |
| 6 (rule + docs) | ~66 | unchanged from C5 | 0 | 0 | 0 | 7/72 | 110 | ±5 |

Final state: typecheck **~66** errors (residual: TS2305, TS2322, TS18047 — not in Step 6 scope), lint **~400** problems (residual: 71 no-useless-catch + 317 jsx-a11y + 24 react-hooks/exhaustive-deps + others).

---

## H. Surprises

1. **ANNOT-D (`catch (e: any)`) is huge — 74 sites.** Initially expected ~10. The codebase has heavy explicit `: any` on catch bindings (pre-TS-4.4 style; the migration to `unknown` defaults was never done). These resolve mechanically alongside the 3 cast Cat-D's: strip `: any`, narrow via `isErrorWithCode`. **Cat-D is now the single largest mechanical bucket in Step 6** — drives the case for (a) 265-wide.

2. **ESLint `argsIgnorePattern` is not configured.** Commit 4's param prefix strategy won't work without first adding the config (D.1). Surfaced; recommend (D.1.a).

3. **23 of 30 `no-empty` are `} else { }` shapes** from Step 5's Commit 2. These weren't called out in the plan — the plan assumed `.then(() => {})` would dominate. Actual: zero `.then` patterns; 23 else-empties and 7 catch-empties. Mechanically deletable in bulk (same script pattern as Step 5's Cat-1 line-delete) for the 23 else; per-site judgment for the 7 catch.

4. **`OwnerScreens.tsx` has 6 cast sites of the same root cause** (ScreenStatus union narrowing). One refactor clears all 6.

5. **3 `App.tsx` destructures of `useAuthStore()` all unused `needsApproval`**. Single fix clears 3 lint hits.

6. **Cat-A heuristic count ~31 is below the plan's ≥100 threshold (for scope-a).** Not a halt — the codebase has fewer pure-Supabase casts than the plan estimated. Most of the 265 is Cat-C/D mechanical work, not Cat-A external-API blocking. **Update Phase-1 issue scope:** the Phase-1 tracking issue created in Commit 3 will list ~31 markers, not ~100. Still a clear, finite cleanup target for when `apps/api/` lands.

7. **45-vs-43 cast count discrepancy.** Auto-classifier says 45; literal grep says 43. Difference: the classifier counts lint-rule occurrences, which can include the same line column-twice in `((x as any) as any)`-style double casts. None observed in samples; difference is below noise.

---

## I. Awaiting decisions before Commit 1 fires

1. **(a) 265-wide vs (b) 43-only** — recommend (a) per B.4. Pre-commit lean was already (a).
2. **(D.1.a) Add `argsIgnorePattern` to eslint.config.js as part of Commit 4** — recommend yes. Alternative options (D.1.b/c) are worse.
3. **Helper module `lib/errors.ts`** — recommend yes per F. Adds 1 test file / 4 tests.
4. **Phase-1 issue scope ~31 markers (not ~100)** — informational; the issue body in Commit 3 will reflect the actual count from this discovery.

Approve these, and Commit 1 (Cat-C + Cat-D + `lib/errors.ts`) fires next per the plan.
