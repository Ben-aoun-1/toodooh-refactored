# Phase 1g — Admin approval · discovery scoping read

**Type:** read-only discovery (no edits, no commits, no plan-doc) · **Date:** 2026-05-28 ·
**HEAD:** `7d54701` (landing staged, CI-green) · **Floor:** apps/web typecheck 36 / lint 1 /
test 217 / build 135.81; apps/api 146.

**Mandate.** Slice-1's last in-our-control feature build: pending-queue → approve/reject →
require-admin middleware → admin FE repoint. Admin infrastructure pre-exists the rebuild; this
read DISCOVERS its shape from source and PROPOSES the phase against findings (architecture ruled
from evidence, not priors). Every claim below is source-verified (file:line).

---

## §0 — THE HEADLINE: a hard FE↔BE admin-identity DIVERGENCE

The backend and frontend model "admin" **incompatibly**:

| | Backend (`apps/api`) — the rebuild's model | Frontend (`apps/web`) — the pre-rebuild model |
|---|---|---|
| Identity | **`role` enum on the `users` table** | **separate Supabase `admin_profiles` table** (own PK, `user_id` FK) |
| Roles | `admin`, `superadmin` (`schema.ts:24-30`) | `superadmin`, `admin`, **`moderator`** (`types/admin.ts:7`) |
| Extras | none (role is the whole model) | **`permissions: string[]`**, `is_active`, `last_login` (`types/admin.ts:8-10`) |
| Auth | better-auth keystone, same `/api/signin` as users; `requireAuth` attaches `role` (`require-auth.ts:34-39`) | **`supabase.auth.signInWithPassword`** + an `admin_profiles` lookup (`admin.service.ts:34-69`) |
| Session | better-auth cookie (shared with users) | Supabase session + a **separate** Zustand `admin.store` (localStorage `admin-storage`) |
| State today | ready, unused (no admin routes) | **DEAD** — Supabase is gone, so admin login does not work at all |

**This is the central ruling the phase needs (§7 / §9-D1).** The backend deliberately collapsed
admin into `users.role` (the "dual-identity collapse", `schema.ts:17-22`; the `promote-to-admin`
script sets `role='superadmin'`). The frontend still expects the old `admin_profiles` world. The
repoint is **not just endpoints** — the FE's identity model must converge onto the BE's
role-on-users model (dropping `admin_profiles`, `moderator`, `permissions[]`), OR the BE must grow
the `admin_profiles` model (contradicts its design). My recommendation: **converge onto
role-on-users** (§7).

---

## §1 — Admin identity model (verified)

- **`apps/api/src/db/schema.ts:24-30`** — `userRole` pgEnum = `advertiser | individual_owner |
  fleet_owner | admin | superadmin`; **`:46`** `role: userRole('role').notNull().default('advertiser')`.
- **No `admins` / `admin_profiles` / `admin_activities` table exists in the apps/api schema.** Admin
  is purely a role value. Promotion is CLI-only: **`apps/api/scripts/promote-to-admin.ts`**
  (`pnpm --filter @toodooh/api promote <email>` → `role='superadmin'`).
- better-auth (`auth.ts`) marks `role` server-controlled (`input: false`) — clients cannot
  self-elevate. ✓ secure by construction.
- **FE counter-model:** `admin.service.ts:48-53` queries Supabase `admin_profiles` by `user_id` +
  `is_active=true`; `types/admin.ts:1-14` `AdminProfile` carries `role`, `permissions[]`,
  `is_active`, `last_login`, `created_by`.

## §2 — `/admin-login` + admin auth state (verified)

- `apps/web/src/features/admin/pages/AdminLogin.tsx` → `useAdminStore().login()` →
  **`adminService.login()`** (`admin.service.ts:32`) → `supabase.auth.signInWithPassword` + the
  `admin_profiles` gate. **100% dead Supabase → admin signin is currently broken** (no working
  backend).
- **Not** the keystone: does not touch `lib/api-client` / `/api/*` / the user `auth.store`. Separate
  `admin.store.ts` (Zustand + persist `admin-storage`), `initialize()` →
  `adminService.getCurrentAdmin()` (Supabase session check).
- `AdminRoute.tsx` guards on `admin` + `initialized`, supports a `requiredRoles` prop (App.tsx
  already passes `['superadmin']` / `['superadmin','admin']` per route).
- **BE readiness for the repoint:** admins are just users with `role∈{admin,superadmin}` → they
  can sign in via the **existing** `/api/signin`; `requireAuth` already exposes `request.user.role`
  (`require-auth.ts:34-39`). So admin auth under the BE model needs **no new auth endpoint** — only
  a role check + a `requireAdmin` guard.

## §3 — Admin UI surface (verified)

12 pages under `features/admin/pages/`. **All dead-Supabase** — **13 files import `@/lib/supabase`**:
8 services (`admin`, `admin-user`, `admin-video`, `admin-screens`, `admin-recharges`,
`admin-campaign-monitoring`, `admin-events`, `platform-stats`) + 4 hooks (`useUsers`,
`useAdminScreens`, `useCampaignMonitoring`, `useRecharges`) + `pages/EventManagement.tsx`.

| Page | Backend dep | 1g-relevant? |
|---|---|---|
| **UserManagement** | `admin-user.service` (Supabase `business_profiles`) — **the built approval queue**: pending filter, approve/reject single + bulk, doc (CIN/RNE) review, agent-code, delete-cascade | **YES — the core** |
| AdminLogin / admin.store | Supabase auth + `admin_profiles` | **YES — auth** |
| AdminDashboard | `platform-stats.service` (aggregate stats) | maybe (admin-infra) |
| AdminManagement / CreateAdmin | `admin.service` CRUD on `admin_profiles` (create/deactivate admins) | maybe (admin-infra; becomes "promote user to role" under §7) |
| VideoManagement | `admin-video.service` | **NO** — depends on the video/content slice (not built) |
| ScreenManagement | `admin-screens.service` | **NO** — screens slice (not built) |
| RechargeManagement | `admin-recharges.service` | **NO** — wallet slice (not built) |
| CampaignMonitoring | `admin-campaign-monitoring.service` | **NO** — campaigns slice (not built) |
| EventManagement | inline Supabase | **NO** — events slice (not built) |
| GeographicZonesManagement / AdminGlobalConfiguration | Supabase (uninspected) | **NO** — later/config |

- **`AdminActivity`** (`types/admin.ts:61-72`) = a TYPE for an audit-log row written to Supabase
  `admin_activities` via `adminService.logActivity()`. No BE table, no dedicated page.
- **`AdminProfile`** (`types/admin.ts:1-14`) = the admin-identity TYPE (the `admin_profiles` row),
  not a page.

**Scoping boundary (key):** most admin pages can't be repointed in 1g because **their backends
don't exist yet** (screens/wallet/campaigns/events/video are unbuilt slices). 1g can only touch
what the BE supports: **admin auth (role) + the user-approval flow**. The rest stay dead until
their data slices ship (the 1f later-slice pattern).

## §4 — Approval flow intent (verified)

The approval **substrate already exists in apps/api** — only the endpoints + middleware are missing:
- `schema.ts:32` `userStatus` pgEnum = `pending | approved | rejected`; `:47`
  `status.notNull().default('pending')`. New users start **pending**.
- `schema.ts:49-51` the **validation audit trio**: `validatedBy` (uuid FK→users.id, the admin),
  `validatedAt` (timestamptz), `validationNotes` (text). `:81` `onboardingCompleted`.
- `GET /api/me` (`routes/me.ts`) returns `status` + `onboarding_completed`. `auth.store.ts:50-58`
  `mapRouting` derives `validationStatus = u.status`, `needsApproval = u.status !== 'approved'`.
- **What approval flips** (from the FE Supabase impl `admin-user.service.ts:155-189`, the intent to
  preserve): **approve** → `status='approved'` + **`onboarding_completed=true`** + `validatedBy` +
  `validatedAt` (+ optional notes). **reject** → `status='rejected'` + `validatedBy` + `validatedAt`
  (+ notes).
- **Pending-state UX** (`App.tsx:97-132`): `AdvertiserRoute`/`OwnerRoute` **let pending users
  reach their dashboard**; features grey out via `isDisabled = needsApproval && status==='pending'`
  (`canLaunchCampaign`/`canRechargeAccount` gated on `status==='approved'`). **No dedicated
  "compte en attente" screen** — status shows only as disabled controls + the dashboard validation
  pill. (So 1g changes nothing in the pending UX; approval just flips `status`, and the next
  `/api/me` unlocks the dashboard.)
- **No approve/reject/pending endpoint exists in apps/api** (confirmed absent; `routes/index.ts:12`
  has a placeholder comment "Future routes (/api/admin/users) register here").

## §5 — Audit trio

The who/when/why audit for validation IS the schema's `validatedBy` / `validatedAt` /
`validationNotes` (`schema.ts:49-51`) — 1g's approve/reject endpoints write exactly these
(`validatedBy = request.user.id`). General `created_by`/`updated_by` are NOT modeled (only
`createdAt`/`updatedAt`); that's consistent with 1b-1e. **Decision (§9-D4):** the FE's
`admin_activities` action-log (every admin action) has **no BE equivalent** — either drop it
(approval already self-audits via the trio) or add an `admin_activity` table (scope creep; lean:
drop for slice 1).

## §6 — Done / Dead / Missing / Broken

- **✓ Already on apps/api (works):** the approval *substrate* — `status` enum, the validation trio,
  `onboardingCompleted`, `requireAuth` exposing `role`, `/api/signin`, `/api/me` returning status.
  Nothing admin-*specific* is done.
- **✗ Dead Supabase (needs repoint):** the ENTIRE admin FE — auth (`admin.service`/`admin.store`)
  + all 13 supabase-importing files. Only the **auth + UserManagement-approval** slice is
  repointable in 1g (the rest lack backends).
- **⚠ Never existed (build net-new):** `requireAdmin` middleware; `GET /api/admin/users` (pending
  queue / list+filter); `POST /api/admin/users/:id/approve`; `POST /api/admin/users/:id/reject`.
- **⚠ Exists but broken/divergent:** the admin identity model (FE `admin_profiles`+`moderator`+
  `permissions[]` vs BE role-on-users); `AdminManagement`/`CreateAdmin` (CRUD on a table that
  doesn't exist in apps/api); `admin_activities` logging (no BE table).

## §7 — Proposed phase shape (against findings — PROPOSE, await ruling)

Recommended direction: **converge the FE admin onto the BE role-on-users model** (matches the
rebuild's identity-collapse + the 1f centralize-on-keystone outcome). Drop `admin_profiles`,
`moderator`, `permissions[]` — the BE doesn't model them and slice-1 doesn't need them
(role∈{admin,superadmin} + the existing `requiredRoles` route prop suffice).

| Commit | Scope |
|---|---|
| **G0 — admin auth onto the keystone** | Repoint `AdminLogin`/`admin.store` off Supabase: admin signs in via the existing `/api/signin`; gate on `role∈{admin,superadmin}` from `/api/me`. Collapse `admin.store` onto the user `auth.store` (or a thin role-derived guard); rework `AdminRoute` to read role. Drop the `admin_profiles`/`moderator`/`permissions` types. (Could fold into the user auth-store rather than a parallel store.) |
| **G1 — backend approval endpoints + guard (net-new, keystone discipline — built WITH G2's consumer)** | `requireAdmin` preHandler (reads `request.user.role`); `GET /api/admin/users` (list + status/type filter for the pending queue); `POST /api/admin/users/:id/approve` (status→approved, onboarding_completed→true, validatedBy/At/notes); `POST /api/admin/users/:id/reject` (status→rejected, validatedBy/At/notes). apps/api integration tests per endpoint (1b-1e pattern). |
| **G2 — UserManagement approval repoint** | Point `admin-user.service` / `useUsers` / the approve-reject-bulk UI at the G1 endpoints (1f-style); drop the Supabase `business_profiles` reads. Preserve the existing queue/doc-review UX. |
| **G3 — audit refresh + phase close** | Record 1g in `docs/audit.md`; carry-forward the deferred admin pages (video/screens/recharges/campaigns/events/zones/config + AdminManagement/CreateAdmin/AdminDashboard-stats) to their data slices. |

**Explicitly deferred (out of 1g):** every admin page whose backend slice is unbuilt
(Video/Screens/Recharge/Campaign/Events/Zones/Config) — they stay dead-Supabase until those
slices ship, exactly as 1f deferred owner later-slices. **Decision (§9-D2):** are
AdminDashboard-stats + AdminManagement/CreateAdmin (admin-account mgmt) in 1g, or also deferred? My
lean: defer — slice-1's mandate is *approval*; admin creation stays the CLI `promote-to-admin`
script for now.

## §8 — Sub-factoring + test bar + floor

- **Test bar:** apps/api — integration tests per new endpoint (the 1b-1e pattern: requireAdmin
  401/403 for non-admin, approve/reject happy + status transitions + the validation-trio writes).
  apps/web — node-level service/hook tests (the 1f pattern); RTL stays not-stood-up unless the
  approval UI grows real logic.
- **Floor expectations:** apps/web typecheck likely **drops** (dead-Supabase admin types/`any`
  cleared as files repoint — the `AdminActivity`/`AdminProfile`-driven baseline errors among the
  36); lint flat→possibly down (fewer supabase imports); build flat or down. apps/api test count
  **up** (new endpoint tests); typecheck/lint flat at 0/0.
- **CF reminders:** the lint-staged baseline blocker + root-lint-vs-scoped lessons apply if any
  repoint stages files that touch `supabase.ts`'s orbit. Node 20.20.2 for all commits.

## §9 — Decisions for ruling

- **D1 (the big one):** identity model — **converge FE onto BE role-on-users** (my rec) vs build
  `admin_profiles` in the BE. Confirms whether `moderator` + `permissions[]` are dropped.
- **D2:** 1g scope boundary — **approval-only** (auth + pending-queue + approve/reject + User
  Management) vs also include AdminDashboard-stats + AdminManagement/CreateAdmin. (Rec: approval-
  only; defer the rest.)
- **D3:** admin auth shape — collapse `admin.store` into the user `auth.store` (one session model)
  vs keep a thin separate admin guard reading the same `/api/me` role. (Rec: collapse — one keystone.)
- **D4:** `admin_activities` action-log — drop for slice 1 (approval self-audits via the trio) vs
  add a BE table. (Rec: drop.)
- **D5:** approve semantics — confirm approve sets **`onboarding_completed=true`** (the FE did this
  to unlock the dashboard) — keep that, or is onboarding separate from approval?
- **D6:** the `/admin-login` route + `requiredRoles` — keep the dedicated admin login page (just
  repointed) vs route admins through the normal `/login` + role-redirect. (Rec: keep `/admin-login`
  page, repointed.)

## §10 — Status

Drafted, **read-only, held**. No edits/commits/plan-doc. The phase shape (§7) is PROPOSED against
the verified findings; the §9 decisions — above all **D1 (the FE↔BE identity divergence)** — need
architect ruling before any 1g plan-doc. Track B (Figma) parked; 1h (deployment + nginx landing
serve) follows 1g.
