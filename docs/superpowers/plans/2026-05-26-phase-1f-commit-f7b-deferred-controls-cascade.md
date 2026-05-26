# Phase 1f F7b — deferred-control wirings + cascade removals (the caption-vs-wire fix)

**Phase:** 1f — frontend repoint · **Commit:** F7b · **Date:** 2026-05-26 ·
**HEAD at plan-write:** `38c3dab` (F7a CI-green, working tree clean) · **Floor:** apps/web typecheck 36
/ lint 1 / test 217 / build 137.37; apps/api 146.

**Companion docs.** `docs/handoff/phase-1f-f7-cleanup-scoping.md` §3 (the 3 deferred-control gaps,
§1.B caller-check) · `phase-1f-keystone-design.md` §3.2 (what each per-flow commit deferred) ·
`audit.md` §16 / §7.6 (the operating pattern + the `lib/supabase.ts` lifetime).

**Architect rulings consumed.** D-F7-1 (a) `mapAuthError` remove + retarget — F7b cascade ·
D-F7-2 (a) deactivation DISABLE + track backend slice + class-(b) security finding for the F8
audit · D-F7-3 (a) logo defer WIRE — F7b · D-F7-4 (a) doc-remove defer WIRE — F7b ·
D-F7-6 TWO commits (F7a done, this is F7b) · D-F7-7 performance §5.3 OUT.

**Verification mode.** F7b is **UX-VISIBLE** — the 3 disabled-control surfaces are exactly what
the phase-close human visual QA checks. The F7b CF-9 names what the QA should look at. Gates +
visual QA together prove "disable" means *path-severed AND visibly inert*, not just *captioned*
(the F7a "caption-vs-wire" CF candidate is the F8 promotion).

---

## §0 — Pre-flight verification

- **Baseline (post-F7a, HEAD `38c3dab`):** apps/web typecheck 36 / lint 1 / test 217 / build
  137.37 kB; apps/api 146 (CI-verified). **Re-run all four gates fresh** at execution start —
  the working tree state has been stable since `38c3dab`, but the CF-10 drift discipline holds.
- **Working-tree state:** clean. F7b opens with no held edits.
- **§0 re-grep at plan-write (CF-23 execution-time discipline)** — confirm the **§4.D cascade
  precondition** is still exact at HEAD `38c3dab`. Repeat the F7a CF-9 measurements:
  - `grep -rnE 'authService\.updateProfile\(' apps/web/src` → expect **5 direct call sites + 1
    JSDoc reference** (total 6 hits; the JSDoc at `useProfileMutations.ts:21` is non-load-bearing).
  - `grep -n 'mapAuthError' apps/web/src/features/auth/services/auth.service.ts` → expect **1
    call site** (`:498` fallback) + **1 definition** (`:22`).
  - `grep -rn 'authService\.deactivateAccount\|profileMutations\.deactivateAccount' apps/web/src`
    → expect 3 sites total (UserProfile.tsx:334, useOwnerProfileMutations.ts:98,
    OwnerSettings.tsx:406).
  - `grep -rn 'authService\.updateBusinessProfile\|profileMutations\.updateBusinessProfile'
    apps/web/src` → expect 2 sites (useSaveBankDetails.ts:68 wallet, useOwnerProfileMutations.ts:84
    mutation wrapper) — confirms `updateBusinessProfile` STAYS through F7b (wallet/later-slice).
  - `grep -rn 'authService\.getAppointmentObjectives' apps/web/src` → expect 2 sites
    (useAppointmentObjectives.ts:16, contexts/ModalContext.tsx:82) — confirms STAYS (D8
    leave-on-Supabase).

  Halt-on-finding if any count differs (CF-22 surface; do not unilaterally re-scope the cascade).

---

## §1 — Locked constraints

**In F7b:**
- Sever the 3 deferred-control wirings (logo, doc-remove, deactivation) — both UserProfile
  (advertiser) and OwnerSettings (owner) surfaces.
- Cascade removals in `auth.service.ts`: `updateProfile`, `deactivateAccount`, `mapAuthError`.
- Hook cleanups: drop `uploadLogo` (both hooks), `removeDocument` + `deactivateAccount` +
  `updateProfile` (owner hook), `uploadLogo` + `updateProfile` (advertiser hook).
- Page cleanups: drop the dead state/handlers (`logoFile/logoPreview/uploadingLogo`,
  `handleLogoChange/Upload/Remove`, `handleRemoveDocument`,
  `deleteConfirmPassword/deactivating/handleDeactivateAccount`).
- Drop the now-unused `supabase` import from `UserProfile.tsx`,
  `useProfileMutations.ts`, `useOwnerProfileMutations.ts` (these files lose their last
  Supabase call when the severs land). **OwnerSettings.tsx `supabase` import STAYS** — the
  bank-doc-view `createSignedUrl` at line 522 is wallet/later-slice and out of F7b's scope.

**Out of F7b (deferred to later slices, per rulings):**
- The deactivation BACKEND endpoint (`POST /api/account/deactivate` with re-auth) — D-F7-2 tracked,
  not F7b. F7b makes the FE control honest (disabled) until the backend ships.
- Logo storage column + endpoint — D-F4-4 tracked, not F7b.
- Document DELETE endpoint — D-F5-3 tracked, not F7b.
- `lib/supabase.ts` deletion — 59 later-slice importers keep the client alive. The lint-1 floor
  stays at 1 (`database.types` unresolved) through F7b — last-slice closes it.
- `authService.updateBusinessProfile` — still has wallet caller (later-slice); STAYS.
- `authService.getAppointmentObjectives` — still has callers; D8 leave-on-Supabase; STAYS.
- `performance.service.ts:449` — D-F7-7 OUT (later-slice).
- F8 audit refresh (the "caption-vs-wire" CF promotion + the class-(b) security finding writeup
  belong to F8).

---

## §2 — The 3 control-disable treatments (the load-bearing § — surface judgment calls)

### §2.A — Logo (BOTH UserProfile.tsx + OwnerSettings.tsx)

**Current state (read from source, CF-23, HEAD `38c3dab`):**
- The "Changer" `<label>` wraps a file input with `disabled` + `cursor-not-allowed opacity-60`
  styling; the `onChange={handleLogoChange}` is still WIRED.
- The "Supprimer" `<button>` has `disabled` + the same styling; `onClick={handleLogoRemove}` is
  still WIRED.
- The "Bientôt disponible" `<p>` caption is there.
- Below: a `{logoFile && (<button onClick={handleLogoUpload}>Enregistrer le logo</button>)}` block.
  This block is structurally unreachable (the file input is `disabled`, so `logoFile` can never
  be set via the UI — but the handlers + the `uploadLogo` mutation + the Supabase chain are
  still loaded code).
- The handlers (`handleLogoChange`, `handleLogoUpload`, `handleLogoRemove`) reference state
  (`logoFile`, `logoPreview`, `uploadingLogo`) and call into `useProfileMutations.uploadLogo` /
  `useOwnerProfileMutations.uploadLogo` (both call `supabase.storage.upload + createSignedUrl`
  + `authService.updateProfile({logo_url})`).

**Treatment (proposed): STATIC DISABLED — keep the disabled markup + caption; remove the wiring.**

- Drop `onChange={handleLogoChange}` from the file input (the input stays `disabled`).
- Drop `onClick={handleLogoRemove}` from the Supprimer button (stays `disabled`).
- **Remove the entire `{logoFile && (...)}` Enregistrer block** (unreachable + dead-Supabase chain
  via uploadLogo).
- Remove the now-orphan state: `logoFile`, `logoPreview`, `uploadingLogo`,
  `setLogoFile`, `setLogoPreview`, `setUploadingLogo` (advertiser) /
  `logoFile`, `logoPreview`, `setLogoFile`, `setLogoPreview` (owner — owner doesn't carry
  `uploadingLogo`; the spinner came from `profileMutations.uploadLogo.isPending`).
- Remove the orphan handlers: `handleLogoChange`, `handleLogoUpload`, `handleLogoRemove` (both
  pages).
- Remove `uploadLogo` from `useProfileMutations`'s `mutationFn`/`return` and from
  `useOwnerProfileMutations`.
- Also remove the `<img src={logoPreview} ...>` rendering (`UserProfile.tsx:181` /
  `OwnerSettings.tsx` near `:226` — read at execution to confirm) — keep a static placeholder
  div ("aucun logo" or the default initial-letter avatar already used elsewhere) so the section
  still renders something.

**User-visible outcome:** the section renders exactly as today — disabled Changer + disabled
Supprimer + "Bientôt disponible" caption — but the wiring is severed (no handlers, no
upload-button-after-pick, no dead-Supabase chain on click). The caption is honest.

**Judgment call (surfaced for ruling).** When we drop `logoPreview`, what does the **logo
display area** show? Three options:
- **(i)** keep the current empty/placeholder block (a styled gray box with an initial-letter
  avatar or "Pas de logo" text) — minimal visual change.
- **(ii)** remove the logo display entirely (the section becomes just the disabled controls +
  caption) — visually shorter, but the layout shifts.
- **(iii)** hide the whole logo card (the section disappears until F4-D9 ships) — cleanest, but
  changes the page shape.

*Lean: (i)* — preserves the layout; the user sees the same shape, just without a logo and with
disabled controls + caption. Honest about "we don't have logos yet" without removing the
affordance.

### §2.B — Document remove (UserProfile.tsx + OwnerSettings.tsx)

**Current state:**
- The trash button: `disabled={!documentFile}` (= disabled when no local file is picked).
- onClick branches: `if (documentFile) setDocumentFile(null) else handleRemoveDocument()`.
- The disabled state makes the `else` branch structurally unreachable from the UI (you can't
  click a disabled button).
- `handleRemoveDocument` (only on OwnerSettings — UserProfile has it but never calls a real
  mutation; the advertiser hook has no `removeDocument`) calls
  `profileMutations.removeDocument.mutateAsync(isIndividualOwner)`, which is the dead-Supabase
  CIN-clear (direct `business_profiles.update`) or RNE-clear (via `authService.updateProfile`).

**Treatment (proposed): SEVER THE DEAD BRANCH — keep the local-pick clear path.**

- Replace `onClick={(e) => { e.stopPropagation(); if (documentFile) setDocumentFile(null); else
  handleRemoveDocument(); }}` with `onClick={(e) => { e.stopPropagation(); setDocumentFile(null);
  }}` (the `disabled={!documentFile}` already gates this from firing in the uploaded state).
- The `title` attr stays — `documentFile ? 'Retirer le fichier' : 'Suppression bientôt disponible'`
  — both branches are honest now (the latter is captioned + truly inert via `disabled`).
- Remove `handleRemoveDocument` handler from OwnerSettings (UserProfile has a `handleRemoveDocument`
  too — read at execution to confirm; if it's wired through a hook, it goes with the hook entry).
- Remove `removeDocument` from `useOwnerProfileMutations` (the `mutationFn`, `onError`, the
  `return` entry, the dead CIN-clear `supabase.from('business_profiles').update({cin_doc_url:null})`).

**User-visible outcome:** identical to today — trash button enabled only for a local pre-upload
pick (clears it), disabled with "Suppression bientôt disponible" tooltip when an uploaded doc
is present.

**No judgment calls here** — the F5 intent (replace = re-upload) holds; the dead branch was the
caption-vs-wire gap.

### §2.C — Deactivation (UserProfile.tsx + OwnerSettings.tsx)

**Current state:**
- The "Désactiver le compte" form has a password input (`deleteConfirmPassword` state) + an
  info text ("Veuillez saisir votre mot de passe…") + a button
  `onClick={handleDeactivateAccount} disabled={deactivating || !deleteConfirmPassword.trim()}`.
- The button is **fully active** when the user types something — clicking it fires
  `handleDeactivateAccount`, which calls `supabase.auth.signInWithPassword` (dead store →
  rejects every password) + `authService.deactivateAccount` (dead Supabase write).
- **NOT visibly disabled today** — the user can interact with the form; failure surfaces as
  "Mot de passe incorrect" (misleading: it's not a wrong password, the auth backend is
  unreachable).

This is the **class-(b) security finding** (D-F7-2): a control that LOOKS like it confirms
re-auth before destroying the account, but the re-auth is broken (Supabase auth ≠ apps/api
users post-K). Pre-K = real gate. Post-K = broken no-op. The disable is the **defensive
choice** — better visibly inert than a control that looks-like-it-confirms but skips the
broken gate.

**Treatment (proposed): REPLACE THE FORM INTERNALS WITH A STATIC "COMING SOON" MESSAGE.**

- Drop the password input entirely (no `deleteConfirmPassword` state).
- Drop the "Veuillez saisir votre mot de passe…" instruction.
- Drop the Annuler + Désactiver button pair, OR replace them with a single disabled
  "Désactivation bientôt disponible" button + an info text:
  > "La désactivation de compte sera bientôt disponible. Pour fermer votre compte, contactez le
  > support à `assistant.ia@too-dooh.com`."
- Remove `deactivating`, `setDeactivating`, `deleteConfirmPassword`, `setDeleteConfirmPassword`
  state.
- Remove `handleDeactivateAccount` handler (both pages — including the
  `supabase.auth.signInWithPassword` call at UserProfile.tsx:325 and OwnerSettings.tsx:397, AND
  the `authService.deactivateAccount()` / `profileMutations.deactivateAccount.mutateAsync()`
  call sites).
- Remove `deactivateAccount` mutation from `useOwnerProfileMutations`.

**User-visible outcome:** the "Désactiver le compte" section still exists (the menu/tab entry
stays) but its body is a static "coming soon + contact support" message — no password field,
no clickable destructive action.

**Judgment call (surfaced for ruling).**
- **(i)** the full replacement above (form goes; static message + support email).
- **(ii)** keep the section minimal — only a disabled button with the caption, no message body
  (matches the logo treatment's "static disabled + caption" pattern more uniformly).
- **(iii)** hide the section header entirely until the backend ships (page shape changes).

*Lean: (i)* — deactivation is a real future feature with a real user need (close my account); a
"contact support" fallback is the honest interim path. The logo (D-F4-4 cosmetic) and the
deactivation (D-F7-2 real-user-action-without-backend) warrant different treatments because the
underlying user intent differs.

**The class-(b) security finding text (for F8 audit §17):** "Pre-K the deactivation form
re-auth-confirmed before destroying the account (`supabase.auth.signInWithPassword` → real
Supabase auth gate). Post-K the Supabase auth store is no longer the password source (users are
in apps/api's `users` table), so the re-auth becomes a broken no-op that rejects every password
attempt. A user clicking the still-active button would get a misleading 'Mot de passe
incorrect' toast — they cannot deactivate; the control is dishonest. F7b disables the control
defensively (per D-F7-2) until the backend `/api/account/deactivate` endpoint with a real
re-auth gate ships."

---

## §3 — Cascade order + zero-caller proof

The cascade fires only after the §2 wirings land. Each removal earns its place at execution
via a re-grep — same discipline as F7a's §4.D (verify-dead-at-execution).

### §3.A — Order (atomic in one commit; verify between sub-phases)

1. **Apply §2 wirings** — sever logo (both pages + both hooks); sever doc-remove (both pages +
   owner hook); sever deactivation (both pages + owner hook). After this:
   - `authService.updateProfile` direct callers → grep should return **0** (was 5: 4 logo paths
     in the two hooks/pages + 1 RNE-clear in `useOwnerProfileMutations.removeDocument`, all
     severed).
   - `authService.deactivateAccount` direct callers → grep should return **0** (was 3:
     UserProfile.tsx:334, useOwnerProfileMutations.ts:98, OwnerSettings.tsx:406 via the mutation
     — all severed).
   - `mapAuthError` callers in `auth.service.ts` → still **1** (the `updateProfile:498`
     fallback; goes when `updateProfile` is removed).
   - `supabase.auth.signInWithPassword` callers → grep should return **0** (both deactivation
     re-auth gates severed).
2. **Re-grep at execution (§3.B)** to confirm step 1 numbers. **HALT** if any are non-zero.
3. **Remove `authService.updateProfile`** from `auth.service.ts` (now zero-caller).
4. **Remove `authService.deactivateAccount`** from `auth.service.ts` (now zero-caller).
5. **Re-grep `mapAuthError`** — should now be 0 callers + 1 definition. **HALT** if non-zero
   callers.
6. **Remove `mapAuthError`** (the 157-line any-typed function block).
7. **Drop unused `supabase` imports** in: `UserProfile.tsx`, `useProfileMutations.ts`,
   `useOwnerProfileMutations.ts` (these files' only Supabase calls just went). The
   `auth.service.ts` `supabase` import STAYS (still used by `updateBusinessProfile` +
   `getAppointmentObjectives`); `OwnerSettings.tsx` `supabase` import STAYS (still used by the
   wallet bank-doc `createSignedUrl` at line 522 — out of scope).
8. **Drop any orphan type imports** in `auth.service.ts` — read at execution; if
   `BusinessProfile` (used by the removed `updateProfile` signature) is no longer used, drop
   it.

### §3.B — Post-wiring re-grep (HARD-HALT if anything non-zero)

Between step 2 and step 3:

```
grep -rnE 'authService\.updateProfile\(' apps/web/src      # expect 0 calls (JSDoc refs allowed)
grep -rn  'authService\.deactivateAccount\b' apps/web/src   # expect 0
grep -rn  'profileMutations\.deactivateAccount\|deactivateAccount\.mutateAsync' apps/web/src # expect 0
grep -rn  'supabase\.auth\.signInWithPassword' apps/web/src # expect 0
```

Between step 4 and step 6:

```
grep -n   'mapAuthError(' apps/web/src/features/auth/services/auth.service.ts  # expect 0
```

### §3.C — Post-cascade residue checks

```
grep -rn 'mapAuthError'      apps/web/src                  # expect 0
grep -rn 'updateProfile\b'   apps/web/src/features/auth/services/auth.service.ts  # expect 0
grep -rn 'deactivateAccount\b' apps/web/src/features/auth/services/auth.service.ts # expect 0
grep -rn 'handleLogoUpload\|handleLogoRemove\|handleLogoChange\|handleDeactivateAccount\|handleRemoveDocument' apps/web/src # expect 0
grep -rn 'uploadLogo\b\|removeDocument\b' apps/web/src     # expect 0
grep -n  '@/lib/supabase' apps/web/src/features/advertiser/pages/UserProfile.tsx # expect 0
grep -n  '@/lib/supabase' apps/web/src/features/advertiser/hooks/useProfileMutations.ts # expect 0
grep -n  '@/lib/supabase' apps/web/src/features/auth/hooks/useOwnerProfileMutations.ts # expect 0
```

`OwnerSettings.tsx` `@/lib/supabase` import — expect 1 (bank-doc-view, line 522, wallet
out-of-scope).

---

## §4 — Per-commit verification gates

### §4.A — Expected outcomes

| Gate | Pre-F7b (baseline) | Post-F7b (estimate) | Notes |
|---|---|---|---|
| apps/web typecheck | 36 | **down or flat** (estimate: -1 to -3) | the 157-line `mapAuthError` is `(error: any)` (any-typed → no visible TS error contribution); the removed `updateProfile`'s body uses `Record<string, unknown>` (also no visible error). The ratchet may be small; the F7a precedent (flat at 36) suggests the meaningful drop arrives with `lib/supabase.ts` deletion at the last slice. Exact count at CF-9. |
| apps/web lint | 1 | **stays 1** | `database.types` still in `lib/supabase.ts`; expected. |
| apps/web test | 217 | **217 (flat)** | no test references the severed controls or removed methods. |
| apps/web build | 137.37 kB gzip main | **flat or slightly down** | dead code leaving; the lazy chunks for the page bundles (UserProfile/OwnerSettings) shrink. Record per-chunk. |
| apps/api | 146 | **untouched** | F7b touches zero apps/api files. |

### §4.B — Verification commands

Run under Node 20.20.2 (`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`).

```
pnpm -F @toodooh/web typecheck
pnpm -F @toodooh/web lint
pnpm -F @toodooh/web test
pnpm -F @toodooh/web build
```

apps/api gates rely on CI (the local Postgres test-user mismatch surfaced in F7a is an
operational issue unrelated to F7b's diff; F7b touches zero apps/api files).

### §4.C — Visual QA checklist (for the phase-close human pass)

F7b is UX-visible. The human QA at phase close walks these surfaces:

- **Logo (advertiser UserProfile + owner OwnerSettings):** the Changer + Supprimer controls
  render disabled (gray, opacity-60, cursor-not-allowed); the "Bientôt disponible" caption is
  beside them; clicking Changer or Supprimer does nothing (no file picker, no action). The
  logo-display area (if applicable per the §2.A judgment ruling) renders the placeholder
  consistently.
- **Document remove:** uploaded-doc state shows the trash button disabled with "Suppression
  bientôt disponible" tooltip; clicking the disabled button does nothing. Local-pick state
  shows the trash button enabled; clicking it clears the picked file (resets to no-doc state).
- **Deactivation (advertiser UserProfile → Confidentialité tab; owner OwnerSettings →
  Confidentialité → Supprimer):** the section header renders; the body shows the §2.C-ruled
  treatment (lean: "coming soon + contact support" message); no password input field; no
  destructive button; the support email is correct (`assistant.ia@too-dooh.com`).

---

## §5 — Standing operating procedure

- **CF-6 docs-immediate** for this plan-doc (push the plan commit before the F7b code commit
  lands).
- **CF-7 gate-sweep code-push** for the F7b code commit. CF-9 → architect approval → push.
- **CF-9 pause-summary** must include: the §0 re-grep results (exact counts); the §2 disable
  treatments applied (one per surface, screenshot-able description); the §3.B post-wiring
  re-grep outputs (paste the actual stdout); the §3.C residue grep outputs; the four-gate
  results with exact counts including the typecheck delta; the visual-QA checklist from §4.C as
  the gate the human will exercise.
- **CF-22 surface-don't-guess** on any §0/§3.B/§3.C anomaly. The cascade is sequentially gated
  by the re-greps — if any count is wrong, stop and re-rule rather than force the removal.
- **CF-23 verify-library-behavior** — not load-bearing (no library interactions; pure FE
  source edits).
- **Node 20.20.2 PATH prefix** mandatory per [[node-20-required-for-commits]].

---

## §6 — Hard-halt conditions

- §0 re-grep counts diverge from F7a CF-9 measurements (working tree changed unexpectedly).
- §3.B post-wiring re-grep: `updateProfile` calls ≠ 0, `deactivateAccount` calls ≠ 0,
  `signInWithPassword` calls ≠ 0 — the wirings missed a site.
- §3.C residue grep: any expected-zero returns non-zero.
- Gate regression: lint > 1, test < 217, build size increases significantly (> +1 kB), apps/api
  modified (it shouldn't be).
- A judgment-call treatment (§2.A logo display, §2.C deactivation form) is unclear at
  execution — surface, don't pick unilaterally.

---

## §7 — Risk register

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| The `{logoFile && (...)}` Enregistrer block has a hidden dependency I missed (e.g., a test stub) | Very Low | Low | §3.C residue grep on `logoFile\b` confirms zero references in any test/snapshot file |
| Removing `deleteConfirmPassword` state breaks a shared utility / form-context elsewhere | Very Low | Low | grep at execution before removal; the state is page-local |
| The `BusinessProfile` type drop in auth.service.ts (if it becomes orphan) breaks an import chain | Low | Low | typecheck enforces; the import is only used by the removed `updateProfile` signature |
| The deactivation §2.C "Coming soon + contact support" message is the wrong UX call | Low | Low | judgment call surfaced for ruling; the architect may pick (ii) or (iii); two-line edit difference |
| The logo §2.A placeholder choice (i)/(ii)/(iii) lands wrong | Low | Low | judgment call surfaced; lean is conservative (preserve layout) |
| The typecheck ratchet is flat at 36 (no movement) — F7b "the ratchet" framing was wrong | Medium | None | F7a precedent + the F7b inventory (mostly `any`-suppressed code leaving) suggest flat is real; surface the exact count, honest report (F7a discipline) |
| Visual-QA finding at phase close requires a follow-up commit | Low | Low | CF-9 names the QA checklist explicitly; follow-up is fix-forward per Phase-1b discipline |
| The two `supabase.auth.signInWithPassword` direct call sites have other re-auth use I missed | Low | Medium | grep returns exactly 2 hits today (both in deactivation handlers); §3.B re-grep verifies post-sever |

---

## §8 — Cross-references

- **Scoping doc:** `docs/handoff/phase-1f-f7-cleanup-scoping.md` §3 (the three deferred-control
  gaps), §1.B (caller-check), §7 (sub-factoring TWO commits = F7a/F7b).
- **Architect rulings consumed:** D-F7-1 (a) `mapAuthError` (cascade in F7b — `updateProfile`
  removal triggers it) · D-F7-2 (a) deactivation DISABLE + track backend slice + class-(b)
  security finding · D-F7-3 (a) logo WIRE the defer · D-F7-4 (a) doc-remove WIRE the defer ·
  D-F7-6 TWO commits.
- **Audit refresh (F8):** records F7a + F7b under §17 (Phase-1f close); F7b contributes the
  caption-vs-wire CF promotion (with the D-F4-4 + D-F5-3 instances and the D-F6-5a
  counter-example) AND the class-(b) deactivation re-auth-broken-post-K security finding.
- **F7a precedent:** the commit `38c3dab` set the cascade precondition (`updateProfile` = 5,
  `mapAuthError` = 1); F7b executes the cascade.

---

## §9 — Carry-forward methodology

**CFs applicable to F7b:**

- **CF-6** docs-immediate for this plan-doc.
- **CF-7** gate-sweep for the F7b code commit.
- **CF-9** pause-summary with the §3.B + §3.C re-greps surfaced (exact stdout).
- **CF-10** drift verification — re-grep at §0 even though F7a CF-9 measurements are
  hours-old; counts can drift.
- **CF-22** surface-don't-guess on the §2 judgment calls AND any §3 anomaly.

**CF candidates surfaced for F8 promotion (recorded here, NOT promoted in F7b):**

- **"Caption-vs-wire" failure mode** — a defer/disable ruling is satisfied only when the wiring
  is severed, not when a caption announces it. Worked instances: D-F4-4 logo (F4a/b
  captioned-not-wired → F7b severed), D-F5-3 doc-remove (F5 captioned-not-wired → F7b severed),
  **counter-example** D-F6-5a MyAccount no-old password (F6 — correctly severed at the source,
  proves the pattern CAN be done right). Reporting corollary: "disabled" in a CF-9 must mean
  *path-severed*; if it means *caption added, wiring deferred*, say so explicitly.
- **Class-(b) deactivation security finding** — pre-K re-auth gated the destructive action via
  Supabase auth; post-K the Supabase auth store is no longer the password source, so the gate
  becomes a broken no-op. F7b's defensive disable closes a UX honesty gap (the user could
  click a control that looks like a confirmed deactivation but silently skips the broken gate).
  Track as a Phase-1g+ slice: `POST /api/account/deactivate` with `current_password`
  verification (mirrors `/api/password/change`).

**Cross-references to existing memory:**

- [[design-source-of-truth-consultation]] — F7b's §2 treatments came from reading the actual
  control source, not from memory of what F4/F5 promised.
- [[dead-ui-detection-patterns]] — the F7 scoping caught both (a) the setter-to-true pattern
  (handlers still wired despite `disabled` attribute) and (b) the CSS-gated pattern (the
  `className="hidden"` MyAccount CTA in F7a). The caption-vs-wire CF is a **third pattern**:
  *attribute-gated unreachability* — controls visibly disabled (`disabled` attribute) but
  handlers still loaded.
- [[no-askuserquestion-architect-delivers-rulings]] — the §2 judgment calls are surfaced in
  prose at the CF-9 halt; the architect rules in prose.
- [[node-20-required-for-commits]] — §4.B PATH prefix.

---

## §10 — Files touched (for the §10 commit-file-list discipline)

**Estimated (confirmed at execution).** F7b expects ~5 files modified, no deletions, no
lockfile/api/test/docs:

```
M  apps/web/src/App.tsx                                                # only if a stale MyAccount-comparison comment surfaces (unlikely)
M  apps/web/src/features/advertiser/pages/UserProfile.tsx              # §2.A logo + §2.B doc-remove + §2.C deactivation + supabase import drop
M  apps/web/src/features/advertiser/hooks/useProfileMutations.ts       # uploadLogo + updateProfile mutations + supabase import drop
M  apps/web/src/features/auth/hooks/useOwnerProfileMutations.ts        # uploadLogo + removeDocument + deactivateAccount + updateProfile mutations + supabase import drop
M  apps/web/src/features/auth/services/auth.service.ts                 # updateProfile + deactivateAccount + mapAuthError removed (supabase import STAYS)
M  apps/web/src/features/screenhost/pages/OwnerSettings.tsx            # §2.A logo + §2.B doc-remove + §2.C deactivation (supabase import STAYS — wallet)
```

**Net: 5 files modified, no additions, no deletions. No `apps/api` files. No lockfile changes.
No new tests. No docs (the F8 audit + the CF promotion + the security finding writeup belong
to F8, not F7b).**

**LOC estimate (rough):** -300 to -500 lines (157 from `mapAuthError`, ~40 from `updateProfile`
body, ~10 from `deactivateAccount` body, ~60 from the page handlers, ~30 from the hook
mutations, ~20 from the deactivation form JSX, ~10 from the logo Enregistrer block, minus a few
+lines for the new "coming soon" deactivation message). Exact at CF-9.

---

## Document status

**Drafted, awaiting architect ratification.** The plan covers F7b (the 3 deferred-control
wirings + the cascade removals). Two §2 judgment calls surfaced:
- **§2.A logo display:** (i) keep placeholder / (ii) remove display / (iii) hide whole card
  (lean (i)).
- **§2.C deactivation form:** (i) "coming soon + contact support" message / (ii) static
  disabled button + caption only / (iii) hide section (lean (i)).

Pending architect ruling on those + general plan approval before opening §0 pre-flight.
