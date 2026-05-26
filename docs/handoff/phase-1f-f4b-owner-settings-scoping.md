# Phase 1f — F4b owner-settings scoping note (brief, read-only)

**Source:** `apps/web` (`OwnerSettings.tsx`, `useOwnerProfileMutations`) + the F4a section methods
(`auth.service.ts`), read directly (CF-23). **HEAD `b320f4c`** (F4a shipped). **Date:** 2026-05-26.

**Purpose.** Confirm the owner page's exact sub-form→method wiring before the F4b plan (F4's scoping
set the architecture; F4a built the 4 section methods + the read bridge). Brief. **No edits/commit/
plan-doc.** One wrinkle surfaced for ruling (CF-22).

---

## §1 — The 7 sub-forms → disposition (confirmed against source)

| Owner sub-form | current call | F4b → | fields sent | status |
|---|---|---|---|---|
| **Responsable** (`:254`) | `updateProfile` | **`updateProfileContact`** | `contact_name, contact_phone, fonction:\|\|null` | ✅ clean (fonction null OK — nullable) |
| **Entreprise** (`:293`) | `updateBusinessProfile` | **`updateProfileBusiness`** | `business_name, tax_number, business_sector_id, number_of_screens, number_of_rooms, company_size?` | ⚠️ **wrinkle §2** (the owner-extras) |
| **Adresse** (`:320`) | `updateBusinessProfile` | **`updateProfileAddress`** | `street_address, city, postal_code, governorate_id:\|\|null, zone:\|\|null` | ✅ with the per-field fix (governorate_id `\|\|null`→`\|\|undefined`; zone null OK) |
| **Notifications** (`:337`) | `updateProfile` | **`updateProfileNotifications`** | `notify_*×3` | ✅ clean |
| **Password** | `updatePasswordWithOld`/`updatePassword` | **DEFER → F6** | — | leave dead |
| **Logo** | `uploadLogo`/`updateProfile({logo_url})` | **DEFER → D9** | — | disable + "Bientôt disponible" (like F4a) |
| **Documents** (cin/rne) | `uploadDocument`/`removeDocument` | **DEFER → F5** | — | leave dead |
| **Bank** (`handleSaveBankDetails`) | `updateBusinessProfile` (bank_*) | **DEFER → money-slice** | — | leave dead |
| **Deactivate** | `deactivateAccount` | **DEFER → later** | — | leave dead |

The 4 field sub-forms map **1:1** to the F4a section methods. The owner hook
(`useOwnerProfileMutations`) gains 4 section mutations (calling the shared, F4a-tested
`authService.updateProfile{Contact,Business,Address,Notifications}`); the generic
`updateProfile`/`updateBusinessProfile` STAY for the deferred logo/doc/bank writes (like F4a's
advertiser hook).

### Per-field null handling (same F4a fix)
- **governorate_id** (adresse) sent `||null` → **change to `||undefined`** (uuid optional, null→400;
  JSON drops undefined → omitted-unchanged). zone `||null` stays (nullable). fonction `||null` stays.
- **business_sector_id** (entreprise) is sent **direct** (validated non-empty `:278`) — no null case.
- The owner-extras `number_of_screens/rooms` are sent as `number|null` → **backend strips** them
  (not in `/business` schema; stripped regardless of value — no 400). Same for fleet `company_size`.

---

## §2 — THE WRINKLE (owner-only) — entreprise owner-extras don't round-trip + the validation requires them

The entreprise sub-form mixes **persisted** fields (`business_name`/`tax_number`/`business_sector_id`
→ `/business` PATCH) with **owner-extras** (`number_of_screens`/`number_of_rooms`/`company_size`)
that **have no backend column** (Phase-1c added only the section columns; the owner slice was to add
these). Consequences post-F4b:
- **Load:** the `/api/me` bridge doesn't return the extras (no columns) → `getBusinessProfile` maps
  them `undefined` → the entreprise form **loads them empty** (`:207–215` read `p.number_of_screens`
  etc.).
- **Save:** the form **sends** them → the backend **strips** them (no columns) → **not persisted**.
- **Validation (`:282`, `:286`):** the form **REQUIRES** `number_of_screens` + `number_of_rooms`
  (+ fleet `company_size`) to save entreprise. So an owner editing `business_name` **must re-enter
  the screens/rooms each time** (they load empty, validation blocks the save) — and those re-entered
  values then vanish (stripped). The **persisted** fields (`business_name`/`tax`/`sector`) save fine.

This is a **functional reduction vs legacy** (Supabase had the columns; the new backend doesn't —
owner-extras persistence is genuinely deferred to the owner slice). Not a *new* breakage of the
section fields (those save), but the **validation gates the real save on unpersisted extras** —
awkward UX.

**Options (for ruling, CF-22):**
- **(a) Relax the entreprise validation** in F4b — drop the screens/rooms (+fleet company_size)
  required-checks so saving the persisted fields isn't blocked by the unpersisted extras. The extras
  inputs stay (collected, stripped) or get a "bientôt persisté" note. *Lean — lets the section save
  work; truthful (don't require what we can't persist).*
- **(b) Leave the validation** — the owner re-enters screens/rooms each entreprise edit (functional,
  the real fields save, but awkward). Minimal.
- **(c) Add owner-extras columns + persist** — owner-slice work, out of F4b scope.

*Lean: (a) relax* (the extras are owner-slice; F4b persists what has columns). Track owner-extras
persistence for the owner slice either way.

---

## §3 — Deferred sub-forms: leave-as-is (confirmed)

password / documents / bank / deactivate stay **dead-Supabase** (pre-F4 status quo — not newly
broken; F4b doesn't touch them; F6/F5/money/later repoint them). **Logo** is the one exception —
disabled + "Bientôt disponible" (consistent with F4a's advertiser logo, D-F4-4). (Minor UX
inconsistency: logo disabled while bank/doc still error on click — a known later-pass cleanup, not
F4b's; the rulings scope only logo to disable.)

---

## §4 — Test bar + sub-factoring

- **Test bar — NO new node tests (reuse).** The load-bearing logic (the 4 section methods + the
  `/api/me` mapping) is **already F4a-tested**; F4b is pure **wiring** (owner handlers → owner
  mutations → the tested methods) + the governorate_id `||undefined` fix (handler-layer, covered by
  the F4a JSON-drop guard). A new owner-hook test would need RTL (deferred). **Lean: no new tests**;
  F4b is verified by gates (typecheck/lint/build) + the reused F4a method tests + phase-close human
  QA on the owner page. (If a ruling wants a token owner-hook test, it pulls in RTL — flag.)
- **Sub-factoring — ONE commit.** F4b = `OwnerSettings` (4 handlers route to the new owner section
  mutations; governorate_id `||undefined`; logo disable+note; the §2 validation per ruling) +
  `useOwnerProfileMutations` (4 section mutations). Localized despite the big page. One commit.

---

## §5 — For ruling (CF-22)

- **The §2 wrinkle (the one real decision):** owner entreprise owner-extras don't round-trip + the
  validation requires them → **(a) relax the validation** (lean) / (b) leave-awkward / (c) owner
  columns (out of scope).
- **Test bar:** no new node tests (reuse F4a's), human-QA the owner wiring at phase close — confirm
  (or request a token RTL-needing owner-hook test).
- Otherwise the wiring is clean (4 sub-forms 1:1 to the F4a methods; governorate_id `||undefined`
  fix; logo disable; rest defer).

---

## Status

**Brief read-only scoping — HELD.** The owner wiring is confirmed clean (4 sub-forms → the F4a
section methods 1:1; rest defer) except the **§2 entreprise owner-extras wrinkle** (no backend
column → no round-trip + the validation requires them). One ruling needed (§2); then F4b → plan.
