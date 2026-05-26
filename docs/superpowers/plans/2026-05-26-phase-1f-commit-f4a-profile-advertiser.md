# Phase 1f — Commit F4a: profile edits — read-bridge + section methods + advertiser

**Status:** DRAFT (F4a.0) — held for architect review (not committed, not executed).
**Design authority:** `phase-1f-f4-profile-edits-scoping.md` (§7 rulings D-F4-1…6, all ratified).
**Region:** `apps/web` only (the read uses the existing `/api/me`; the 4 PATCHes exist — no backend).
**HEAD at draft:** `aa72b37` (K+F1+F2+F3 shipped).

The profile-edits repoint, advertiser half + the shared service layer. The **read bridge**
(`getBusinessProfile` → `/api/me` + map) and the **4 section methods** (→ the 4 PATCHes) are shared;
F4a wires the **advertiser** `UserProfile`; **F4b** wires the owner `OwnerSettings` next. Node-only
tests (the load-bearing logic is service-layer — D-F4-5). **One commit.**

---

## §0 — Pre-flight verification (CF-10)

- `git status` clean; HEAD `aa72b37`.
- Floor: **apps/web typecheck 44 · lint 1 · test 196 (27 files) · build 137.35 kB gzip**; apps/api 146
  (untouched by F4a). Re-run; record actuals.
- Node 20 PATH.

---

## §1 — Locked constraints (rulings)

- **D-F4-1** SAVE = **4 explicit section methods**, per-section 1:1 (the forms already save per-section);
  owner-extras stripped by the backend (truthful); the generic `updateProfile`/`updateBusinessProfile`
  STAY (dead) for the deferred logo/doc/bank writes.
- **D-F4-2** READ = `getBusinessProfile` → `GET /api/me` + **map → `BusinessProfile`** (no
  `GET /api/profile`; apps/web-only). The **notifications flatten** (`/api/me` nested
  `notifications.{}` → forms' flat `notify_*`) is the one structural transform — node-test it.
- **D-F4-3** F4 = the 4 field-sections (read + save). Docs→F5, password→F6, logo→D9, bank→money,
  deactivate→later. The rest stays pre-F4 dead-Supabase (not regressed).
- **D-F4-4** logo COSMETIC → **defer** (no column/endpoint/admin-dependency). F4a **disables the logo
  upload affordance** with a "Bientôt disponible" note (least-confusing — don't ship a dead button);
  the logo-storage build is a tracked later item.
- **D-F4-5** **node-only** (the section→PATCH routing + the `/api/me`→`BusinessProfile` mapping are
  service-layer). RTL deferred (resolve per-commit; maybe never in 1f).
- **D-F4-6** split: **F4a = read-bridge + 4 section methods + advertiser**; F4b = owner. F4a improves
  owner READS (the shared bridge) but leaves owner SAVES at the pre-F4 dead-Supabase status quo —
  **PLAN-WATCH: F4a must not break owner saves further** (read-improved, save-unchanged for owner;
  both repointed in F4b).

---

## §2 — Inventory (CF-23 from source) + files

### §2.A — Files (apps/web only)

| File | Action |
|---|---|
| `features/auth/types/auth.ts` | add `MeUser` (the `/api/me` user shape) |
| `features/auth/services/auth.service.ts` | add 4 section methods; rewrite `getBusinessProfile` → `/api/me` + map |
| `features/advertiser/hooks/useProfileMutations.ts` | add 4 section mutations (keep the generic `updateProfile`/`uploadLogo`/`uploadDocument` — dead, for logo/doc) |
| `features/advertiser/pages/UserProfile.tsx` | route the 4 save handlers → section mutations; uuid `\|\|null`→`\|\|undefined`; disable the logo upload affordance + note |
| `features/auth/services/auth.service.profile.test.ts` | **NEW** — node tests (section methods + the mapping) |

### §2.B — The null vs undefined detail (correctness, PLAN-WATCH)
`apiClient.patch` does `JSON.stringify(body)` → **`undefined` keys are dropped, `null` is sent.** The
PATCH schemas: `fonction`/`zone` are `nullable` (null OK → clears), but `business_sector_id`
(`/business`) + `governorate_id` (`/address`) are `z.uuid().optional()` — **null → 400**. The advertiser
handlers send `business_sector_id: form.x || null` / `governorate_id: form.x || null`. **Fix:** change
those two to `|| undefined` (dropped when empty → unchanged); `fonction` stays `|| null` (clearable).
No strip helper needed — JSON.stringify handles it. (Node-test: a null sector is omitted; fonction null
is sent.)

### §2.C — owner READ improves, owner SAVE unchanged (PLAN-WATCH, D-F4-6)
`getBusinessProfile` is shared (advertiser `useUserProfile` + owner `useBusinessProfile`). F4a's rewrite
→ owner forms LOAD from `/api/me` (better than the dead-Supabase nothing). Owner SAVE handlers still
call `authService.updateProfile`/`updateBusinessProfile` (Supabase, dead) — **unchanged from pre-F4**
(those methods stay; F4a does NOT touch them). So owner: read-improved, save-unchanged (not newly
broken). F4b repoints owner saves. **Verify at execution: the owner `OwnerSettings` typechecks +
its save handlers still reference the (still-present) generic methods.**

---

## §3 — Commit factoring

**One commit (F4a).** Read bridge + 4 section methods + advertiser wiring + node tests — coherent and
atomic (the advertiser forms need both the read and the saves to work end-to-end). Owner is the
separate F4b.

---

## §4 — Per-commit verification gates

- `pnpm typecheck` — green; floor **≤ 44** (the section methods + mapping are typed; likely flat 44).
- `pnpm lint` — green; **1** (database.types floor).
- `pnpm test` — green; **196 + N** (the profile test: 4 section methods + the mapping + the
  null/undefined case — ~8–10).
- `pnpm build` — green; **~137.35 kB** ± (the logo-disable note + section methods; ~flat). apps/api
  untouched (**146**).

---

## §5 — Standing operating procedure

Node-20 PATH. Conventional Commits, no `Co-Authored-By`. CF-7 gate-sweep. Husky lint-staged. Clean
`apiClient` mock objects (F1 carry-forward).

---

## §6 — Hard-halt conditions

- The owner `OwnerSettings` breaks (typecheck/behavior) from the shared `getBusinessProfile` rewrite —
  it must only read-improve, not break (§2.C). If a break surfaces → halt.
- A section PATCH 400s on a value the form legitimately sends (the null/undefined detail §2.B) → the
  node test must catch it before execution; if it surfaces, halt.
- Any gate regresses → revert, surface.

---

## §7 — Risk register

- **null→400 (§2.B):** the uuid optionals reject null; fixed by `||undefined` in the 2 handlers +
  asserted in the node test.
- **`/api/me` shape gap:** logo_url/bank_*/doc-urls absent → the advertiser logo preview + document
  state render empty (deferred D9/F5). The advertiser form reads `logo_url` (preview) + `registration_
  doc_url` (doc) — both undefined post-bridge → empty UI (acceptable; D9/F5 own them).
- **`business_type`/`profile_type`/`verification_status` casts:** `/api/me` returns them as
  `string|null`; the map casts to the `BusinessProfile` unions with fallbacks (`local`/`advertiser`;
  status→verification_status). Forms don't read `verification_status` off `profile` (grep-confirmed),
  so the cast is benign.
- **Logo affordance disable:** a small rendered change (button disabled + note) — a light visual
  glance at plan close; not full frontend-design.

---

## §8 — Cross-references

- Scoping: `phase-1f-f4-profile-edits-scoping.md`. Backend: `routes/profile.ts` (the 4 PATCHes),
  `routes/me.ts` (the read source). Keystone: `api-client.ts`, `auth-errors.ts`.
- **F4b carry-forward:** owner `OwnerSettings` (4 section saves → reuse the F4a section methods; bank →
  money-slice dead; password → F6; logo → D9; documents → F5) + its own node tests.
- **Tracked later items:** logo storage (column + endpoint, then re-enable the affordance); the
  inline-`#76E6AB` styling pass.

---

## §9 — Carry-forward methodology

- **CF-24** truthful-to-frontend: section saves map 1:1; owner-extras stripped by the backend; the read
  maps `/api/me`'s real shape, deferred fields absent (not faked).
- **CF-23** the no-`GET /api/profile` + the null/undefined PATCH detail read from source.
- **CF-22** D-F4-2/D-F4-5 were brief-reversals surfaced + ratified (read-bridge, node-only).
- **Test-infra note:** RTL still not stood up (the load-bearing logic is service-layer; node covers
  it). Resolve per-commit; F4b may also be node-only.

---

## §10 — Push policy + sequencing

F4a.0 plan → push (CF-6). F4a.1 code → CF-7 gate-sweep → CF-9 pause → push on approval → CI verify.
A **light visual glance** at the advertiser profile (the logo-disable note + the section saves render
unchanged) is reasonable but the gate is node tests + phase-close human QA (D-F4-5). No deps/backend.

---

## §11 — Exact changes (F4a.1)

### §11.1 — `features/auth/types/auth.ts` (add `MeUser`)

```ts
/** The `user` object returned by GET /api/me (Phase-1f; the profile read source — F4). */
export interface MeUser {
  id: string;
  email: string;
  email_verified: boolean;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  onboarding_completed: boolean;
  profile_type: string | null;
  contact_name: string | null;
  business_name: string | null;
  tax_number: string | null;
  contact_phone: string | null;
  fonction: string | null;
  business_sector_id: string | null;
  business_type: string | null;
  street_address: string | null;
  city: string | null;
  postal_code: string | null;
  governorate_id: string | null;
  zone: string | null;
  documents: { registration: boolean; cin: boolean };
  notifications: {
    news_updates: boolean | null;
    reminders_events: boolean | null;
    promotions_offers: boolean | null;
  };
}
```

### §11.2 — `auth.service.ts` — 4 section methods + `getBusinessProfile` rewrite

```ts
// Phase-1f F4 — section-scoped profile saves (the forms already save per-section). Each → its PATCH.
// apiClient JSON.stringify drops `undefined` keys (so empty uuid optionals are omitted, not null-400);
// `null` is sent (clears nullable fonction/zone). Owner-extras (number_of_screens/rooms/company_size)
// are accepted here and STRIPPED by the backend (truthful, like signup).
async updateProfileContact(patch: {
  contact_name?: string; contact_phone?: string; fonction?: string | null;
}): Promise<void> {
  try { await apiClient.patch('/profile/contact', patch); }
  catch (error) { throw new Error(apiErrorMessage(error)); }
},
async updateProfileBusiness(patch: {
  business_name?: string; tax_number?: string; business_sector_id?: string; business_type?: string;
  number_of_screens?: number | null; number_of_rooms?: number | null; company_size?: string | null;
}): Promise<void> {
  try { await apiClient.patch('/profile/business', patch); }
  catch (error) { throw new Error(apiErrorMessage(error)); }
},
async updateProfileAddress(patch: {
  street_address?: string; city?: string; postal_code?: string; governorate_id?: string; zone?: string | null;
}): Promise<void> {
  try { await apiClient.patch('/profile/address', patch); }
  catch (error) { throw new Error(apiErrorMessage(error)); }
},
async updateProfileNotifications(patch: {
  notify_news_updates?: boolean; notify_reminders_events?: boolean; notify_promotions_offers?: boolean;
}): Promise<void> {
  try { await apiClient.patch('/profile/notifications', patch); }
  catch (error) { throw new Error(apiErrorMessage(error)); }
},

// Phase-1f F4 — the profile READ now comes from /api/me (no GET /api/profile; the backend has no
// logo/bank columns, so a dedicated endpoint couldn't supply them either). Map the /api/me user →
// BusinessProfile: section fields direct, notifications FLATTENED, status→verification_status, the
// deferred fields (logo_url/bank_*/doc-urls) absent (undefined). Returns null on logged-out (401).
async getBusinessProfile(): Promise<BusinessProfile | null> {
  let user: MeUser;
  try {
    ({ user } = await apiClient.get<{ user: MeUser }>('/me', { skipAuthRedirect: true }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw new Error(apiErrorMessage(error));
  }
  return {
    id: user.id,
    user_id: user.id,
    business_name: user.business_name ?? '',
    tax_number: user.tax_number ?? '',
    business_sector_id: user.business_sector_id ?? '',
    business_type: (user.business_type as BusinessProfile['business_type']) ?? 'local',
    profile_type: (user.profile_type as BusinessProfile['profile_type']) ?? 'advertiser',
    contact_name: user.contact_name ?? '',
    contact_phone: user.contact_phone ?? '',
    fonction: user.fonction ?? undefined,
    street_address: user.street_address ?? '',
    city: user.city ?? '',
    postal_code: user.postal_code ?? '',
    governorate_id: user.governorate_id ?? '',
    zone: user.zone ?? undefined,
    notify_news_updates: user.notifications.news_updates ?? false,
    notify_reminders_events: user.notifications.reminders_events ?? false,
    notify_promotions_offers: user.notifications.promotions_offers ?? false,
    verification_status: user.status === 'approved' ? 'verified' : user.status,
    terms_accepted: true,
    onboarding_completed: user.onboarding_completed,
    created_at: '',
    updated_at: '',
    is_admin: false,
  };
},
```

`MeUser` + (already imported) `ApiError`/`apiClient`/`apiErrorMessage` — add `MeUser` to the
`types/auth` import. The OLD `getBusinessProfile` (Supabase) is replaced; `updateProfile`/
`updateBusinessProfile` (Supabase) **stay** (deferred logo/doc/bank + owner saves until F4b).

### §11.3 — `useProfileMutations.ts` (advertiser) — add 4 section mutations
Add `updateContact`/`updateBusiness`/`updateAddress`/`updateNotifications` mutations (each →
`authService.updateProfile<Section>`, `onSuccess: invalidateProfile`). **Keep** `updateProfile`
(generic — logo-remove/doc-remove, dead), `uploadLogo` (D9 dead), `uploadDocument` (F5 dead). Return
all.

### §11.4 — `UserProfile.tsx`
- `handleSaveResponsable` → `updateContact.mutateAsync({ contact_name, contact_phone, fonction: responsableForm.fonction || null })`.
- `handleSaveEntreprise` → `updateBusiness.mutateAsync({ business_name, tax_number, business_sector_id: entrepriseForm.business_sector_id || undefined, company_size: entrepriseForm.company_size || undefined })`.
- `handleSaveAdresse` → `updateAddress.mutateAsync({ street_address, city, postal_code, governorate_id: adresseForm.governorate_id || undefined })`.
- `handleSaveNotifications` → `updateNotifications.mutateAsync({ notify_news_updates, notify_reminders_events, notify_promotions_offers })`.
- **uuid `||null` → `||undefined`** for `business_sector_id` + `governorate_id` (§2.B).
- **Logo (D9):** disable the logo upload `<button>`/`<input>` (`disabled` + `cursor-not-allowed`) and
  add a small `Bientôt disponible` note; leave the preview area (empty from the bridge). The
  `handleLogoUpload`/`handleLogoRemove` + `uploadLogo` stay but are no longer reachable.
- Document control: leave as-is (F5; dead — pre-F4 status quo).
- Update the `useProfileMutations` destructure to pull the 4 section mutations.

### §11.5 — `auth.service.profile.test.ts` (NEW, node-level)
`vi.mock('@/lib/supabase', () => ({ supabase: {} }))` + clean `apiClient` mock (post/get/patch/...).
- Each section method → asserts `apiClient.patch('/profile/<section>', patch)` with the body.
- `updateProfileBusiness({ business_sector_id: undefined, business_name: 'X' })` → the patch passed
  has no `business_sector_id` key surviving JSON (assert via the mock's received arg — note: the mock
  receives the JS object pre-stringify, so assert the handler-level `||undefined`; to test the
  drop, assert `JSON.stringify` omits it, OR assert the method forwards the patch verbatim and rely on
  apiClient's stringify — **test the handler's `||undefined` mapping at the method-call level**).
- `getBusinessProfile`: mock `apiClient.get('/me')` → a `MeUser`; assert the mapping (notifications
  flattened to `notify_*`; `status:'approved'`→`verification_status:'verified'`; section fields;
  deferred fields undefined). 401 → null. non-401 → throws French.

---

## §12 — Fire instruction

After ratification: execute §11, gate-sweep (§4), CF-9 pause, push on approval → CI verify. Then F4b
(owner `OwnerSettings`) is drafted.
