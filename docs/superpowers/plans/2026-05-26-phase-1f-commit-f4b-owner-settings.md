# Phase 1f — Commit F4b: profile edits — owner OwnerSettings

**Status:** DRAFT (F4b.0) — held for review. §2 + the test bar are ruled; the plan folds them.
**Design authority:** `phase-1f-f4b-owner-settings-scoping.md` (§2 ruled: relax the entreprise
validation; test bar: no new tests, reuse).
**Region:** `apps/web` only (reuses the F4a section methods + the `/api/me` read bridge; no backend).
**HEAD at draft:** `b320f4c` (F4a shipped).

The owner half of profile edits — the last surface at pre-F4 dead-Supabase. Wires `OwnerSettings`'
4 field sub-forms to the **F4a section methods** (already built + tested). Pure wiring + the §2
validation relax + the logo/owner-extras honest-disable. **No new tests (reuse F4a).** One commit.

---

## §0 — Pre-flight verification (CF-10)

- `git status` clean; HEAD `b320f4c`.
- Floor: **apps/web typecheck 44 · lint 1 · test 205 (28 files) · build 137.59 kB gzip**; apps/api 146
  (untouched). Re-run; record actuals.
- Node 20 PATH.
- **Verified (the §2 ruling's check):** the `users` table has **no** `number_of_screens`/
  `number_of_rooms`/`company_size` columns; `/business` PATCH strips them → owner-extras are
  **genuinely non-persisted in slice 1** (a real reduction vs the Supabase legacy; owner-slice adds
  the columns).

---

## §1 — Locked constraints (rulings)

- The 4 owner field sub-forms → the **F4a section methods** 1:1 (scoping §1).
- **governorate_id** (adresse) `||null`→`||undefined` (the F4a null→400 fix); zone/fonction stay
  `||null` (nullable).
- **§2 ruling — relax the entreprise validation:** DROP the required-checks on
  `number_of_screens`/`number_of_rooms`/`company_size` (requiring non-persisting fields is the trap).
  The persisted fields (business_name/tax/sector) save unblocked.
- **Owner-extras honest-disable:** the screens/rooms/company_size inputs → **disabled + "Bientôt
  disponible"** (same family as logo/D-F4-4 — don't let the user enter data that silently vanishes).
  The wire still **forwards** them (empty → backend-stripped) for forward-compat (the owner slice
  re-enables the inputs + adds columns; the wire needs no change then).
- **Logo** → disabled + "Bientôt disponible" (like F4a, D-F4-4).
- **Deferred (leave dead-Supabase, pre-F4 status quo):** password (F6), documents (F5), bank
  (money-slice), deactivate (later).
- **Test bar — NO new tests (reuse F4a):** the load-bearing logic (section methods + `/api/me`
  mapping + the JSON-drop guard) is F4a-tested; F4b is wiring → gates + reuse + phase-close human QA.
- **CARRY-FORWARD (track):** owner-extras (screens/rooms/company_size) persistence → the **owner
  slice** (add columns + stop stripping + re-enable the inputs).

---

## §2 — Inventory (CF-23 from source) + files

| File | Action |
|---|---|
| `features/auth/hooks/useOwnerProfileMutations.ts` | add 4 section mutations (→ the F4a `authService.updateProfile{Contact,Business,Address,Notifications}`); keep the generic `updateProfile`/`updateBusinessProfile` (logo/doc/bank) + password/deactivate/upload mutations (F6/F5/D9/later) |
| `features/screenhost/pages/OwnerSettings.tsx` | route the 4 field handlers → the section mutations; `governorate_id` `\|\|undefined`; relax the entreprise validation (§2); disable the owner-extras inputs + note; disable the logo control + note |

**No new test file** (reuse F4a's `auth.service.profile.test.ts` — the methods are shared + tested).

### §2.A — Owner read already works (F4a bridge)
`getBusinessProfile` (F4a) already serves owner reads (`/api/me` → BusinessProfile). The owner section
fields + notifications load correctly; the deferred fields (logo/bank/doc-urls + owner-extras) map
`undefined` → render empty. No read change in F4b.

### §2.B — Generic methods stay (deferred owner writes)
`useOwnerProfileMutations` keeps: `updateProfile` (logo-remove, RNE-doc-remove — dead),
`updateBusinessProfile` (bank — dead, money-slice), `updatePasswordWithOld`/`updatePassword` (F6),
`deactivateAccount` (later), `uploadLogo`/`uploadDocument`/`removeDocument` (D9/F5). F4b adds the 4
section mutations alongside; it does NOT remove the generic ones.

---

## §3 — Commit factoring

**One commit (F4b).** `OwnerSettings` 4 handlers + the owner hook's 4 section mutations + the §2
relax + the two honest-disables. Localized despite the big page; reuses tested methods.

---

## §4 — Per-commit verification gates

- `pnpm typecheck` — green; floor **≤ 44** (wiring reuses typed methods; likely flat 44, possibly a
  small drop if any owner supabase-typed line leaves).
- `pnpm lint` — green; **1** (database.types floor).
- `pnpm test` — green; **205** (no new — reuse).
- `pnpm build` — green; **~137.59 kB** ± (validation-drop + disables; ~flat). apps/api **146**.

---

## §5 — Standing operating procedure

Node-20 PATH. Conventional Commits, no `Co-Authored-By`. CF-7 gate-sweep. Husky lint-staged. (No new
`apiClient` mocks — no new tests.)

---

## §6 — Hard-halt conditions

- Owner section save 400s on a value the form sends (the governorate_id null case — covered by
  `||undefined`; verify in human QA / a quick running-both check) → halt.
- Removing the entreprise required-checks breaks a TYPE (e.g. an unused var) → fix or surface.
- Any gate regresses → revert, surface.
- An owner sub-form turns out to send a field no section method accepts (scoping said clean) → halt.

---

## §7 — Risk register

- **owner-extras non-persistence (§2, named reduction):** load-empty + save-stripped — handled by the
  disable+note (no vanishing-data trap) + the relaxed validation (the persisted save isn't blocked).
  Tracked for the owner slice.
- **governorate_id null→400:** `||undefined` (the F4a fix); the JSON-drop guard (F4a) covers the
  mechanism. zone/fonction stay `||null` (nullable, clears).
- **No new tests:** the wiring + the governorate_id fix are component-layer (RTL-territory, deferred);
  the underlying methods/mapping/JSON-drop are F4a-tested. Human QA at phase close exercises the owner
  page. Honest node-only edge (D-F4-5).
- **Disabling inline entreprise inputs:** a rendered change (3 inputs disabled + a note + logo
  disabled) — a light visual glance; not full frontend-design.

---

## §8 — Cross-references

- Scoping: `phase-1f-f4b-owner-settings-scoping.md`. F4a: the section methods + the read bridge + the
  JSON-drop guard (`auth.service.profile.test.ts`, `api-client.test.ts`).
- **Tracked later items:** owner-extras persistence (owner slice: columns + un-strip + re-enable
  inputs); logo storage (D9 slice); the inline-`#76E6AB` styling pass; owner deactivate endpoint;
  the logo-disabled-vs-bank/doc-still-clickable UX inconsistency (later cleanup).

---

## §9 — Carry-forward methodology

- **CF-24** truthful-to-frontend: persist what has columns; the owner-extras' non-persistence is
  surfaced honestly (disabled+note), not faked; forward-compat wire kept.
- **CF-22** the §2 wrinkle surfaced + ruled (relax + honest-disable) — not shipped as a trap.
- **Reuse over re-test:** F4b adds no tests because it adds no load-bearing logic (the methods/mapping
  are F4a-tested) — the node-only bar applied to a pure-wiring commit.
- **RTL still not stood up** — F4b reinforces that service-layer logic + human QA may mean RTL never
  stands up in 1f.

---

## §10 — Push policy + sequencing

F4b.0 plan → push (CF-6). F4b.1 code → CF-7 gate-sweep → CF-9 pause → push on approval → CI verify.
A **light visual glance** at the owner page (the section saves work; extras + logo show "Bientôt
disponible") is reasonable; the gate is the reused F4a tests + phase-close human QA. No deps/backend.

---

## §11 — Exact changes (F4b.1)

### §11.1 — `useOwnerProfileMutations.ts` — add 4 section mutations
After the existing `invalidateProfile`, add (mirroring F4a's `useProfileMutations`):

```ts
const updateContact = useMutation({
  mutationFn: (patch: Parameters<typeof authService.updateProfileContact>[0]) =>
    authService.updateProfileContact(patch),
  onSuccess: invalidateProfile,
});
const updateBusiness = useMutation({
  mutationFn: (patch: Parameters<typeof authService.updateProfileBusiness>[0]) =>
    authService.updateProfileBusiness(patch),
  onSuccess: invalidateProfile,
});
const updateAddress = useMutation({
  mutationFn: (patch: Parameters<typeof authService.updateProfileAddress>[0]) =>
    authService.updateProfileAddress(patch),
  onSuccess: invalidateProfile,
});
const updateNotifications = useMutation({
  mutationFn: (patch: Parameters<typeof authService.updateProfileNotifications>[0]) =>
    authService.updateProfileNotifications(patch),
  onSuccess: invalidateProfile,
});
```
Add the four to the `return { … }` (keep all existing members — the generic/password/upload/deactivate
mutations stay).

### §11.2 — `OwnerSettings.tsx`

**Handlers (route to the section mutations):**
- `handleSaveResponsable` → `profileMutations.updateContact.mutateAsync({ contact_name, contact_phone, fonction: responsableForm.fonction || null })`.
- `handleSaveEntreprise` → `profileMutations.updateBusiness.mutateAsync({ business_name, tax_number, business_sector_id, number_of_screens: ns, number_of_rooms: Number.isNaN(nr) ? null : nr, ...(isFleetOwner ? { company_size: entrepriseForm.company_size || null } : {}) })` — wire unchanged (the extras forwarded + backend-stripped, forward-compat); **DROP the validation** at `:282–285` (`!number_of_screens || !number_of_rooms`) and `:286–289` (fleet `company_size`). KEEP the business_name/tax (`:274`) + business_sector_id (`:278`) required-checks.
- `handleSaveAdresse` → `profileMutations.updateAddress.mutateAsync({ street_address, city, postal_code, governorate_id: adresseForm.governorate_id || undefined, zone: adresseForm.zone?.trim() || null })` — **`||null`→`||undefined`** for governorate_id; zone stays `||null`.
- `handleSaveNotifications` → `profileMutations.updateNotifications.mutateAsync({ notify_* })`.

**UI honest-disables (locate the controls; principle: don't let the user enter vanishing data):**
- **Owner-extras inputs** (the entreprise `number_of_screens`/`number_of_rooms` inputs + the fleet
  `company_size` input): add `disabled` + a small "Bientôt disponible" note. (They load empty from the
  bridge; disabled prevents entering data that strips.)
- **Logo control** (the `uploadLogo`/`handleLogoRemove` affordance): `disabled` + "Bientôt disponible"
  (same as F4a — keep the handlers referenced so no unused-var; preview stays, empty).

**Leave untouched (deferred, pre-F4 dead):** password sub-form (F6), documents upload/remove (F5),
bank sub-form (money-slice), deactivate (later) — all still call their generic/dead mutations.

(No `OwnerSettings` read change — the F4a bridge already serves it.)

### §11.3 — Tests
**None added** (reuse F4a's `auth.service.profile.test.ts` for the shared methods + mapping, and
`api-client.test.ts` for the JSON-drop guard). F4b is wiring — verified by gates + phase-close human
QA.

---

## §12 — Fire instruction

After ratification: execute §11, gate-sweep (§4), CF-9 pause, push on approval → CI verify. F4 (the
profile-edits slice) closes with F4b; F5 (documents) is next.
