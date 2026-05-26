# Phase 1f F7a — independently-dead removals (cleanup deletions)

**Phase:** 1f — frontend repoint · **Commit:** F7a · **Date:** 2026-05-26 · **HEAD at plan-write:** `b5e15cd`
(working tree carries the F7 scoping doc only; **first commit lands the scoping doc** under CF-6 before
this code commit).

**Companion docs.** `docs/handoff/phase-1f-f7-cleanup-scoping.md` (the read-only inventory + the 7 ruled
decisions D-F7-1…7) · `phase-1f-keystone-design.md` §3.2 (the keystone boundary that named what each
per-flow commit would defer) · `audit.md` §16 + §7.6 (the lint-1 floor + truthful-to-frontend operating
pattern).

**Architect rulings consumed (CF-22).** D-F7-5 = CONSOLIDATE (delete MyAccount); D-F7-6 = TWO commits
(F7a/F7b); D-F7-7 = performance.service §5.3 OUT. This plan is **F7a only** — the gates-only, no-UX
removals. F7b (deferred-control wirings + cascade removals) gets its own plan after F7a ships.

---

## §0 — Pre-flight verification

- **Baseline (post-F6, HEAD `b5e15cd`):** `apps/web` typecheck 36 / lint 1 / test 217 / build 137.51 kB;
  `apps/api` 146. **Floor checked at execution-time** before the first edit (CF-10 drift discipline —
  the counts above are the prompt's report; re-run all four gates fresh).
- **Working-tree state:** the F7 scoping doc (`docs/handoff/phase-1f-f7-cleanup-scoping.md`) is held
  uncommitted. **First commit lands it** under CF-6 (docs-immediate push, plan-doc commits before code
  commits). Working tree clean from CF-6 onward, then F7a opens.
- **Re-grep at plan-write** to confirm no caller drift since the scoping read (an extra hour
  hypothetically; defensive against [[literal-vs-spirit-surface-and-ratify]]). The four caller-checks
  to repeat:
  - `getCompanySizeOptions` — expect 0 external callers.
  - `getSupportObjectivesForAdvertiserAgency` — expect 0.
  - `getSupportObjectivesForOwners` — expect 0.
  - `/my-account` route references — expect exactly 2 (the route def + the hidden CTA).
  Halt-on-finding if any count differs (CF-22 surface; do not re-scope unilaterally).

---

## §1 — Locked constraints

**In F7a:**
- Delete 3 zero-caller methods from `auth.service.ts` + their now-orphaned `CompanySizeOption` type
  (D-F7-scoping §1.A).
- Delete MyAccount page + route + lazy import + hidden CTA + orphaned `Settings` lucide import
  (D-F7-5 CONSOLIDATE).

**Out of F7a (deferred to F7b):**
- §3.A deactivation disable (UX-visible — F7b).
- §3.B logo defer wiring (UX-visible — F7b).
- §3.C doc-remove defer wiring (UX-visible — F7b).
- Cascade removals (`updateProfile`, `mapAuthError`) — they still have one live caller each in F7a
  (logo + doc-remove + the mapAuthError fallback in `updateProfile`). Removable only after F7b's
  defer wirings zero them out.

**Out of F7 entirely (per scoping §4 + ruling D-F7-7):**
- `performance.service.ts:449` second `owner_business_sectors` site — later-slice consumer; inherits
  with the performance/dashboards repoint whenever that slice ships.

**Verification mode (the split rationale).** F7a touches no rendered surface: the 3 methods are
zero-caller (no UI exercises them), and MyAccount is invisible in the UI (hidden CTA + URL-only
access). **Gates-only verification** — no visual-QA pause required. F7b is where the visual-QA
pause lands (the deferred-control disables that finally make "Bientôt disponible" honest).

---

## §2 — Inventory phase (per-deletion, classified)

All entries source-verified at the scoping read (`docs/handoff/phase-1f-f7-cleanup-scoping.md` §1.A /
§5). Re-confirmed at §0 pre-flight.

### §2.A — Auth-service deletions (mechanical, 3 methods + 1 type)

| # | File:line | Item | Caller-check | LOC removed |
|---|---|---|---|---|
| 1 | `features/auth/services/auth.service.ts:522–529` | `getCompanySizeOptions` (Supabase select + mapAuthError throw) | 0 external (D8 hardcoded constant ruled) | ~8 |
| 2 | `features/auth/services/auth.service.ts:531–538` | `getSupportObjectivesForAdvertiserAgency` | 0 external (D8 leave-on-Supabase — this specific method is zero-caller) | ~8 |
| 3 | `features/auth/services/auth.service.ts:540–547` | `getSupportObjectivesForOwners` | 0 external | ~8 |
| 4 | `features/auth/services/auth.service.ts:7` | `CompanySizeOption` import line | becomes unused when #1 goes | 1 |
| 5 | `features/auth/types/auth.ts:63` (the `CompanySizeOption` interface block) | unused type — sole consumer was #1 | grep-verified: only #1 + the export site itself | ~5 |

**`SupportObjectiveOption` STAYS** — still consumed by `getAppointmentObjectives` (`auth.service.ts:549`,
D8 leave-on-Supabase, has 2 live callers in `useAppointmentObjectives.ts:16` + `contexts/ModalContext.tsx:82`).
The import line at `auth.service.ts:8` stays.

**`supabase` import at `auth.service.ts:14` STAYS** in F7a — 4 Supabase-using methods remain
(`updateBusinessProfile`, `deactivateAccount`, `updateProfile`, `getAppointmentObjectives`).
Removed in F7b (after the cascade).

**`mapAuthError` STAYS** in F7a — even after the 3 deletions, the `updateProfile:499` fallback
still calls it. Removed in F7b.

### §2.B — MyAccount consolidation (mechanical, 4 sites)

| # | File:line | Item | LOC |
|---|---|---|---|
| 6 | `apps/web/src/features/screenhost/pages/MyAccount.tsx` (entire file) | the 848-line page | -848 |
| 7 | `apps/web/src/App.tsx:50` | `const MyAccount = lazy(() => import('@/features/screenhost/pages/MyAccount'));` | -1 |
| 8 | `apps/web/src/App.tsx:481–489` | the `<Route path="/my-account">` block | -9 |
| 9 | `apps/web/src/features/screenhost/pages/OwnerDashboard.tsx:428–434` | the hidden CTA button (`className="hidden ... aria-hidden"`) | -7 |
| 10 | `apps/web/src/features/screenhost/pages/OwnerDashboard.tsx:13` | the `Settings` entry in the lucide-react import list (becomes unused after #9) | -1 |

**No test changes** — `grep MyAccount\|my-account *.test.*` returns no hits (CF-9-confirmed at the
scoping read).

**No additional caller cleanup** — `MyAccount` imports `useOwnerProfileMutations`, `useBusinessProfile`,
`useGovernorates`, `useSectors`, `useAuthStore`, `OwnerNavigation`, `getErrorMessage`, `logger`,
lucide icons. All of these have other consumers and STAY.

**`useOwnerProfileMutations.updateBusinessProfile` mutation stays** — MyAccount was one of two
external callers; the other is `useSaveBankDetails.ts:68` (wallet/later-slice). The mutation is still
needed; only the MyAccount call goes.

### §2.C — Mechanical-vs-judgment classification

All 10 items are **MECHANICAL** — deterministic deletions of source-verified-dead code. Per-commit
verification = "did the deletion produce the predicted gate movement, and does nothing else
reference the deleted symbol?"

---

## §3 — Commit factoring

**ONE commit for F7a** — all 10 items go together; they're a single coherent "remove the
independently-dead account-layer code." Splitting (e.g. methods vs MyAccount) would gain nothing
(both halves are gates-only mechanical) and produce two near-identical CF-9 pauses.

**Commit subject (Conventional Commits):**
`refactor(web): Phase-1f F7a — remove independently-dead account-layer code + consolidate MyAccount`

**Commit body outline:**
- the 3 zero-caller auth-service methods (D8 ruled their replacements: hardcoded constant /
  leave-on-Supabase for the still-live `getAppointmentObjectives`)
- the `CompanySizeOption` type follows its sole consumer
- MyAccount consolidation (the page is invisibly orphaned — hidden CTA + no other nav link; fully
  duplicated by OwnerSettings, which has more)
- defers retained for F7b: `updateProfile` + `mapAuthError` + the 3 deferred-control wirings
- lint-1 stays at 1 (database.types referenced only by `lib/supabase.ts`; 59 later-slice files
  import the client — expected, audit §16 / survey §2.4)

**No `Co-Authored-By` trailer** (CLAUDE.md rule 9).

---

## §4 — Per-commit verification gates

Four-gate baseline + the build-size delta check. The plan-doc commit (CF-6 docs-immediate, the
scoping doc + this plan) ships first; this section covers the F7a code commit.

### §4.A — Expected outcomes

| Gate | Pre-F7a (baseline at §0) | Post-F7a (expected) | Tolerance / discipline |
|---|---|---|---|
| `apps/web` typecheck | 36 | **drops** (the 3 deleted methods + the `mapAuthError` throw sites carry `@typescript-eslint/no-explicit-any` + `TODO(phase-1): typed source [supabase]`) | exact count surfaced in CF-9; ratchet-down opportunity recorded |
| `apps/web` lint | 1 | **stays 1** (database.types only in `lib/supabase.ts`; F7a doesn't delete the client) | exact 1 — no movement |
| `apps/web` test | 217 | **217** (flat — no new tests; no deleted tests; `auth.service.reference.test.ts` doesn't exercise the deleted methods) | exact 217 |
| `apps/web` build | 137.51 kB gzip main | **flat or slightly down** (MyAccount was a lazy chunk → chunk disappears; main bundle barely moves) | record both main + the disappeared lazy chunk |
| `apps/api` | 146 | **untouched (146)** | exact 146 — no `apps/api` files in this commit |

### §4.B — Verification commands (exact)

Run under Node 20.20.2 (per [[node-20-required-for-commits]]) — `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`.

```
pnpm -F @toodooh/web typecheck
pnpm -F @toodooh/web lint
pnpm -F @toodooh/web test --run
pnpm -F @toodooh/web build
pnpm -F @toodooh/api typecheck     # untouched assertion
```

### §4.C — Residue checks (must be zero after the deletions)

- `grep -rn 'getCompanySizeOptions\|getSupportObjectivesForAdvertiserAgency\|getSupportObjectivesForOwners' apps/web/src` → 0 hits.
- `grep -rn 'CompanySizeOption' apps/web/src` → 0 hits.
- `grep -rn 'MyAccount\|/my-account' apps/web/src` → 0 hits.
- `grep -n 'Settings' apps/web/src/features/screenhost/pages/OwnerDashboard.tsx` → 0 hits (the lucide
  import is gone; no other usage).

If any residue check returns non-zero: HALT and surface (CF-22).

### §4.D — Caller-recheck (cascade gating for F7b)

Confirm post-F7a that **`updateProfile` and `mapAuthError` STILL have callers** (so they remain in
the file — F7b removes them):

- `grep -rn 'authService\.updateProfile\b' apps/web/src` → expect the 5 sites named in scoping §1.B
  (UserProfile.tsx logo-related, OwnerSettings.tsx logo-related, both hooks, removeDocument RNE).
- `grep -n 'mapAuthError' apps/web/src/features/auth/services/auth.service.ts` → expect 1 site
  (the `updateProfile:499` fallback) + the definition itself.

If either count is wrong, surface in CF-9 — the F7b plan-write depends on these counts being exact.

---

## §5 — Standing operating procedure

- **CF-6 docs-immediate.** The scoping doc + this plan-doc ship in a single `docs(phase-1f):` commit
  BEFORE the F7a code commit. Push docs immediately (the methodology-and-prompt-format §1 CF-6
  rule); the code commit follows under the CF-7 gate-sweep flow.
- **CF-7 gate-sweep code-push flow.** The 4 gates (§4.A) run BEFORE the commit lands locally; CF-9
  pause; push only on architect approval.
- **CF-9 pause summary** must include: the 4-gate results with exact counts, the §4.C residue
  grep outputs (paste actual stdout — not "all zero"), the §4.D caller-recheck counts, the build
  delta (main + lazy chunks; specifically note MyAccount's disappeared chunk), the conventional-commit
  subject line.
- **CF-22 surface-don't-guess.** Any drift between §0 pre-flight grep and the scoping doc's
  caller-check → halt and surface, do not re-scope unilaterally.
- **CF-23 verify-library-behavior.** Not load-bearing here — F7a is pure deletion with no library
  interaction.
- **Node 20.20.2 PATH prefix** mandatory before any `pnpm`/`git commit` (husky pre-commit
  rejects Node 24 — `ERR_PNPM_UNSUPPORTED_ENGINE`, per [[node-20-required-for-commits]]).
- **No `--no-verify`, no `--amend`.** Standard.

---

## §6 — Hard-halt conditions

Trigger an immediate halt (do NOT continue, surface in CF-9):

- §0 re-grep shows any new caller for the 3 methods, or `/my-account` ≠ 2 references.
- §4.A typecheck moves UP (regression) — F7a is pure deletion; the floor can only stay or drop.
- §4.A lint moves off 1 — surface immediately.
- §4.A tests change count (delete a test we didn't know about, or a test surprises us by failing).
- §4.C residue checks return non-zero — proves a missed reference.
- §4.D caller-recheck for `updateProfile` or `mapAuthError` is wrong (F7b's plan depends on them).
- A build error or runtime import error that the gates don't catch (e.g. an unused-import lint we
  missed) — surface, don't silently patch.

---

## §7 — Risk register

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Missed caller for one of the 3 deleted methods (a later-slice grep we missed) | Low | Medium (TS build error) | §0 pre-flight re-grep; §4.A typecheck catches; §4.C residue grep verifies |
| `CompanySizeOption` referenced by a test/snapshot/mock I didn't find | Low | Low | §4.C residue grep on `CompanySizeOption`; typecheck would also catch |
| MyAccount's hidden CTA is actually toggled-visible by a flag/feature gate I didn't find | Very Low | Medium (user-visible 404) | grep `aria-hidden` and `className.*hidden` around the CTA — confirmed static; no `useState` toggling it |
| MyAccount's removed imports leave a now-unused `useGovernorates`/`useSectors`/etc. somewhere | Very Low | Low | Each of these hooks has many other consumers (the hooks are SHARED); MyAccount removal doesn't orphan them |
| OwnerDashboard's `Settings` import becomes the only orphan; lint catches → no other code path uses it | Low | Low | §4.C grep verifies; lint's `unused-imports` rule catches at build |
| F7a's typecheck-floor drop is smaller than expected (the F7b cascade carries more) | Low | None | Expected — `mapAuthError`'s 157-ln + `updateProfile`'s untyped chain land in F7b, not F7a; the F7a ratchet is real but bounded |
| Build's MyAccount chunk doesn't actually disappear (Vite chunk-naming or shared-chunk surprise) | Low | Low | §4.A records both main + chunks; absent a missing chunk, the gain is still in main |
| `OwnerNavigation` or another nav component links to `/my-account` and we missed it | Very Low | Medium | Grep over all `*.tsx` for `/my-account` returned exactly 2 hits at scoping; §0 re-grep is the defensive recheck |

---

## §8 — Cross-references

- **Issue:** none (Phase-1f's per-flow commits don't open GitHub issues — they reference the
  in-repo scoping docs).
- **Scoping doc:** `docs/handoff/phase-1f-f7-cleanup-scoping.md` §1.A (the 3 dead methods + the
  caller-check), §2 (`mapAuthError` disposition — F7b not F7a), §5 (MyAccount disposition —
  CONSOLIDATE), §6 (lint-1 floor stays), §7 (sub-factoring TWO commits).
- **Architect rulings:** D-F7-1 (a) consumed partially (mapAuthError retarget deferred to F7b),
  D-F7-2 (a) deferred to F7b, D-F7-3 (a) deferred to F7b, D-F7-4 (a) deferred to F7b,
  **D-F7-5 (a) CONSOLIDATE consumed**, **D-F7-6 TWO commits consumed (this is F7a)**, D-F7-7
  OUT confirmed.
- **Audit refresh:** F8 records F7a + F7b under §17 (Phase-1f close); F7a contributes the
  "caption-vs-wire was named explicitly as the F7 reframe" headline finding.
- **Floor history:** survey §2.4 + audit §16 / §7.6 lint-1 floor note. F7a leaves lint-1 at 1
  exactly as predicted.

---

## §9 — Carry-forward methodology

**CFs applicable to F7a:**

- **CF-6** docs-immediate — the scoping doc + this plan push first (a single docs commit).
- **CF-7** gate-sweep code-push for the F7a code commit.
- **CF-9** pause-summary discipline with the §4.C/§4.D exact greps surfaced.
- **CF-10** drift verification — re-grep at §0 even though the scoping read is hours old; counts
  can drift.
- **CF-22** surface-don't-guess on any §0/§4.C/§4.D anomaly.

**CF candidates F7 may surface (recorded for F8 audit refresh, not promoted here):**

- **"Caption-vs-wire (defer-by-comment-only)" failure mode** — the per-flow rulings D-F4-4 / D-F5-3
  named UX-defers but the executor satisfied them with a static caption ("Bientôt disponible")
  beside still-active handlers/buttons/Supabase chains. F7 was scoped as "remove dead code" and
  caught this only via §1.B's source caller-check — the CF-9 / CF-22 discipline working as
  designed. **Worth promoting at F8** as a methodology learning: a defer ruling is only
  satisfied when the wiring matches the caption, not when the caption matches the ruling. Worked
  instances: D-F4-4 logo (F4a/F4b), D-F5-3 doc-remove (F5), D-F6-5a no-old password (F6 — pruned
  correctly, the counter-example showing this CAN be done right).

**Cross-references to existing memory:**

- [[design-source-of-truth-consultation]] — F7's inversion came from source, not memory; the
  scoping read overrode the prompt's "kept-dead methods" framing because source disagreed.
- [[no-askuserquestion-architect-delivers-rulings]] — F7 surfaced 7 decisions in prose, the
  architect ruled in prose, no AskUserQuestion used.
- [[node-20-required-for-commits]] — §4.B PATH prefix.

---

## §10 — Files touched (for the §9 commit-file-list discipline, Phase-1b operating learning 4)

```
M  apps/web/src/App.tsx
M  apps/web/src/features/auth/services/auth.service.ts
M  apps/web/src/features/auth/types/auth.ts
M  apps/web/src/features/screenhost/pages/OwnerDashboard.tsx
D  apps/web/src/features/screenhost/pages/MyAccount.tsx
```

5 files: 4 modifications + 1 deletion. No `apps/api` files. No lockfile changes (no dependency
touched). No new test files.

---

## Document status

**Drafted, awaiting architect ratification.** Plan covers F7a (independently-dead removals +
MyAccount consolidation) per ruling D-F7-6's split. F7b (deferred-control wirings + cascade
removals) gets its own plan-doc after F7a ships and §4.D caller-counts confirm the F7b cascade is
mathematically clean.

**Outstanding for F7b plan-write** (NOT this plan): the exact UX shape of the disabled controls
(button greyed-out + "Bientôt disponible" caption, or hidden entirely?), the cascade order
(remove `updateProfile` before or after `mapAuthError`?), the visual-QA checklist for the 3
deferred-control surfaces.
