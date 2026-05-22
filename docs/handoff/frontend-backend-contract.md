# Frontend→backend contract — Phase 1 endpoint reference (CF-24)

**Source:** `apps/web` React frontend (read directly, CF-23 — source authoritative).
**Date generated:** 2026-05-22 (Phase 1c, after Commit 1.1 onboarding schema).
**Purpose:** The contract-side authority for every backend endpoint, built and future.
The DB-side analog is `docs/handoff/supabase-schema-inventory.md`; this is its mirror for
the request/response wire layer the frontend actually sends and expects.

This document records what `apps/web` submits **today** — currently to the dead Supabase
backend (`supabase.auth.*`, `supabase.from('…').insert/update`, `supabase.rpc`,
`supabase.storage`). Phase 1e+ repoints these flows at `apps/api`. The contract is captured
now, front-loaded, so each backend endpoint can be checked against the frontend's real shape
before the repoint, not during it.

> **Scope note.** This is READ-ONLY inventory. It documents and classifies divergences; it
> does not resolve them. The architect rules per-case (CF-24). It does not propose frontend
> or backend edits — those land in their owning phase commits.

---

## §1 — Purpose & how to use (CF-24)

**CF-24 — the frontend contract is authoritative for endpoint shape; the backend conforms,
except where the backend is deliberately correct on security/integrity grounds.**

When designing or auditing a backend endpoint:

1. Find the frontend form here. Its **fields**, **wire shape**, **validation**, and
   **expected response** are the contract the endpoint must satisfy (after the Phase-1e wire
   repoint maps Supabase calls → `apps/api` REST).
2. Where backend and frontend disagree, the divergence is classified:
   - **Class (a) — backend conforms to frontend** (the default). Camel/snake naming, missing
     columns, extra fields the frontend collects: the backend (or the wire-adapter layer)
     changes in a future commit to match what the frontend sends/expects.
   - **Class (b) — frontend changes on security/integrity grounds** (the exception). The
     backend is correct; the frontend changes in Phase 1e. Reserved for anti-enumeration,
     privilege fields, password-strength floors, and other integrity rules where matching the
     legacy frontend would reintroduce a defect.
3. A third outcome, **load-bearing**, marks tensions that are neither a simple (a) nor (b) —
   they need an architecture decision (chiefly: the signup-vs-onboarding flow split).

This document is descriptive. The verdicts (§4) were the executor's classification proposals;
the architect **ratified them in §7** (2026-05-22).

---

## §2 — Form inventory (discovered, complete)

Discovered by searching `apps/web/src` for `supabase.auth.*`, `.from('…').insert/update/upsert/
delete`, `supabase.rpc`, `supabase.storage`, `onSubmit`/`handleSubmit`, `useForm`, and zod usage.
The expected set from the brief was largely right; the material **corrections** are: signup is a
single **combined multi-step wizard** (not minimal), there is **no end-user onboarding form**
(the concept is admin-flipped only), there is **no contact/support data form**, and password
reset/update **do** exist.

| # | Form / flow | Backend status | Files (apps/web) | §3 |
|---|---|---|---|---|
| 1 | Sign-up (combined 5-step wizard, 4 profile types) | **shipped** (`POST /api/signup`) | `features/auth/components/SignUpForm.tsx`, `pages/SignUp.tsx`, `services/auth.service.ts`, `types/auth.ts` | §3.1 |
| 2 | Sign-in / login | future (Phase 1d) | `features/auth/components/LoginForm.tsx`, `pages/Login.tsx`, `stores/auth.store.ts`, `services/auth.service.ts` | §3.2 |
| 3 | Admin login (overlay on sign-in + admin_profiles check) | future | `features/admin/pages/AdminLogin.tsx`, `services/admin.service.ts`, `stores/admin.store.ts` | §3.3 |
| 4 | Onboarding / business-profile completion | **schema shipped** (Commit 1.1); **no frontend form** | — (collected inside #1; `onboarding_completed` flipped only by admin) | §3.4 |
| 5 | Password reset (request link) | future | `features/auth/components/ResetPasswordForm.tsx`, `pages/ResetPassword.tsx`, `services/auth.service.ts` | §3.5 |
| 6 | Password update (post-reset / from settings) | future | `features/auth/components/UpdatePasswordForm.tsx`, `pages/UpdatePassword.tsx`, `services/auth.service.ts` | §3.6 |
| 7 | Email verification receiving page | future (Phase 1e) | **none for signup** — only `/update-password` (reset). No `/auth/verify-email` route exists. | §3.7 |
| 8 | Campaign create / edit (6-step wizard + cart) | later slice | `features/campaigns/services/campaign.service.ts`, `hooks/useCampaignMutations.ts`, `useConfirmCartLaunch.ts`, `pages/NewCampaign.tsx` | §3.8 |
| 9 | Video upload (advertiser) | later slice | `features/campaigns/services/video-upload.service.ts` | §3.8 |
| 10 | Campaign↔event link | later slice | `features/campaigns/hooks/useCampaignMutations.ts` (rpc `link_campaign_to_event`) | §3.8 |
| 11 | Advertiser profile edit | later slice | `features/advertiser/hooks/useProfileMutations.ts`, `pages/UserProfile.tsx` | §3.9 |
| 12 | Owner settings (7 sub-forms) | later slice | `features/auth/hooks/useOwnerProfileMutations.ts`, `features/screenhost/pages/OwnerSettings.tsx` | §3.9 |
| 13 | Client management (advertiser) | later slice | `features/advertiser/hooks/useClientMutations.ts` | §3.9 |
| 14 | Wallet recharge (advertiser) | later slice (money-adjacent) | `features/wallet/hooks/useCreateRecharge.ts` | §3.10 |
| 15 | Bank details (owner payout) | later slice (money-adjacent) | `features/wallet/hooks/useSaveBankDetails.ts` | §3.10 |
| 16 | Screen create / edit / delete | later slice | `features/screens/services/screens.service.ts`, `hooks/useOwnerScreensMutations.ts` | §3.11 |
| 17 | Screen unavailability period | later slice | `features/screens/services/screens.service.ts` | §3.11 |
| 18 | Screen configuration (auto-accept) | later slice | `features/screens/hooks/useOwnerScreensMutations.ts` | §3.11 |
| 19 | Campaign owner approvals (screen-level) | later slice | `features/campaigns/services/campaign-owner-approval.service.ts` | §3.11 |
| 20 | Predefined zones CRUD + image (admin) | later slice | `features/screens/services/predefined-zones.service.ts` | §3.12 |
| 21 | Special events CRUD + image + link (admin) | later slice | `features/admin/services/admin-events.service.ts`, `pages/EventManagement.tsx` | §3.12 |
| 22 | Video validation (admin) | later slice | `features/admin/services/admin-video.service.ts` | §3.12 |
| 23 | Recharge approval / reject / manual (admin) | later slice (money-adjacent) | `features/admin/hooks/useRecharges.ts` | §3.12 |
| 24 | User approval / deactivation cascade (admin) | later slice | `features/admin/services/admin-user.service.ts`, `hooks/useUsers.ts` | §3.12 |
| 25 | Global configuration (admin, v3 pricing) | later slice (money-adjacent) | `services/global-configuration.service.ts` | §3.12 |
| 26 | Screen affluence data (admin) | later slice | `features/admin/services/admin-screens.service.ts` | §3.12 |
| 27 | Notification read-state | transient | `features/*/hooks/use*Notifications.ts` (`user_notification_reads.upsert`) | §3.12 |

**Negative findings (confirmed absent):** no contact/support data-submitting form; no
end-user onboarding form (#4); no signup email-verify receiving page (#7). Bank-details (#15)
writes `business_profiles.bank_*` columns that are live-DB-only (schema-inventory §4.5).

---

## §3 — Per-form detail

Auth/onboarding (#1–7) are documented in full (7 items each), since their backends are shipped
or imminent. Later-slice forms (#8–27) are inventoried at field/wire/validation depth — full
7-item treatment lands when each slice's backend is designed.

### §3.1 — Sign-up  *(backend shipped: `POST /api/signup`)*

**1. Files.** `features/auth/components/SignUpForm.tsx` (~1940 lines, the wizard),
`services/auth.service.ts` `signUp()` (the wire layer, lines 281–691), `types/auth.ts`
(`SignUpData`, lines 81–109).

**2. Fields collected** (`SignUpData`, `types/auth.ts:81`). Property names are **snake_case**:
`email`, `password`, `business_name`, `tax_number?`, `business_sector_id`, `business_type`,
`profile_type`, `contact_name`, `contact_phone`, `fonction?`, `street_address`, `city`,
`postal_code`, `governorate_id`, `zone?`, `cin?`, `formule?`, `agent_toodooh?`,
`number_of_screens?`, `number_of_rooms?`, `company_size?`, `registration_doc?` (File),
`company_logo?` (File), `bank_doc?` (File), `terms_accepted`, `fleet_establishments?` (array).
`contact_name` is composed from `firstName + lastName` (`SignUpForm.tsx:279`).
`confirmPassword` and `rememberMe` are local-only (not submitted).

Service-enforced **required** set (`auth.service.ts:311–321`): `profile_type`, `business_type`,
`business_name`, `contact_name`, `contact_phone`, `street_address`, `city`, `postal_code`,
`governorate_id`, `terms_accepted`, `agent_toodooh`. (`tax_number` is **not** required —
temp-generated; see validation.)

**3. Wire shape.** Two calls:
- Auth: `supabase.auth.signUp({ email, password, options: { emailRedirectTo: getAppUrl('/login') } })`
  (`auth.service.ts:421`). Only email+password to auth.
- Profile: `supabase.from('business_profiles').insert(signupData)` (`:495`) where `signupData`
  carries all profile fields incl. `profile_type`, `business_type`, `verification_status:
  'pending'`, `onboarding_completed: false`, `is_admin: false` (`:461–488`). Fallback RPC
  `create_business_profile` on insert failure (`:612`). Documents/logo uploaded after, to the
  `registres` bucket as `cin_<uid>` / `rne_<uid>` / `logo_<uid>` (`:508`, `:573`). fleet_owner
  establishments → `supabase.from('locations').insert(...)` (`:196`).

**4. Expected response.** Reads `authData.user` (auto-login, email confirmation disabled in
legacy). On success the form navigates to `/login`. No verification step consumed.

**5. Client-side validation** (`SignUpForm.tsx:265–269`, verbatim):
```ts
const validatePassword = (pw) => pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw);
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidTunisiaPhone = (v) => /^\+216\d{8}$/.test(normalizePhone(v)); // +216 + 8 digits
```
- Password: **min 8** + 1 upper + 1 lower + 1 digit.
- Phone: Tunisia-only `+216` + 8 digits.
- `tax_number`: **no format rule** (free-form). Empty / individual-owner / fleet-owner-conflict
  → a temp value `TEMP-<8 uid chars>-<timestamp>` is generated (`auth.service.ts:456`).
- `postal_code`: `pattern="\d{4}"` on the input (4 digits).

**6. Flow structure — COMBINED.** Single 5-step wizard (profile-type → responsable →
entreprise → adresse/établissements → documents/bank) collecting the **entire business
profile + documents** before one `signUp()` call. There is **no separate onboarding step**;
`onboarding_completed` is written `false` at signup and is flipped to `true` **only by admin**
(`useUsers.ts:96`, `admin-user.service.ts:162`) — never by an end-user onboarding flow. See §5.1.

**7. Error handling — REVEALS existence (enumeration).** `validateUniqueCredentials`
(`SignUpForm.tsx:283`) calls RPC `check_signup_conflicts_secure` on blur and shows *"Cette
adresse email existe déjà"* (`:320`); `signUp()` re-checks and throws *"Cette adresse email est
déjà associée à un compte existant"* (`auth.service.ts:392`); the `identities.length === 0`
check (`:438`) and `mapAuthError('User already registered')` (`:27`) also disclose. Duplicate
`tax_number` → explicit *"matricule fiscal est déjà enregistré"* (`:413`). Server SQL errors
are mapped to friendly French (`mapAuthError`, `:20–176`), not shown raw.

### §3.2 — Sign-in / login  *(backend future: Phase 1d)*

**1.** `features/auth/components/LoginForm.tsx`, `stores/auth.store.ts`, `auth.service.ts:269`.
**2.** Fields: `email`, `password` (both required); `rememberMe` (local-only, not sent).
**3.** `supabase.auth.signInWithPassword({ email, password })` (`auth.service.ts:270`). After
success the store calls `fetchProfileType(user.id)` → `supabase.from('business_profiles')
.select('profile_type, business_name, verification_status, contact_name, onboarding_completed,
is_active')` (`auth.store.ts:138`).
**4.** Reads `profileType` from the store, then redirects: owners → `/owner-dashboard`, else
`/dashboard` (`LoginForm.tsx:26–32`). So the post-login response must surface **role/profile_type**
+ **onboarding_completed** + **status** for routing.
**5.** Email `type="email"` only; no client password rule.
**6.** Single step. Assumed sequence: login → role-based dashboard.
**7.** `mapAuthError`: *"Email ou mot de passe incorrect"* for invalid credentials (generic —
does **not** enumerate), throttle message for *"Too many requests"*.

### §3.3 — Admin login  *(backend future)*

**1.** `features/admin/pages/AdminLogin.tsx`, `admin.service.ts:32`.
**2.** `email`, `password`.
**3.** `supabase.auth.signInWithPassword({ email, password })` then
`supabase.from('admin_profiles').select('*').eq('user_id', …).eq('is_active', true).single()`,
then `update({ last_login })`. **Phase-1 note:** the dual-identity `admin_profiles` table is
collapsed into `users.role` (schema-inventory §9) — admin login becomes a normal login + a
`role IN ('admin','superadmin')` middleware check, not a second table lookup.
**4.** Reads `AdminProfile`, redirects `/admin-dashboard`.
**5.** `type="email"` only. **7.** Non-admin → *"Accès refusé"* (reveals the account exists but
isn't admin — minor; resolved by the role-claim model).

### §3.4 — Onboarding / business-profile completion  *(schema shipped Commit 1.1; NO frontend form)*

There is **no onboarding form in `apps/web`.** The fields our onboarding schema models
(`businessSectorId`, `businessType`, `streetAddress`, `city`, `postalCode`, `governorateId`,
`registrationDocUrl`, `cinDocUrl`) are all collected **inside signup** (§3.1). `onboarding_completed`
is set `false` at signup and set `true` only by admin user-management. The Model-1 separate
onboarding step (Phase 1c backend) has **no frontend counterpart today** — see §5.1. Closest
edit surfaces are the post-signup profile editors (§3.9), which `update` the same columns.

### §3.5 — Password reset (request)  *(backend future)*

**1.** `ResetPasswordForm.tsx`, `auth.service.ts:698`. **2.** `email`. **3.**
`supabase.auth.resetPasswordForEmail(email, { redirectTo: getAppUrl('/update-password') })`.
**4.** Toast + navigate `/login`. **5.** `type="email"` only. **7.** Generic *"Impossible
d'envoyer l'email"* on failure — does **not** confirm whether the email exists (good).

### §3.6 — Password update  *(backend future)*

**1.** `UpdatePasswordForm.tsx`, `auth.service.ts:705` (`updatePassword`) + `:760`
(`updatePasswordWithOld`). **2.** `password`, `confirmPassword` (reset path); `currentPassword`,
`newPassword` (settings path). **3.** `supabase.auth.updateUser({ password })`; the settings
path first re-auths via `signInWithPassword({ email, currentPassword })`. **5.** Form rule
(`UpdatePasswordForm.tsx:16`): **min 8** + upper + lower + digit + match. **Service rule
(`auth.service.ts:707`): `password.length < 6`** — weaker than the form. **7.** Maps
*reauthentication required* / *same as old* errors.

### §3.7 — Email verification receiving page  *(backend future: Phase 1e)*

**No signup email-verify page exists.** Legacy disabled email confirmation, so signup
auto-logs-in. The only token-receiving page is `/update-password` (reset). Our backend issues a
verify link at `…/auth/verify-email?token=…` (signup test asserts this) — **the frontend has no
matching route.** Phase 1e must add it. See §6.

### §3.8 — Campaigns & video  *(later slice)*

- **Campaign draft/create/edit** — `campaign.service.ts`. `supabase.from('campaigns')
  .insert/update({ name, category, client_id, start_date, end_date, budget, views, status:
  'draft', video_id, user_id, location_lat/lng/radius, event_id })`; junctions
  `campaign_locations`, `campaign_screens`, `campaign_categories` inserted alongside; activation
  upserts `campaign_owner_approvals` + `campaign_hourly_location_plan`. Validation: required
  name/category/dates/budget, `end_date >= start_date`, budget/views ≥ 0, video required to
  launch, balance check via `balanceService`.
- **Video upload** — `video-upload.service.ts`. `supabase.storage.from('media').upload(...)`
  then `supabase.from('videos').insert({ url, filename, file_size, uploaded_by,
  validation_status: 'pending', duration_seconds })`. Validation: type ∈ mp4/mpeg/quicktime/avi/
  webm, **max 100 MB**, duration via `HTMLVideoElement`.
- **Campaign↔event link** — `supabase.rpc('link_campaign_to_event', { p_campaign_id, p_event_id })`.

### §3.9 — Profile / settings  *(later slice)*

- **Advertiser profile** (`useProfileMutations.ts`) — `authService.updateProfile(patch)` →
  `business_profiles.update`; logo/doc upload to `registres` (`logo_<uid>` / `rne_<uid>`).
- **Owner settings** (`useOwnerProfileMutations.ts`) — 7 sub-forms: responsable
  (`contact_name`/`contact_phone`/`fonction`), entreprise (`business_name`/`tax_number`/
  `business_sector_id`/`number_of_screens`/`number_of_rooms`/`company_size`), adresse
  (`street_address`/`city`/`postal_code`/`governorate_id`/`zone`), notifications (`notify_*`×3),
  password (`updatePasswordWithOld`), logo, documents (`cin`/`rne`). Password rule here adds a
  **special char** (per the discovery report) — stricter than signup.
- **Clients** (`useClientMutations.ts`) — `supabase.from('clients').insert/update/delete({ name,
  email, phone, company, user_id })`. Required: name, email.

### §3.10 — Money-adjacent: wallet & bank  *(later slice — CLAUDE.md rule 10)*

- **Recharge** (`useCreateRecharge.ts`) — `supabase.from('recharges').insert({ user_id, amount,
  payment_method, status: 'pending', description })`. Validation: amount > 0, method selected.
- **Bank details** (`useSaveBankDetails.ts`) — `business_profiles.update({ bank_account_holder,
  bank_rib, bank_iban, bank_doc_path, bank_doc_url, bank_details_updated_at })` + `registres`
  upload `bank_<uid>`. These `bank_*` columns are live-DB-only (schema-inventory §4.5).

### §3.11 — Screens / locations  *(later slice)*

- **Screen create/edit/delete** (`screens.service.ts`) — `supabase.from('screens').insert({
  owner_id, name, location, address, screen_type, resolution_*, screen_size_inches, orientation,
  status, coordinates })`; throws if `location_id` absent post-insert.
- **Unavailability** — `screen_unavailability_periods.insert({ screen_id, start/end_date,
  start/end_time, reason, created_by })`; date/time ordering validated.
- **Screen config** — `screen_configurations` upsert (`auto_accept_campaigns` + device defaults).
- **Owner approvals** — `campaign_owner_approvals.upsert({ campaign_id, owner_id, status,
  approved_at|rejected_at|rejection_reason }, { onConflict: 'campaign_id,owner_id' })`.

### §3.12 — Admin & misc  *(later slice)*

`special_events` CRUD + `event-images` upload + `event_campaigns` link (`admin-events.service.ts`);
`videos.update` approve/reject (`admin-video.service.ts`); `recharges.update`/`insert` approve/
reject/manual (`useRecharges.ts`, money-adjacent); `business_profiles`/`screens`/`locations`/
`clients`/`recharges` updates+cascade-deletes on user approval/deactivation (`admin-user.service.ts`,
which also sets `onboarding_completed: true`); `global_configuration` update/upsert (v3 pricing,
validated per-key — `global-configuration.service.ts`, money-adjacent); `predefined_zones` CRUD +
`zone-images` upload (`predefined-zones.service.ts`); `screen_affluence_data` insert/delete
(`admin-screens.service.ts`); `user_notification_reads.upsert` (transient read-state).

---

## §4 — Reconciliation tables

### §4.1 — Sign-up (frontend §3.1 ↔ `POST /api/signup`, shipped)

Backend contract (verbatim, `apps/api/src/routes/signup.ts:15`, `validation/phone.ts`,
`validation/tax-number.ts`): snake_case `{ email, password(min 12), name(1–100),
business_name(1–200), contact_phone(E.164 `^\+[1-9]\d{1,14}$`), tax_number(`^[A-Za-z0-9/]{7,20}$`) }`;
role/status stripped (zod) + `input:false` (defaults advertiser/pending); dup-email → **201
generic** (anti-enumeration, no EMAIL_TAKEN); dup-tax → **409 TAX_NUMBER_TAKEN**; response
`{ userId, email, verificationRequired: true, message }`.

| # | Element | Frontend | Backend | Verdict | Class |
|---|---|---|---|---|---|
| 1 | Wire casing | snake_case | snake_case | **MATCH** | — |
| 2 | email format | `/^[^\s@]+@…$/` | `z.email` | **MATCH** | — |
| 3 | password length | **min 8** | **min 12** | **DIVERGE** | **(b)** frontend strengthens to 12 (never weaken backend) |
| 4 | password complexity | upper+lower+digit | none | **DIVERGE** | surface — is the complexity rule a real product floor the backend should adopt? |
| 5 | display `name` | `contact_name` (first+last) | `name` (required) | **DIVERGE** | **(a)** wire-adapter maps `contact_name`→`name` |
| 6 | phone format | `^\+216\d{8}$` (TN) | E.164 `^\+[1-9]\d{1,14}$` | **MATCH** (FE value passes BE; FE narrower) | — |
| 7 | tax_number format | free-form; `TEMP-…` fallback | `^[A-Za-z0-9/]{7,20}$` | **DIVERGE** | **(b)/load-bearing** — `TEMP-…` has `-` and >20 chars → fails BE; owners send empty |
| 8 | tax_number required | optional (owners) | required | **DIVERGE** | load-bearing — owner signup not modeled (see §5.2) |
| 9 | profile_type / role | sends `profile_type` (4 vals) | role stripped, hardcoded advertiser | **DIVERGE** | **(b)** for privilege + load-bearing — legitimate account-type choice not modeled |
| 10 | business_type at signup | sent | not accepted (onboarding col, Commit 3) | **DIVERGE** | load-bearing — FE sends at signup what BE expects at onboarding (§5.1) |
| 11 | email-exists handling | **reveals** | 201 generic | **DIVERGE** | **(b)** frontend stops disclosing |
| 12 | email verification | none (auto-login) | required + verify link | **DIVERGE** | **(b)/flow** — FE must add verify handling (§3.7) |
| 13 | terms_accepted | required + sent | no field/column | **DIVERGE** | **(a)** backend adds (compliance/legal) |
| 14 | agent_toodooh | required + sent | no field/column | **DIVERGE** | **(a)** backend adds or scopes |
| 15 | response shape | reads `authData.user` | `{ userId, email, verificationRequired, message }` | **DIVERGE** | **(a)** frontend adapts at repoint |
| 16 | owner/agency extras (screens, rooms, zone, fleet establishments, bank, logo, formule, company_size, fonction) | collected at signup | none | **DIVERGE** | **(a)/load-bearing** — owner signup not modeled (§5.2) |

**Signup tally: 3 MATCH · 13 DIVERGE** (of which (a)=5, (b)=4, (b)/load-bearing or load-bearing=4, surface=1; some rows carry two tags — counted once by their primary).

### §4.2 — Onboarding schema (frontend fields ↔ Commit 1.1 columns/tables, shipped)

| # | Element | Frontend (collected at signup §3.1) | Backend (Commit 1.1) | Verdict | Class |
|---|---|---|---|---|---|
| 1 | business sector | `business_sector_id` | `businessSectorId` uuid FK→`business_sectors` | **MATCH** | — |
| 2 | business type | `business_type` | `businessType` text | **MATCH** | — |
| 3 | street address | `street_address` | `streetAddress` text | **MATCH** | — |
| 4 | city | `city` | `city` text | **MATCH** | — |
| 5 | postal code | input `pattern="\d{4}"` | `postalCode` + CHECK `^\d{4}$` | **MATCH** (validation aligns) | — |
| 6 | governorate | `governorate_id` | `governorateId` uuid FK→`governorates` | **MATCH** | — |
| 7 | RNE doc | `registration_doc`→`registration_doc_url` | `registrationDocUrl` text | **MATCH** | — |
| 8 | CIN doc | `cin`/`cin_doc_url` | `cinDocUrl` text | **MATCH** | — |
| 9 | onboarding flag | `onboarding_completed` (false@signup) | `onboardingCompleted` bool default false | **MATCH** (semantic; flow differs §5.1) | — |
| 10 | governorates ref | `getGovernorates()`←`governorates` | `governorates` table + 24 seed | **MATCH** | — |
| 11 | predefined_zones ref | `predefined-zones.service` CRUD | `predefined_zones` table + 8 seed | **MATCH** | — |
| 12 | owner sectors | `getOwnerBusinessSectors()`←`owner_business_sectors` (2 sites) | folded into `business_sectors WHERE audience='owner'` (Q1 collapse) | **DIVERGE** | **(a)** frontend repoints to the `audience` filter (Phase 1e) |
| 13 | onboarding as a step | none (collected at signup) | separate step (Model 1) | **DIVERGE** | **load-bearing** (§5.1) |
| 14 | extra profile fields (company_size, number_of_screens/rooms, zone, agent_toodooh, fonction, formule, logo_url, bank_*, notify_*×3, terms_accepted) | collected | not modeled | **DIVERGE** | **(a)** backend adds in owner/profile slices, or scopes out |

**Onboarding-schema tally: 11 MATCH · 3 DIVERGE** ((a)=2, load-bearing=1).

**Combined reconciled total: 14 MATCH · 16 DIVERGE.**

---

## §5 — Load-bearing findings

### §5.1 — Signup is a single combined wizard; Model 1's onboarding step has no frontend (THE finding)

The backend locked **Model 1**: minimal signup (`email/password/name/business_name/contact_phone/
tax_number`) → a **separate** onboarding step fills the business profile + documents. The
frontend is the **opposite**: one 5-step wizard collects the *entire* profile + documents +
(for owners) establishments/bank, then a single `signUp()`. `onboarding_completed` is written
`false` at signup and flipped `true` **only by admin** (`useUsers.ts:96`,
`admin-user.service.ts:162`) — there is **no end-user onboarding flow** to repoint.

This is neither a clean (a) nor (b). The two coherent resolutions:

- **A — reshape frontend to Model 1 (Phase 1e):** split the wizard into a thin signup (the 6
  backend fields) + a post-verify onboarding page that calls `POST /api/onboarding` with the
  Commit-1.1 columns. Larger Phase-1e frontend effort; aligns with the shipped backend.
- **B — reconsider the split:** if the product wants one combined registration, the backend
  signup grows to accept the full profile (and `business_type`, account-type, terms,
  agent_toodooh), and Commit 3's onboarding endpoint becomes an *edit* surface rather than a
  required gate.

**Ruled: Option B — Model 1 abandoned (see §7.1).**

### §5.2 — Four profile types, owner-specific signup data — backend models only the advertiser path

The frontend signup supports **`advertiser | agency | individual_owner | fleet_owner`**
(`types/auth.ts:8`) with materially different required data: owners send
`number_of_screens`/`number_of_rooms`/`zone`/`formule`/bank details; fleet owners add an array
of establishments (→ `locations`); `tax_number` is optional for owners (temp-generated). The
shipped `POST /api/signup` models **only the advertiser** (test payload is advertiser; role
hardcoded). And **`agency`** is a 4th `profile_type` that neither the legacy DB CHECK
(`advertiser|individual_owner|fleet_owner`, schema-inventory §2.1) nor our `users.role` enum
(no `agency`) accepts — legacy special-cases it as advertiser + `business_type='agency'`
(`auth.service.ts:358`, `:670`). Ties into §5.1: any flow decision must cover all four types.

### §5.3 — `owner_business_sectors` collapse needs a frontend repoint (deliberate, ours)

Our ratified Q1 (Commit 1.1) dropped `owner_business_sectors` and folded owner sectors into
`business_sectors.audience='owner'`. The frontend reads `owner_business_sectors` at **2 sites**
(`auth.service.ts:868`, `performance.service.ts:450`). Both must repoint to the `audience` filter
in Phase 1e. Class (a), but flagged because *we* created it — it's a known consequence to track.

### §5.4 — Password floors are inconsistent across the frontend

Signup form **8** + complexity; password-update form **8** + complexity; but the `updatePassword`
service guard is **6** (`auth.service.ts:707`); owner-settings adds a special-char rule. Backend
is a uniform **12**. Phase 1e must converge the frontend to 12 everywhere (class (b)); the
complexity/special-char rules are a product-rule question (§4.1 row 4).

---

## §6 — Per-phase action items

| Phase | Item | Class / ref |
|---|---|---|
| **Architecture (now)** | Decide §5.1: reshape frontend to Model 1 **or** combine backend signup. Gates Phase-1e signup work. | load-bearing |
| **Architecture (now)** | Decide §5.2: how the 4 profile types (esp. `agency`) + owner-specific signup data map onto `users.role` + signup/onboarding. | load-bearing |
| **Phase 1c (Commit 3)** | Onboarding endpoint zod: `business_type` enum `local|national|agency|event_organizer`; consider `terms_accepted`/`agent_toodooh` columns (§4.1 rows 13–14). | (a) |
| **Phase 1d** | Sign-in endpoint: response must carry role/profile_type + status + onboarding_completed for FE routing (§3.2). Keep credentials error generic. | contract |
| **Phase 1e** | Frontend: enforce **12-char** password everywhere; drop the 6-char service guard (§5.4). | (b) |
| **Phase 1e** | Frontend signup: stop disclosing email existence; consume the 201-generic + verify flow; add the `/auth/verify-email` route (§3.1#7, §3.7, §4.1 rows 11–12). | (b) |
| **Phase 1e** | Frontend: stop sending role/privilege at signup; account-type selection routed per the §5.2 decision (§4.1 row 9). | (b) |
| **Phase 1e** | Frontend: repoint `owner_business_sectors` (2 sites) → `business_sectors?audience=owner` (§5.3). | (a) |
| **Phase 1e** | Wire-adapter: map `contact_name`→`name`; adopt the `{userId,email,verificationRequired,message}` response (§4.1 rows 5, 15). | (a) |
| **Phase 1f/1g** | Reconcile `tax_number` for owners (optional/temp) vs backend-required + format; revisit strict matricule (§4.1 rows 7–8; tax-number.ts defers to Phase 1c). | (b)/load-bearing |
| **Later slices** | Build endpoints for campaigns/video/screens/wallet/admin (§3.8–3.12) against these field/wire shapes; money-adjacent ones (#14,15,23,25) per CLAUDE.md rule 10. | (a) |

---

## §7 — Architect rulings (ratified 2026-05-22)

These rulings resolve §4–§6. The doc is authoritative per CF-24; this section records the
resolution so the audit carries its own decisions, not just open questions.

### §7.1 — Flow (§5.1): OPTION B — abandon Model 1

Combined registration is a sound frontend flow (CF-24 — not a defect), so the **backend
conforms** rather than the frontend being rebuilt. Model 1 (minimal-signup + separate
onboarding gate) was locked from DB-side docs *before this contract existed*; the audit proves
it wrong and it is reversed. The frontend has no Model-1 scaffolding to repoint — building one
would be speculative ground-up work plus splitting the 1940-line wizard.

- **Commit 3 reframed:** not a required onboarding *gate* but the **update-business-profile EDIT
  endpoint** the profile editors (§3.9) need — same Commit-1.1 columns, different role.
- **Signup grows** to accept the full profile (Phase-1e repoint + backend signup expansion).
- **`onboarding_completed` stays** (Commit 1.1 shipped it; matches the frontend's admin-flip
  semantics) — no longer gated by a separate user step.
- **Commit 1.1 does NOT change** — the 9 columns + reference tables are correct under A or B.
  No shipped work unwinds.

### §7.2 — Profile types (§5.2)

- **`agency` is NOT a role** → `role='advertiser'` + `business_type='agency'` (legacy pattern,
  `auth.service.ts:358`; the column already accepts `'agency'`). `users.role` stays 4 roles.
  Class (a), wire-adapter maps.
- **`advertiser` / `individual_owner` / `fleet_owner`** → direct `users.role` map (Phase-1b enum).
- **Owner-specific signup extras** (`number_of_screens`, `number_of_rooms`, `zone`, `formule`,
  bank, fleet establishments→`locations`) → **scoped out** of Phase 1c–1g; later owner/
  money-adjacent slice work. Slice-1 screenhost minimum = identity + profile + documents
  (Commit 1.1 covers it).
- **`tax_number` for owners (§4.1 rows 7–8) — REAL FIX, not deferral:** backend signup makes
  `tax_number` **NULLABLE + lenient-when-present** (same shape as the `postal_code` CHECK —
  constrain supplied values, allow NULL). This **reverses the Phase-1b "tax_number required"
  decision** — correctly, because owners have no matricule at signup. Lands in the signup-grows
  work.

### §7.3 — Class (b) security exceptions (frontend changes Phase 1e; backend correct)

1. **Enumeration** — FE stops disclosing email-exists (blur RPC + 3 sites), consumes the
   201-generic response. Backend holds.
2. **Password floor** — FE converges to **12** everywhere; drops the 6-char service guard.
3. **Privilege at signup** — `role`/`status` stay `input:false`. `profile_type` as an
   account-type *hint* is legitimate (class a mapping); as a *privilege* it's the defect — FE
   sends a non-privileged hint, BE validates + maps.
4. **Email verification** — FE adds the `/auth/verify-email` route + consumes the verify flow
   (also resolves the Phase-1e `callbackURL` carry-forward). Backend holds (verification required).

### §7.4 — Class (a) backend-conforms

- `contact_name`→`name` wire mapping (Phase-1e adapter).
- `{userId,email,verificationRequired,message}` response — FE adapts at repoint.
- `owner_business_sectors`→`business_sectors?audience=owner`, 2 sites (§5.3 — our Q1 consequence).
- **`terms_accepted`** → ADD column (legal/compliance, timestamped).
- **`agent_toodooh`** → ADD column (referral/attribution).
- **Password complexity** → backend ADDS upper+lower+digit to the 12-char rule (matches FE,
  slightly stronger); FE owner-settings drops its extra special-char rule to converge.

### §7.5 — CF-24 formalized

First major worked instance: the §7.1 reversal — the frontend contract overrode an architect
decision (Model 1) made from DB-side docs, catching a wrong call *before* it propagated into
Commits 3+ and a speculative Phase-1e build. The rule working exactly as intended. Formalized
at the Phase-1c audit refresh.

---

## Document status

**Current state: complete and RATIFIED (§7).** All `apps/web` data-submitting forms inventoried
(27 flows), auth/onboarding documented in full, signup + onboarding-schema reconciled (14 MATCH
/ 16 DIVERGE). The two architecture decisions this audit existed to surface are ruled: §5.1 flow
→ **Option B, Model 1 abandoned** (§7.1); §5.2 profile types → ruled in parts (§7.2). All (a)/(b)
divergences dispositioned (§7.3–§7.4). Authoritative per CF-24 for every endpoint going forward.
