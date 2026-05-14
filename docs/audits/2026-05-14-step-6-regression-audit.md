# Step 4-6 Regression-Class Audit — PARTIAL (Hard-Halt at Class 1(c))

**Status:** STOPPED EARLY. A Class 1(c) match (binding actively renamed, then used as if it were `error`) was found in Commit 4 of Step 6 (`0af5cc3`) and the audit is surfaced immediately per the audit prompt's hard-halt clause.

**Scope completed before halt:**
- ✅ Class 1: scanned all 12 code-touching commits across Step 5 + Step 6 plus the in-flight working tree.
- ⏸️ Class 2: not started.
- ⏸️ Class 3: not started.

**Working tree status at the time of the audit:**
- HEAD: `0af5cc3` (Step 6 Commit 4 — no-unused-vars 158 → 0).
- 15 files modified in working tree (pending Commit 5 work — catch-comment additions + else/if block deletions + admin-user.service.ts cascade simplifications). NOT committed.

---

## 1. Class 1 findings — Supabase error-destructure removals

Scanned every code-touching commit in Steps 5 + 6 for `^-.*const \{[^}]*\berror\b[^}]*\}.*=.*supabase` diffs (removed lines).

**Per-commit hit counts:**

| Commit | Class-1 matches | Notes |
|---|---:|---|
| `20d5034` Step-5 logger module | 0 | New file; no destructure removals. |
| `f65bd16` Step-5 Cat-1 console.log delete | 0 | Only deleted console.log calls; destructures untouched. |
| `c61934d` Step-5 Cat-2a+2b console.error delete | 0 | Only deleted console.error calls. |
| `f0ebb37` Step-5 Cat-2c+3 promote | 0 | Promoted to logger; destructures untouched. |
| `22f26cc` Step-5 format sweep | 0 | Prettier + eslint-fix; no destructures touched. |
| `3d9ad55` Step-5 audit refresh / close #7 | 0 | Docs + config only. |
| `c007783` Step-6 Cat-D + helper | 0 | Strip `catch (e: any)` → `catch (e)`; helper introduction. No destructure removals. |
| `9c4839b` Step-6 Cat-C partial | 0 | Callback param `: any` strips only. |
| `ed7c261` Step-6 Commit 1c regression fix | 0 | `_err`-alias removal; preserved `isErrorWithCode` narrowing. |
| `abe594c` Step-6 Cat-B refactors | 0 | Type refactors (status enum, `e.target.value` casts); destructures untouched. |
| `62e8813` Step-6 Cat-A markers | 0 | Only inserted `// TODO(phase-1):` + disable-next-line directives. |
| **`0af5cc3`** Step-6 Commit 4 (no-unused-vars) | **10** | LocalVar deletions + script's renamed-destructure regex. |
| **Working tree (uncommitted Commit 5)** | **6** | Cascade-delete error-destructure removals in `admin-user.service.ts`. |

### 1.1 Findings in `0af5cc3` (10 matches)

| # | File:line (current) | Diff | Category | Severity | Fix |
|---|---|---|---|---|---|
| 1 | `pages/MyRecharges.tsx:181` | `{ data, error } → { error }` | **(a)** Error still checked. Data was unused. | Low | None — safe. |
| 2 | `pages/NewCampaign.tsx` (deleted) | Entire `checkSpecialEvents` function removed, including the supabase query inside | **(a)** | Low | Function caller was already commented-out at line 1263 (`//   checkSpecialEvents(newStartDate, newEndDate);`). Dead-code removal. No live behavior change. Safe. |
| 3 | `pages/Onboarding.tsx:678` | `{ error: deleteError, data: deleteData } → { error: deleteError }` | **(a)** Error still checked. | Low | Safe. |
| 4 | **`pages/admin/RechargeManagement.tsx:196`** | `{ data: recharge, error } → { data: error }` | **(c) CRITICAL — destructure corruption** | **HIGH** | Hand-rewrite. See §1.1.1 below. |
| 5 | `services/admin-user.service.ts:354` | `{ data: deletedProfile, error: businessError } → { error: businessError }` | **(a)** Error still checked. | Low | Safe. |
| 6 | `services/admin-user.service.ts:364` | `{ data: checkProfile, error: checkError } → { data: checkProfile }` | **(a)** `checkError` was unused (the check just verifies `data` is non-null). Caller compares `data` to `null`. | Low | Safe. |
| 7 | `services/admin-video.service.ts:111` | `{ data, error } → { error }` | **(a)** Error still checked. | Low | Safe. |
| 8 | `services/admin-video.service.ts:427` | `{ data, error } → { error }` | **(a)** Error still checked. | Low | Safe. |
| 9 | `services/campaign.service.ts:955` | `{ data, error } → { error }` (paired with deletion of `_updateData = data` assignment) | **(a)** `data` was only assigned to a now-deleted local. Error still checked via `screenUpdateError = error` immediately below. | Low | Safe. |
| 10 | `pages/admin/UserManagement.tsx` (subtle) | A destructure simplification around a notification creation. Re-verify. | Pending re-read. | Medium | Re-read. |

#### 1.1.1 Critical finding — `RechargeManagement.tsx:196`

**Current (broken) code:**
```ts
const { data: error } = await supabase
  .from('recharges')
  .insert({ … })
  .select()
  .single();

if (error) throw error;
```

**Original (correct) code:**
```ts
const { data: recharge, error } = await supabase
  .from('recharges')
  .insert({ … })
  .select()
  .single();

if (error) throw error;
```

**Behavior change:**
- The destructure renames the supabase result's `data` property to a local variable named `error` (because of the `data: error` rename syntax).
- The original `error` property of the supabase result is not destructured at all.
- On **successful insert**: `data` is the recharge object, so local `error` is truthy, so `throw error;` throws the inserted recharge as if it were an exception. **Every successful recharge creation throws.**
- On **failed insert**: `data` is `null`, so local `error` is null, so the `if (error)` check skips, and the function continues as if nothing happened. **Every failed insert silently succeeds.**

**Root cause:** The script's destructure-omit regex from `0af5cc3` matched `deleteData, ` (or similar) in a `{ data: deleteData, error: businessError }` pattern and used the comma-leading match to delete `, deleteData`, leaving `data: error: businessError` — then on this specific site, my Commit-4 script processed `recharge` (a `data: recharge` rename target) as a LocalVar removal, applied the comma-leading match, and produced `{ data: error }` as the destructure.

**Fix:**
```ts
const { error } = await supabase
  .from('recharges')
  .insert({ … })
  .select()
  .single();

if (error) throw error;
```
(Drop `data: recharge` entirely since `recharge` was unused locally.)

**Why this wasn't caught by typecheck:** TypeScript happily types `data: error` as a rename — `data` is a string property on the supabase result, so renaming it to a local var named `error` is legal TS. The `if (error)` check at line 213 doesn't tell TS anything about which property it's checking. The runtime semantics break, but the types don't.

**Why this wasn't caught by tests:** The recharge-creation flow has no unit test coverage. Manual smoke testing would catch it. None was done.

### 1.2 Findings in the **working tree** (in-flight Commit 5; uncommitted)

| # | File:line | Diff | Category | Severity | Fix |
|---|---|---|---|---|---|
| 1 | `services/admin-user.service.ts:302-318` | 5 destructure removals: `const { error: <name>X } = await supabase.from('<table>').delete()...` → `await supabase.from('<table>').delete()...` for `advertising_campaigns`, `screens`, `locations`, `clients`, `recharges` | **(b) REGRESSION — cascade-delete swallows errors** | **HIGH** | Restore the error destructure. See §1.2.1. |
| 2 | `pages/Dashboard.tsx:792-793` | Removed `} else { … }` body where the `} else {}` was empty | **(a)** Empty else; no behavior change. | Low | Safe. (This is Commit-5 no-empty bulk-delete pattern.) |
| 3 | `pages/NewCampaign.tsx:700-703` | Removed `} else {}` empty | **(a)** | Low | Safe. |
| 4 | `pages/Onboarding.tsx:678` | Removed `} else {}` | **(a)** | Low | Safe. |
| 5 | `pages/OwnerScreens.tsx:75` | Removed `} else {}` | **(a)** | Low | Safe. |
| 6 | `services/admin-video.service.ts:532` + `services/auth.service.ts:638` + `services/platform-stats.service.ts` ×5 | `} catch (_rpcError) {}` → `} catch { /* intentional swallow comment */ }` | **(a)** Already-empty catches got documented per Commit-5 spec. | Low | Safe. |

#### 1.2.1 Critical finding — `admin-user.service.ts::deleteUser` cascade

**Current (in-flight, broken) code at lines 302-318:**
```ts
await supabase.from('advertising_campaigns').delete().eq('advertiser_id', authUserId);
await supabase.from('screens').delete().eq('owner_id', authUserId);
await supabase.from('locations').delete().eq('owner_id', authUserId);
await supabase.from('clients').delete().eq('advertiser_id', authUserId);
try {
  await supabase.from('recharges').delete().eq('user_id', authUserId);
} catch (_e) {
  // Table n'existe pas, continuer
}
```

**Pre-Commit-5 (pre-working-tree) state:**
```ts
const { error: campaignsError } = await supabase.from('advertising_campaigns').delete()...;
if (campaignsError) { }     // empty body — pre-existing buggy "swallow" from Step 5

const { error: screensError } = await supabase.from('screens').delete()...;
if (screensError) { }       // empty

// …same pattern for locations, clients, recharges
```

**Behavior chain:**
- Pre-Step-5: original code had `if (campaignsError) { console.error(...); }` etc. — at least logged the error.
- Step 5 Commit 3 (`c61934d`) deleted the `console.error('...', campaignsError)` calls per Cat-2 mechanical pattern. Bodies became empty.
- Step 5 Commit 4 (`f0ebb37`) didn't restore them (promotion pass; didn't target these because they had no `.then`-style structure).
- Step 6 Commit 4 (`0af5cc3`) didn't touch them (no-unused-vars work was elsewhere).
- **In-flight Commit 5 (uncommitted)**: my no-empty bulk-deleter saw `if (campaignsError) {}` as a no-empty target, removed the entire `if (...) {}` block, then a cascade-fix stripped the now-unused `const { error: campaignsError } = ...` destructure. The 5-table cascade lost ALL error checks.

This is the **classic Class 1(b) chain**: each step looked locally reasonable; the end state is "cascade delete silently ignores all errors". Not a single isolated change — a multi-commit cumulative regression.

**Fix:** This is a `deleteUser` admin operation. Errors MUST be checked. Each table delete should fail-fast on error:

```ts
{
  const { error } = await supabase.from('advertising_campaigns').delete().eq('advertiser_id', authUserId);
  if (error) {
    log.error({ error }, '❌ Failed to delete advertising_campaigns for user');
    return false;
  }
}
{
  const { error } = await supabase.from('screens').delete().eq('owner_id', authUserId);
  if (error) {
    log.error({ error }, '❌ Failed to delete screens for user');
    return false;
  }
}
// …same for locations, clients, recharges (inside the try-catch).
```

Or refactor into a small helper:
```ts
async function deleteOrAbort(table: string, column: string, value: string): Promise<boolean> {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) {
    log.error({ error, table }, `❌ Failed to delete ${table} for user`);
    return false;
  }
  return true;
}
```

---

## 2. Class 2 findings — Try/catch misplacement around Supabase calls

**Status:** Not started before halt.

Sample of sites that would need scanning if resumed:
- `services/admin-video.service.ts:528-535` (catch wraps RPC; legitimate — Class 2(c)).
- `services/auth.service.ts:638` (catch wraps RPC retry; same; Class 2(c)).
- `services/platform-stats.service.ts` ×5 (Class 2(c) — RPC fallback pattern, body documented in Commit 5 working tree).

A full sweep would also examine pre-existing try/catch around `supabase.from`, `supabase.rpc`, etc. — none of those were touched by Step 4-6 mechanical work, so they are pre-existing state, not a regression. **Likely low yield** if resumed; cosmetic-only if any matches.

---

## 3. Class 3 findings — Console deletions that may have removed side effects

**Status:** Not started before halt.

Step 5 Commit 2 (`f65bd16`) deleted 447 `console.log` + 1 `console.info`. The discovery report's §B.1 sub-classification noted ~95% were "Cat 1 — debug detritus" with literal/template/property-access arguments — not function calls with side effects.

A sweep across `f65bd16`'s diff for `console.log(<function-call>)` removals would isolate the side-effect-suspect subset. Estimated <10 sites if any; mostly false alarms since the function calls in question would typically be variables already computed and stored.

**Likely low yield** if resumed.

---

## 4. Recommended remediation order

**Highest severity first.** Two real regressions to fix before any further Step 6 work:

| Priority | Site | Class | Effort | Notes |
|---|---|---|---|---|
| **P0** | `pages/admin/RechargeManagement.tsx:196` | 1(c) — destructure corruption | 1-line fix | Hard halt; recharge creation is broken. Restore `const { error }` (drop `data: recharge`). Verify `recharge` is genuinely unused below. **Must fix before further commits land.** |
| **P0** | `services/admin-user.service.ts:302-318` (5 table deletes in `deleteUser`) | 1(b) — cascade-delete error swallow | ~30 lines | Restore error checks for each table delete. Either inline `if (error) return false` per table, or extract a small helper. **Must fix before in-flight Commit 5 lands.** |
| P1 | UserManagement.tsx subtle destructure | 1(a) re-verify | 5 min | Re-read to confirm category. |
| P2 | Resume Class 2 sweep | — | 30-45 min | Likely low-yield but worth completing for due diligence. |
| P3 | Resume Class 3 sweep | — | 15-30 min | Low yield; defensive. |
| — | Commit 5 no-empty work | — | — | The 13 else+10 if deletions in working tree are SAFE per §1.2; can re-commit after the cascade-delete fix lands. |

**Estimated total fix effort:** 1.5–2 hours including verification + tests.

---

## 5. Process lessons

For the audit refresh in Commit 6 / prompts guide:

1. **Renamed-destructure regex traps**: my Commit-4 script's regex for `,\s*NAME\b` and `NAME\s*,\s*` does NOT respect the rename syntax `{ data: NAME, error: OTHER }`. Removing `NAME` from this pattern leaves `data: , error: OTHER` (stray comma) or `data: error: OTHER` (orphaned `data:` prefix). For ANY destructure-omit script in the future, **the regex must specifically detect and handle the `{ orig: alias }` rename form** — extracting either the alias OR the whole `orig: alias` pair as the deletion unit. The current Commit-1c-class fix manual pass-through covered some cases by hand; this 1(c) case slipped because the rename was on the OPPOSITE field (`data:` instead of the unused name).

2. **Cumulative semantic drift across commits**: the cascade-delete regression isn't visible in any single commit's diff. It's the END STATE that's bad: Step 5 Cat-2 deletion + Step 6 no-empty deletion + Step 6 no-unused-vars cascade-fix together produce silently-swallowed errors. **An audit that only reads diffs misses this.** The right tool is "are there `await supabase.from(...).delete()` calls in production code that don't check `.error` afterward?" That's a *current-state* lint, not a diff lint.

3. **TypeScript can't catch this class**: `const { data: error }` is type-legal because the supabase result's `data` is `Type | null` and TS just types the local var `error` as that union. The `if (error) throw error;` check still type-checks. Runtime semantics break in a way the types can't model.

4. **Test coverage gap**: recharge-creation, user-deletion, and other cascade operations have no automated test coverage. Manual smoke testing of these flows would catch both regressions immediately. Worth a future entry: "smoke-test critical admin flows after each mechanical sweep."

---

## 6. Recommended next prompt

After remediation order is reviewed and approved:

1. Fix P0a (`RechargeManagement.tsx`) as a tiny `revert` commit — 1 line.
2. Fix P0b (`admin-user.service.ts`) as a focused commit — restore error checks across 5 tables.
3. Re-run typecheck/lint/tests; confirm gates stay green.
4. Resume Commit 5 work from the post-P0 state (the no-empty deletions of `else {}` and `catch (_rpcError) {}` in working tree are all SAFE and can re-land in the same commit OR a separate one).
5. Complete Class 2 + Class 3 sweep before Commit 5 actually fires.

---

**Audit ended at:** the moment the 1(c) match was identified.
**Audit doc only — no source changes were made in producing this report.**
