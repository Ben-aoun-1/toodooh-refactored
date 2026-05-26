# Phase 1f — F4 profile-edits scoping read (read-only)

**Source:** `apps/web` (`UserProfile.tsx`, `useProfileMutations`, `useUserProfile`,
`OwnerSettings.tsx`, `useOwnerProfileMutations`) + `apps/api` (`routes/profile.ts` the 4 PATCHes,
`routes/me.ts`), read directly (CF-23). **HEAD `aa72b37`** (K+F1+F2+F3 shipped), tree clean.
**Date:** 2026-05-26.

**Purpose.** Read-only reconnaissance of the profile-edits repoint → F4's shape (the
updateProfile→4-PATCH split, the read-bridge, the F4/F5/F6/D9 boundary, the D9 logo resolution, the
jsdom+RTL question, sub-factoring). **No edits, no commit, no plan-doc** this turn. Proposals to
ratify, not execute (CF-22).

---

## §1 — Current surface: the forms ALREADY save per-section (clean)

Two hooks, both per-section:
- **Advertiser** (`useProfileMutations`, `UserProfile.tsx`): one `updateProfile` mutation
  (`authService.updateProfile(patch)`); the 4 section handlers each call it with a **clean section
  patch**:
  - `handleSaveResponsable` → `{contact_name, contact_phone, fonction}`
  - `handleSaveEntreprise` → `{business_name, tax_number, business_sector_id, company_size}`
  - `handleSaveAdresse` → `{street_address, city, postal_code, governorate_id}`
  - `handleSaveNotifications` → `{notify_news_updates, notify_reminders_events, notify_promotions_offers}`
- **Owner** (`useOwnerProfileMutations`, `OwnerSettings.tsx`): `updateProfile` (responsable, notifs) +
  `updateBusinessProfile` (entreprise, adresse, **bank**):
  - Responsable → `{contact_name, contact_phone, fonction}`; Notifications → `{notify_*×3}`
  - Entreprise → `{business_name, tax_number, business_sector_id, number_of_screens, number_of_rooms,
    company_size?}`
  - Adresse → `{street_address, city, postal_code, governorate_id, zone}`
  - Bank → `{bank_account_holder, bank_rib, bank_iban}` (+ bank doc)

**So the SAVE side is already section-shaped** — each handler sends one section's fields. (Both also
have logo / document / password / deactivate handlers — §3.)

The READ: `getBusinessProfile()` → `supabase.from('business_profiles').select('*')` (dead — Supabase
gone), consumed by `useUserProfile` / `useBusinessProfile`, typed `BusinessProfile`.

---

## §2 — The split design (the load-bearing decision)

### §2.A — SAVE: per-section 1:1 → the 4 PATCHes
The backend is section-scoped (`profile.ts`): `PATCH /api/profile/{business,contact,address,
notifications}`. The forms already send clean section patches → **1:1**. The sub-form → endpoint map:

| FE section save | fields sent | → endpoint | notes |
|---|---|---|---|
| Responsable | contact_name, contact_phone, fonction | **`/contact`** | exact |
| Entreprise | business_name, tax_number, business_sector_id (+owner: number_of_screens/rooms/company_size) | **`/business`** | owner-extras **stripped** by zod (like signup — truthful) |
| Adresse | street_address, city, postal_code, governorate_id (+owner: zone) | **`/address`** | exact |
| Notifications | notify_news_updates / reminders_events / promotions_offers | **`/notifications`** | exact |

**Proposed (per-section 1:1, the architect's lean):** add **4 section methods** to `authService`
(`updateProfileContact/Business/Address/Notifications(patch)`, each → `apiClient.patch('/profile/…')`);
the section handlers + the two hooks route to the matching one. The generic
`updateProfile`/`updateBusinessProfile` (Supabase) **stay** for the deferred non-section writes
(logo-remove, doc-remove, bank — dead until D9/F5/money). *Lean: 4 explicit section methods.*

### §2.B — READ: the `/api/me` bridge (load-bearing — D-F4-2)
**There is NO `GET /api/profile`** — only the 4 PATCHes + `GET /api/me`. So the profile read must use
`/api/me`. But `/api/me`'s shape ≠ `BusinessProfile`:
- `/api/me` provides all **section fields** ✓ — but **notifications are NESTED**
  (`notifications:{news_updates,…}`) while the forms read **flat** `profile.notify_news_updates`.
- `/api/me` does NOT provide: `logo_url` (D9), `bank_*` (money — and **the backend `users` table has
  no bank/logo columns at all**), `registration_doc_url`/`cin_doc_url` (me.ts returns
  `documents:{registration,cin}` **booleans**, F5), `is_active`, `verification_status`/`created_at`/
  `is_admin` (BusinessProfile-required).

The forms read these non-section fields (grep): `logo_url`×4, `bank_*`×9, `cin_doc_url`/
`registration_doc_url`×6, `notify_*`×18. The section fields + notifications come from `/api/me`; the
rest are **deferred features** (D9/F5/money) that simply render empty until their slice.

**Proposed:** rewrite `getBusinessProfile()` → `apiClient.get('/me')` + **map** the `user` →
`BusinessProfile` (flatten `notifications.*` → `notify_*`; `status` → `verification_status` per the
D5 mapping; absent deferred optionals → `undefined`; required-but-absent like `created_at`/`is_admin`
→ benign defaults). **apps/web-only** (no backend — and a dedicated `GET /api/profile` couldn't supply
logo/bank either, no columns). *Lean: map `/api/me` in `getBusinessProfile`.* Surface — this is the
one non-obvious bridge.

---

## §3 — The F4 / F5 / F6 / D9 / money boundary

| Sub-form / control | Owner | F4? | Goes to |
|---|---|---|---|
| Responsable / Entreprise / Adresse / Notifications | both | **YES** | the 4 PATCHes (§2.A) + the read bridge (§2.B) |
| Documents (rne/cin upload + remove) | both | no | **F5** (multipart `/api/profile/documents/:type`, post-signin flow-position) |
| Password (change) | owner | no | **F6** (the whole password domain) |
| Logo (upload + remove) | both | no | **D9** (§4) |
| Bank details (+ doc) | owner | no | **money slice** (no `bank_*` columns; CLAUDE.md rule 10) |
| Deactivate account | owner | no | **later** (no endpoint; sets `is_active`, no column) |

**F4 owns:** the 4 field-sections (read + save) in both `UserProfile` + `OwnerSettings`. Everything
else stays dead-Supabase (the pre-F4 status quo) until its slice — F4 doesn't regress them, just
doesn't repoint them.

---

## §4 — D9 logo resolution

**Read:** both forms `uploadLogo` → Supabase storage + `updateProfile({logo_url})` (dead). The
backend `users` table has **no `logo_url` column** and no logo endpoint (documents = rne/cin only).
**Critical-path check:** admin-approval (Phase 1g) is NOT built — nothing currently gates on a logo;
signup made logo optional ("add later", D9 at F2). So logo is **cosmetic**, not load-bearing.

**Proposed (D-F4-4): cosmetic → DEFER.** The logo upload is already dead (Supabase gone); F4 leaves
the control as-is (logo preview empty from the `/api/me` bridge; upload stays dead) and **tracks a
"logo storage" later item** (needs a `logo_url` column + a logo endpoint — a future apps/api slice).
*Minor UX gap:* a logo upload that errors is poor UX — a lighter touch is to **hide/disable the logo
control with a "bientôt disponible" note** (small UI work). *Lean: defer; decide hide-vs-leave at
plan-write.* (NOT a backend prerequisite — no admin-approval logo dependency found.)

---

## §5 — jsdom + RTL: do we stand it up here? (D-F4-5 — reconsidered)

The architect leaned "stand up RTL at F4 (render-logic-heavy)." But the read found **the load-bearing
logic is in the service layer, node-testable:**
- The section→PATCH **routing** (the 4 section methods: right path + body mapping) — node-testable
  (mock `apiClient`, like F1/F2).
- The read **bridge** (`/api/me` → `BusinessProfile` mapping: flatten notifications, map status,
  defaults) — node-testable (pure mapping).
- What's left for RTL = **form binding** (load values into state, edit, click-save fires the mutation)
  on the **huge** `UserProfile`/`OwnerSettings` pages — high setup (QueryClientProvider + Router +
  store + mocked client per render), **low marginal value** over the node routing/mapping tests.

**Proposed: node-only for F4** (test the 4 section methods + the read-mapping; clean `apiClient` mocks,
F1 carry-forward), **defer RTL** to phase-close human QA for the rendered forms. This **reopens "where
RTL stands up"**: if every load-bearing repoint keeps its logic in the service layer, RTL may not
earn its infra in 1f at all (human QA covers render correctness). *Lean: node-only; RTL deferred
again — but flagged as the architect's call (they leaned RTL-now).*

---

## §6 — Sub-factoring

F4 is large: the read bridge + 4 section methods (shared) + advertiser (`UserProfile` 4 handlers +
hook) + owner (`OwnerSettings` 4 handlers + hook) + tests. Two big pages.

- **Option one-commit:** read bridge + section methods + both forms' saves + node tests. Atomic, no
  intermediate; large diff (two pages).
- **Option split (recommended):** **F4a** = the read bridge + the 4 section methods + **advertiser**
  (`UserProfile` + `useProfileMutations`) + node tests; **F4b** = **owner** (`OwnerSettings` +
  `useOwnerProfileMutations`) saves. Each green: F4a improves owner *reads* (the shared bridge) but
  leaves owner *saves* on dead-Supabase = **the pre-F4 status quo, not a regression**; F4b repoints
  owner saves. Smaller, reviewable, each independently testable.

*Lean: split (F4a advertiser + shared, F4b owner)* — the two pages are independent (separate hooks),
and owner's larger surface (7 sub-forms, bank, extras) deserves its own commit. Surface; one-commit is
fine if preferred.

---

## §7 — Decisions for architect ruling (CF-22)

- **D-F4-1 — split design = 4 explicit section methods, per-section 1:1** (§2.A); owner-extras
  stripped by the backend (truthful); the generic `updateProfile`/`updateBusinessProfile` stay for
  deferred logo/bank/doc. *Lean: as stated.*
- **D-F4-2 (load-bearing) — the read bridge:** `getBusinessProfile` → `/api/me` + map → `BusinessProfile`
  (flatten notifications, map status, defaults); apps/web-only (no `GET /api/profile`; the backend has
  no logo/bank columns anyway). *Lean: map `/api/me`.*
- **D-F4-3 — boundary:** F4 = the 4 field-sections (read + save); F5 documents, F6 password, D9 logo,
  money-slice bank, later deactivate. *Lean: confirm.*
- **D-F4-4 — D9 logo: cosmetic → DEFER** (no column, no endpoint, no admin-approval dependency). Track
  a "logo storage" later item; decide hide-vs-leave-the-control at plan-write. *Lean: defer.*
- **D-F4-5 (reconsidered) — jsdom+RTL: node-only for F4** (the load-bearing routing/mapping is
  service-layer, node-testable; RTL on the huge pages is high-cost/low-value). RTL deferred to
  phase-close human QA; reopens whether RTL stands up in 1f at all. *Lean: node-only — but this
  reverses the architect's RTL-now lean, so flagged for ruling.*
- **D-F4-6 — sub-factoring: split F4a (advertiser + shared) / F4b (owner)** vs one commit. *Lean:
  split.*

---

## Document status

**Read-only scoping read — produced, HELD for review (not committed).** Establishes: the forms
already save per-section (§1); the SAVE split is a clean per-section 1:1 to the 4 PATCHes (§2.A); the
load-bearing **read bridge** (`/api/me` → `BusinessProfile`, no `GET /api/profile`) with its shape gap
(§2.B); the F4/F5/F6/D9/money boundary (§3); D9 logo cosmetic→defer (§4); the **reconsidered**
jsdom+RTL question — node-only because the load-bearing logic is service-layer (§5); and the
advertiser/owner sub-factoring (§6). Six decisions for ruling (§7). Nothing resolved unilaterally —
the F4 plan-doc is drafted only after §7 is ruled.
