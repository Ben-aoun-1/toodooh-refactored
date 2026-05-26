# Phase 1f F7 — account-layer cleanup sweep (scoping read, read-only)

**Source:** `apps/web` (the in-scope account-layer files), read directly (CF-23 — source authoritative,
not assumption). **HEAD `b5e15cd`**, working tree clean. **Date:** 2026-05-26.

**Purpose.** A read-only inventory of what F7 (the bounded cleanup sweep) can actually remove now
that K → F1 → F2 → F3 → F4a → F4b → F5 → F6 have all landed CI-green. The keystone §2.D precedent
(K's "delete 3 methods" orphaned live F2-deferred callers, caught by the caller-check) sets the
bar: every removal candidate is **caller-checked from source** before it earns "dead." This doc
proposes a F7 plan and surfaces the **MyAccount** decision (D-F6-5b carry-forward) + three new
deferred-control gaps that the per-flow rulings (D-F4-4, D-F5-3) **named but never wired**.

**No code edits, no commits this turn** (file reads + grep only). The proposals are to **ratify,
not execute** (CF-22) — the load-bearing F7 decisions are surfaced in §7 for the architect, not
resolved unilaterally.

**Companion docs.** `phase-1f-keystone-design.md` §3.2 (the keystone boundary — what was promised
deferred to F1–F6); the per-flow scopings (`phase-1f-f4-*`, `phase-1f-f5-*`, `phase-1f-f6-*`) for the
D-rulings; `frontend-repoint-survey.md` §2.4 (the lint-1 floor refinement); `audit.md` §16 (the
Phase-1e Part A renumbering + the §7.6 truthful-to-frontend operating pattern).

> **Governing principle (CF-24 truthful-to-frontend + the bounded-cleanup discipline).** F7 removes
> ONLY account-layer Supabase code that's **source-verified dead** (zero callers). `supabase.ts`
> STAYS through 1f (59 later-slice files still import it; §6). Anything with a surviving caller is
> **surfaced**, not silently removed.

---

## §1 — Dead-removal inventory (per candidate, caller-checked from source)

Grep across `apps/web/src` for callers of each candidate, excluding the candidate's defining file.
Listed by disposition.

### §1.A — Source-verified DEAD (zero external callers; safe to remove in F7)

| Candidate (defining file:line) | Callers (excl. self) | Ruling that made it dead |
|---|---|---|
| `authService.getCompanySizeOptions` (`auth.service.ts:522`) | **0** | D8 (keystone) — hardcoded FE constant |
| `authService.getSupportObjectivesForAdvertiserAgency` (`auth.service.ts:531`) | **0** | D8 — leave-on-Supabase OR remove if zero-caller (latter is the source-truth) |
| `authService.getSupportObjectivesForOwners` (`auth.service.ts:540`) | **0** | D8 — same |
| `mapAuthError` (`auth.service.ts:23–179`, ~157 ln) | **0 external** (internal-only: see §2) | Keystone (K) — superseded by `apiErrorMessage` |

**Per-candidate caller-check evidence:**

- `getCompanySizeOptions` — grep returned no hits outside `auth.service.ts`. Phase-1e Part A
  Commit 3 deliberately did not build a `/api/company-sizes` endpoint (audit §16 / §7.6
  dead-infrastructure-avoided); D8 ruled hardcoded FE constant. The wizard's FR-locale options
  were already hardcoded inline; no caller bound this method.
- `getSupportObjectivesForAdvertiserAgency` + `getSupportObjectivesForOwners` — grep returned no
  hits outside `auth.service.ts`. (Distinct from `getAppointmentObjectives`, which IS live — see
  §1.B.) D8 ruled support_objectives leave-on-Supabase as later-slice; these two specific named
  methods are the **zero-caller form**, dead independently of the slice scope.
- `mapAuthError` — grep returned one hit at `features/auth/services/auth-errors.ts:5` (a comment
  documenting `apiErrorMessage` as its successor — **not a code reference**). Internal callers
  inside `auth.service.ts` are the 3 dead methods above + the `updateProfile`/`deactivateAccount`
  fallbacks (the surviving callers, §1.B). Disposition is therefore coupled to §2.

> **Caveat — F4 plan-doc "kept-dead" framing inverted.** The prompt described
> `updateProfile`/`updateBusinessProfile` as F4-kept-dead generic methods. **Source disagrees** —
> both have surviving callers (§1.B); the F4 commit deliberately KEPT them because the deferred
> handlers (logo upload/remove, RNE-doc clear, MyAccount, wallet bank-details) still need them.
> The genuinely zero-caller methods are the four listed in §1.A.

### §1.B — Surviving callers — NOT dead (SURFACE)

These are NOT removable in F7 — each has a live caller path the per-flow commits did not
repoint. The F4-leftover narrative the prompt carried (`updateProfile`/`updateBusinessProfile`
as "kept-dead") is inverted by source: every per-flow commit deferred something to these methods.

| Method | Caller sites | Defer/ruling that left it live |
|---|---|---|
| `authService.updateProfile` (`auth.service.ts:465–500`) | `useProfileMutations.uploadLogo` (`:75`) · `useProfileMutations.updateProfile` direct (`UserProfile.tsx:373,407` — logo-remove + 1 generic write) · `useOwnerProfileMutations.uploadLogo` (`:114`) · `useOwnerProfileMutations.updateProfile` direct (`OwnerSettings.tsx:444` — logo-remove) · `useOwnerProfileMutations.removeDocument` (`:138` — RNE clear, fleet owner) | **D-F4-4 logo defer + D-F5-3 doc-remove defer — NEITHER WAS WIRED** (see §3) |
| `authService.updateBusinessProfile` (`auth.service.ts:276–300`) | `MyAccount.tsx:165` (the F4-leftover save-all blob) · `useSaveBankDetails.ts:68` (owner bank details — money/later-slice) · `useOwnerProfileMutations.updateBusinessProfile` (`:84`, exposes the mutation; only the wallet `useSaveBankDetails` consumes it externally — MyAccount calls through this hook) | **D-F6-5b** (MyAccount F4-leftover, the §5 decision) + **wallet/money slice** (out-of-scope until that slice) |
| `authService.deactivateAccount` (`auth.service.ts:454–463`) | `UserProfile.tsx:334` (advertiser deactivate) · `useOwnerProfileMutations.deactivateAccount` (`:97`) → `OwnerSettings.tsx:406` (owner deactivate) | **NEW** — no `apps/api` deactivation endpoint exists; **plus the re-auth gate at `UserProfile.tsx:325` + `OwnerSettings.tsx:397` (direct `supabase.auth.signInWithPassword`) will guaranteed-fail post-K** because Supabase auth is no longer the source of truth — the FE password is in apps/api's `users` table (§3.A) |
| `authService.getAppointmentObjectives` (`auth.service.ts:549–569`) | `useAppointmentObjectives.ts:16` · `contexts/ModalContext.tsx:82` | **D8** — leave-on-Supabase (later-slice, scope-tight); harmless because it has a graceful fallback to `[]` |

**Additional surviving direct-Supabase sites in account-layer pages/hooks** (separate from the
service-method candidates above):

- **`supabase.storage.from('registres').upload` + `createSignedUrl`** — `useProfileMutations.ts:67,71`
  (advertiser uploadLogo) + `useOwnerProfileMutations.ts:106,110` (owner uploadLogo). Direct
  Supabase storage writes. **D-F4-4 logo defer unimplemented** (§3.B).
- **`supabase.from('business_profiles').update({cin_doc_url:null})`** — `useOwnerProfileMutations.ts:132`
  (individual-owner CIN remove path). **D-F5-3 document-remove defer unimplemented** (§3.C).
- **`supabase.auth.signInWithPassword`** — `UserProfile.tsx:325` + `OwnerSettings.tsx:397`
  (deactivation re-auth gate). **§3.A — the deactivation flow has no backend at all.**
- **`supabase.storage.from('registres').createSignedUrl`** at `OwnerSettings.tsx:522` — the BANK
  document view (money-slice / later-slice, out-of-scope; flagged here only so it's not mistaken
  for an account-layer site).

---

## §2 — `mapAuthError` disposition

**Grep result:** 0 external callers. Internal callers inside `auth.service.ts`:
- `updateProfile:499` — `throw new Error(error.message || mapAuthError(error))` (fallback when
  the Supabase error has no `.message`)
- `getCompanySizeOptions:527` · `getSupportObjectivesForAdvertiserAgency:536` ·
  `getSupportObjectivesForOwners:545` — error throws (all four go in §1.A)

**Disposition options:**

- **(a) Remove with the §1.A deletions and re-target `updateProfile`'s fallback** — switch line
  `:499` to `throw new Error(error.message || 'Erreur lors de la mise à jour du profil')` or just
  `error.message` (the Supabase update error always has `.message` in practice; the `|| mapAuthError`
  is a paranoid fallback). The 157-line French-message map is gone — its branches were
  Supabase-error-text heuristics that no longer occur (the keystone §1.4 retirement rationale was
  already ratified).
- **(b) Keep `mapAuthError` until `updateProfile` leaves** — wait for D-F4-4 / D-F5-3 to be wired
  (handlers + supabase calls removed → `updateProfile` then becomes zero-caller). Heavier blast
  surface, defers a clean ratchet.

**Lean: (a)** — apiErrorMessage is the keystone successor (already ratified); the 157-line dead
map is the largest single chunk of F7's typecheck-floor ratchet-down opportunity; the
`updateProfile` retarget is mechanical (one line).

---

## §3 — Three deferred-control gaps the per-flow rulings named but never wired

These are NOT in the prompt's scoping list; they were **surfaced by the §1.B caller-check** and
reframe what F7 is. Each is a per-flow defer-ruling that left dead-Supabase code in a live UX
path. They explain why §1.B is full of surviving callers.

### §3.A — Deactivation has no backend (a new carry-forward)

- **FE surfaces:** `UserProfile.tsx:309–342` (advertiser delete-account confirm modal) ·
  `OwnerSettings.tsx:381–415` (owner "Confidentialité → Désactiver" form).
- **Two Supabase calls per surface:** (i) `supabase.auth.signInWithPassword(email, password)` —
  password re-auth gate; (ii) `authService.deactivateAccount()` →
  `supabase.from('business_profiles').update({is_active:false})`.
- **Both are now broken**, not just dead-Supabase:
  - (i) Supabase Auth is no longer the password source; the user's bcrypt hash is in apps/api's
    `users` (K-keystone). `signInWithPassword` against Supabase will fail for every account
    created or password-reset after Phase 1b.
  - (ii) `business_profiles.is_active` column may not even exist in the apps/api schema (Phase 1c
    migrations); writes route to a Supabase DB that the FE no longer reads.
- **No `apps/api` endpoint** matches this flow. Phase 1d shipped `/api/password/change` (re-auth +
  change) but not `/api/account/deactivate` or `/api/auth/verify-password`.
- **F7 disposition options:**
  - **(a) Disable the controls in F7** — gray out the deactivation form + caption "Bientôt
    disponible" (matches the D-F4-4 pattern); keeps the dead-Supabase code unreachable. The
    methods (`deactivateAccount`, the re-auth) stay until a backend slice ships.
  - **(b) Track as a new Phase-1 slice** — `POST /api/account/deactivate` (current_password +
    `is_active` column / soft-delete column) — backend work, not F7.
  - **(c) Both** — disable in F7 (a) AND track (b) as a carry-forward.
- **Lean: (c).** Disabling is bounded and prevents a guaranteed user-facing failure; the backend
  slice is the proper fix on its own timeline.

### §3.B — Logo upload/remove (D-F4-4 "defer" was never wired)

- **Ruling (F4a §4 / D-F4-4):** "cosmetic → DEFER. The logo upload is already dead (Supabase
  gone); F4 leaves" — the prose said defer.
- **Source state:** `UserProfile.tsx:357–376` (advertiser handleLogoUpload/Remove) +
  `OwnerSettings.tsx:430–449` (owner) — the handlers, onClick wiring, and visible "Modifier le
  logo" + "Supprimer" buttons are **fully present and functional**. The "Bientôt disponible"
  text exists as a static caption (`UserProfile.tsx:670`, `OwnerSettings.tsx:844`) but it sits
  beside the still-active buttons, not gating them.
- **Live dead-Supabase chain:** click "Modifier" → `uploadLogo.mutate(file)` →
  `supabase.storage.from('registres').upload(...)` + `.createSignedUrl(...)` →
  `authService.updateProfile({logo_url: signed.signedUrl})` → `supabase.from('business_profiles').update(...)`.
- **F7 disposition options:**
  - **(a) Wire the defer in F7** — disable Upload + Remove buttons, remove the `uploadLogo`
    mutation + its Supabase calls, remove the logo-remove handler (the `updateProfile.mutateAsync({
    logo_url: null })` call). `updateProfile`'s logo-related callers go to zero on that surface.
  - **(b) Leave as-is** — track as a carry-forward; logo upload+remove stays dead-Supabase
    (currently broken: Supabase storage RLS likely rejects without the auth.uid match).
- **Lean: (a).** F7 finally lands what F4 promised. **Note:** even (a) doesn't make
  `updateProfile` zero-caller — D-F5-3 (§3.C) keeps it live for RNE-clear unless that's also
  wired.

### §3.C — Document REMOVE (D-F5-3 "disable" was never wired)

- **Ruling (F5 §3 / D-F5-3):** "no DELETE endpoint → disable the remove control (defer)."
- **Source state:** `OwnerSettings.tsx:485` (`removeDocument.mutateAsync(isIndividualOwner)`) —
  the Remove button + handler exist. UserProfile (advertiser RNE) — grep shows no
  `removeDocument` call there, so advertiser RNE-remove is not surfaced (only owner).
- **Live dead-Supabase chain (owner only):**
  - Individual owner CIN clear → direct `supabase.from('business_profiles').update({cin_doc_url:null})`
    (`useOwnerProfileMutations.ts:132`).
  - Fleet owner RNE clear → `authService.updateProfile({ registration_doc_url:null,
    registration_doc_path:null })` → dead-Supabase update.
- **F7 disposition options:**
  - **(a) Wire the defer in F7** — disable/hide the Remove button in OwnerSettings; remove the
    `removeDocument` mutation. Removes both Supabase sites and the `updateProfile` RNE-clear
    caller.
  - **(b) Leave as-is** — track as a carry-forward; remove stays broken silently.
- **Lean: (a).** Same reasoning as §3.B.

> **If (a) is taken for BOTH §3.B and §3.C**, `updateProfile`'s surviving callers go to zero
> (the entire logo + RNE-clear surface) → `updateProfile` itself becomes removable; the broader
> `mapAuthError`+`updateProfile` cleanup compounds.

---

## §4 — `performance.service.ts:449` (the §5.3 site flagged since F1)

**Source-verified out of F7.**

- File path: `apps/web/src/features/performances/services/performance.service.ts:449`
  (a second `owner_business_sectors` table read; the first lives in F1's already-repointed
  `authService.getOwnerBusinessSectors`).
- The performances feature folder is **later-slice** (frontend-repoint-survey §2.3:
  "Performances/notifications/global-config — `performance.service.ts`, …, stay on Supabase").
- F7 is bounded to the **account layer**. Even though the data-source name (`owner_business_sectors`)
  matches an F1 reference read, the **consumer is later-slice**; F7 has no business retargeting
  later-slice services.
- **Disposition: OUT of F7.** Inherited as part of the later-slice performance/dashboards repoint
  whenever that slice ships.

---

## §5 — MyAccount disposition (D-F6-5b — the real F7 decision)

The one genuine F7 decision per the prompt; everything else has a clear source-led answer.

### §5.A — What MyAccount actually is (source evidence)

- **File:** `apps/web/src/features/screenhost/pages/MyAccount.tsx` — 848 lines.
- **Route:** `/my-account` in `App.tsx:482` (OwnerRoute, lazy-loaded `App.tsx:50`).
- **UX shape:** 4-step wizard (Profil / Entreprise / Adresse / Validation) — visually mirrors the
  signup wizard. Step 1 collects firstName/lastName/email/phone (split contact_name client-side).
  Step 2 collects business_name/tax_number/business_sector_id/business_type, with owner-specific
  fields (`businessType`, `taxNumber`, `registrationDocUrl`) disabled per `isFieldDisabled` at
  `:199–207`. Step 3 collects street_address/city/postal_code/governorate_id. Step 4 ("Validation")
  shows the document upload control (handled by F5's `uploadDocument` — **this part works**,
  `:122–138`).
- **Save (the F4 leftover, `:140–197`):** on submit, builds one `updateData` blob of business +
  contact + address + `registration_doc_url` fields → `profileMutations.updateBusinessProfile.mutateAsync(updateData)`
  → dead-Supabase (`supabase.from('business_profiles').update(...)`).
- **F6 already pruned the password field** (`:143` comment confirms — no-old password change
  removed; the with-old path lives in OwnerSettings → Confidentialité).

### §5.B — Is MyAccount actually used?

**No live nav path.** Grep results across `apps/web/src` for `/my-account`:

- `App.tsx:482` — the route definition itself.
- `OwnerDashboard.tsx:429` — the **only nav site**, and its button is rendered with
  `className="hidden p-2 ..." aria-hidden`. **The class `hidden` removes the button from layout;
  `aria-hidden` removes it from assistive tech.** Reachable only by typing `/my-account` directly
  in the URL bar.

Conclusion: MyAccount is a **hidden, orphaned duplicate** — present in code but invisible in the
UI today.

### §5.C — Does MyAccount duplicate OwnerSettings?

**Yes, fully** — OwnerSettings (`/owner-settings`, 1885 ln, the live edit surface) has section tabs
with sub-tabs covering every MyAccount section AND more:

- OwnerSettings: Responsable / Entreprise (sub-tabs: Documents légaux, Coordonnées bancaires, …) /
  Adresse / Notifications / Confidentialité (with password change + deactivation).
- MyAccount: Profil / Entreprise / Adresse / Validation (document upload).

Every MyAccount field has a section-PATCH counterpart in OwnerSettings (which F4b already
repointed). The document upload (MyAccount Step 4) is also in OwnerSettings → Entreprise → Documents
légaux. **MyAccount provides nothing OwnerSettings doesn't.**

### §5.D — Disposition options (for ruling)

- **(a) CONSOLIDATE (lean) — delete MyAccount.** Remove the route at `App.tsx:482–489`, the lazy
  import at `App.tsx:50`, the hidden CTA at `OwnerDashboard.tsx:425–434`, and the page file
  `MyAccount.tsx` (848 ln gone). Removes the `updateBusinessProfile` MyAccount caller (its
  `useOwnerProfileMutations` hook entry stays only for the wallet's `useSaveBankDetails` consumer
  — out of F7). Negative LOC; lower risk; the page is unreachable from navigation today, so
  removal has no user-visible effect.
- **(b) REPOINT — keep MyAccount, swap the save.** Replace the `updateBusinessProfile` call at
  `:165` with `Promise.all([updateContact.mutateAsync(...), updateBusiness.mutateAsync(...),
  updateAddress.mutateAsync(...)])` using the F4 section methods already exposed on
  `useOwnerProfileMutations`. `registration_doc_url` is not in the F4 section methods — keep it
  out of the save blob (the document upload at Step 4 already handles it via F5). ~30 line
  change; preserves the wizard view should someone surface it later.
- **(c) Hybrid — hide the route + repoint the save as a defensive belt-and-braces.** Both
  removes the live UX and makes the save not-dead. Over-cautious; adds work for no benefit if (a)
  is taken.

**Lean: (a) CONSOLIDATE.** Source-driven: page is invisibly orphaned (hidden CTA, no nav link),
fully duplicated by OwnerSettings, and the save blob shape doesn't even match the new section-PATCH
boundary. Deleting a 848-line dead page is the cleanest cleanup. If the user values the wizard UX
specifically, (b) is the fallback (it preserves the page; the save becomes clean).

---

## §6 — lint-1 floor (does F7 clear it or not?)

**Source-verified: lint-1 STAYS through F7.**

- **`database.types` references:** grep across `apps/web/src` for `database.types` / `Database`
  identifier returns exactly two files:
  - `lib/supabase.ts:3` — `import { Database } from './database.types';` (the lint-1 site;
    `database.types` file does not exist — confirmed absent).
  - `features/auth/services/auth.service.reference.test.ts:7–9` — a **comment** + a `vi.mock('@/lib/supabase')`
    that stubs the module precisely to **avoid pulling in the missing database.types** at test
    runtime. Not a real reference.
- **Supabase-client importers:** 59 files import `from '@/lib/supabase'` — almost all later-slice
  (campaigns, screens, wallet, admin, performances, events, scripts). Accounts-layer importers
  that survive after F7 = whichever §3 dispositions take (a) vs (b). Even if every (a) is taken,
  the later-slice 50+ keep `supabase.ts` alive.
- **Therefore:** F7 cannot delete `supabase.ts`, therefore cannot remove its
  `./database.types` import, therefore lint-1 stays at 1. This matches the survey §2.4 prediction
  and audit §16 / §7.6's "the lint-1 clear is gated on the last slice or #15, not Phase-1e/1f."

**Expected, not a regression.** F8's audit refresh should record the lint-1 hold as the
all-of-1f pattern (was the prediction; held).

---

## §7 — Sub-factoring + test bar

### §7.A — One commit vs split

**Lean: one commit** if §3.B + §3.C (logo defer + doc-remove defer) are scoped IN; **split** if
they are or aren't (architect rules):

- **F7a — pure deletion** (the §1.A four candidates + §2 `mapAuthError` retarget + §5 MyAccount
  disposition). Smaller, lower-risk, ratchets `apps/web` typecheck (the 157-line `mapAuthError`
  has TODO+any branches that have been blocking the floor).
- **F7b — the deferred-control wirings** (§3.A disable deactivation control · §3.B disable logo
  controls + remove uploadLogo · §3.C disable removeDocument). Each is small but UX-visible;
  worth a visual-QA pause.

**Single-commit** keeps things cohesive but is heavier (more files touched). **Two commits** keeps
the deletion clean and the UX-visible wiring isolated. Lean **TWO** if §3.B/§3.C are taken;
**ONE** if §3.A/§3.B/§3.C all defer to carry-forwards (then F7 is pure §1.A+§2+§5 deletion).

### §7.B — Test bar

- **§1.A removals:** zero new tests. The 4 methods are zero-caller; removal can't break
  existing tests (the existing F1 reference-reads test (`auth.service.reference.test.ts`) covers
  the live methods only).
- **§2 mapAuthError retarget:** zero new tests (the `updateProfile` fallback retargeting is a
  one-line change; no test currently covers `updateProfile`'s error path).
- **§5 MyAccount (a):** zero new tests (the page goes; OwnerSettings' F4b tests cover the live
  surface). For (b): one node test for `MyAccount` that mocks `useOwnerProfileMutations` and
  asserts `submit` calls `updateContact + updateBusiness + updateAddress` — reuses the F4
  service-method tests, no new RTL infra (the trade D-F4-5 / D-F6-6 already ruled).
- **§3 disable wirings:** zero new tests (UI-visible work; covered by the **phase-close human QA**
  per F8 — the visual-QA gate the assistants can't simulate).

**Floor expectations** (for the architect to ratify in plan-write):

- `apps/web` typecheck — **drops** (the 157-line mapAuthError carries `@typescript-eslint/no-explicit-any`
  + `TODO(phase-1): typed source [supabase]` tags that have been on the floor; the 4 dead methods
  + their Supabase calls remove additional Supabase-untyped surface).
- `apps/web` lint — **stays 1** (§6).
- `apps/web` tests — stays 217+ (no test deletions; if §5(b) adds a MyAccount test, +1).
- `apps/web` build — flat to slightly down (a 848-line page removal in (a) shrinks the lazy
  chunk).
- `apps/api` — untouched (146).

---

## §8 — Decisions for architect ruling (CF-22)

Surfaced with a lean each; **not resolved here**.

- **D-F7-1 — `mapAuthError` disposition.** (a) remove now + retarget `updateProfile` fallback OR
  (b) keep until `updateProfile` becomes zero-caller via §3.B+§3.C. *Lean: (a).*
- **D-F7-2 — Deactivation flow (§3.A, NEW carry-forward).** (a) disable controls in F7 + track
  backend slice OR (b) leave-as-is + track OR (c) hybrid. *Lean: (c) — disable + track.*
- **D-F7-3 — D-F4-4 logo defer (§3.B).** (a) wire the defer in F7 (disable + remove
  `uploadLogo` Supabase calls) OR (b) leave-as-is + track. *Lean: (a) — F7 finally lands what F4
  promised.*
- **D-F7-4 — D-F5-3 doc-remove defer (§3.C).** (a) wire the defer in F7 (disable + remove
  `removeDocument` Supabase calls) OR (b) leave-as-is + track. *Lean: (a).*
- **D-F7-5 (load-bearing) — MyAccount disposition (§5).** (a) CONSOLIDATE/delete the page +
  route + hidden CTA OR (b) REPOINT the save via the 3 section PATCHes OR (c) hybrid. *Lean: (a).*
- **D-F7-6 — Sub-factoring (§7.A).** One commit vs F7a/F7b split. *Lean: depends on D-F7-3+4 —
  one commit if those go OUT (track); F7a/F7b split if those go IN.*
- **D-F7-7 — performance.service §5.3 site (§4).** Confirm OUT of F7 (later-slice). *Lean:
  OUT (confirmed).*

**Watch items** (after architect ruling):

- If D-F7-3 = (a) AND D-F7-4 = (a): `updateProfile`'s callers go to zero on the logo + doc-clear
  surface → also remove `updateProfile` itself (+ retarget its single deactivate fallback). The
  compound cleanup is larger than the sum.
- If D-F7-5 = (b) repoint: confirm at plan-write that `useOwnerProfileMutations` exposes
  `updateContact/updateBusiness/updateAddress` (it does, F4b lines 54–67) and that MyAccount's
  field-naming matches the section PATCH shapes (it does — snake_case via `updateData`).

---

## Document status

**Read-only F7 scoping (CF-22 — held, awaiting architect rulings on D-F7-1…D-F7-7).** Established
from source: 4 source-verified-dead methods (§1.A); inverted the prompt's "kept-dead" framing
(every per-flow defer left a surviving caller, §1.B); identified 3 deferred-control gaps the
per-flow rulings named but never wired (§3 — deactivation, logo, doc-remove); ruled
performance.service §5.3 OUT (§4); resolved MyAccount with source evidence as a hidden orphaned
duplicate (§5, lean CONSOLIDATE); confirmed lint-1 STAYS through F7 (§6 — `database.types` only
in `lib/supabase.ts`, 59 later-slice importers keep `supabase.ts` alive); proposed sub-factoring
+ test bar (§7); surfaced 7 decisions for ruling (§8). Plan-doc + commits follow ratification.
