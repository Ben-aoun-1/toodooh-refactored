# Phase 1g · G0 — admin auth onto the keystone + store collapse

**Date:** 2026-05-28 · **Phase 1g commit 1 of 4** (G0/G1/G2/G3) · **Companion:**
`docs/handoff/phase-1g-admin-scoping.md` (ratified; D1-D6 ruled) · **HEAD:** `7d54701` ·
**Floor:** apps/web typecheck 36 / lint 1 / test 217 / build 135.81; apps/api 146.

**Goal.** Converge the admin frontend onto the backend's role-on-users model (D1): admin signs in
via the existing `/api/signin`, gated on `role∈{admin,superadmin}` read from `/api/me`/signin;
the standalone `admin.store` (dead-Supabase `admin_profiles`) is collapsed into the user
`auth.store` with role-derived selectors (D3). The dedicated `/admin-login` page stays, repointed
(D6). **FE-only — no backend change** (the BE substrate is already complete, §0).

---

## §0 — Source-confirm (CF-23, verified at plan-write)

- **BE substrate READY — no change needed:** `/api/signin` returns `role` (`apps/api/src/routes/signin.ts:95`); `/api/me` returns `role` (`apps/api/src/routes/me.ts:59`); `requireAuth` attaches `request.user.role` (`require-auth.ts:34-39`). The FE `SessionUser` type **already declares `role: string`** (`apps/web/src/features/auth/types/auth.ts:168`); `MeUser` too (`:135`).
- **The only FE gap:** `auth.store.ts`'s `mapRouting` (`:50-58`) does **not** map `role` into store state, and `AuthState` (`:29-47`) has no `role` field. So role arrives from the wire but is dropped.
- **`/admin-login` EXISTS** — `App.tsx:490` route → `AdminLogin.tsx`; `AdminRoute` wraps the admin pages with `requiredRoles` props already (`['superadmin']` / `['superadmin','admin']`). → G0 **repoints**, doesn't build.
- **`admin.store` consumers (11)** — grep-confirmed:
  - **Auth/layout (3 — full repoint):** `AdminLogin.tsx:12` (`login,loading`), `AdminRoute.tsx:12` (`admin,initialized,initialize,loading`), `AdminLayout.tsx:34` (`admin,logout`).
  - **Display-only (8 — mechanical identity swap):** `AdminDashboard:23`, `VideoManagement:13`, `CreateAdmin:22`, `EventManagement:32`, `AdminManagement:23`, `UserManagement:30`, `RechargeManagement:33`, `CampaignMonitoring:47` — each `const { admin } = useAdminStore()`, used for a header greeting (`admin.first_name`/`.email`). Their DATA stays dead-Supabase (deferred per D2); only the identity read moves.
- **`admin.service.ts`** auth methods (`login`/`logout`/`getCurrentAdmin` + `mapAdminError`) are consumed **only** by `admin.store` → removable once the store goes. The other methods (`createAdmin`/`getAdmins`/`updateAdmin`/`deleteAdmin`/`getDashboardStats`/`logActivity`/`getActivities`) belong to deferred pages (AdminManagement/CreateAdmin/AdminDashboard) and **stay dead-Supabase** (deferred).

Halt-on-finding if any of the above differs at execution.

---

## §1 — Locked constraints

- **No backend change** — `/api/signin` + `/api/me` already carry `role`.
- **Admin = a user with `role∈{admin,superadmin}`** (D1). No `moderator`, no `permissions[]`.
- **One session model** (D3): the better-auth cookie + the user `auth.store`. Admin identity is a
  derived selector, not a second store. The Supabase admin session is gone.
- **`/admin-login` page kept** (D6): mechanism = `/admin-login` → `auth.store.login()` (POST
  `/api/signin`) → check role from the store → admin/superadmin → `/admin-dashboard`; else error
  ("Ce compte n'est pas un compte administrateur") + `clearSession()`.
- **No `admin_activities` log** (D4). **Approval semantics** (D5) are G1's concern, not G0.

## §2 — Inventory phase (exact edits)

### §2.A — `auth.store.ts` — carry `role` + selectors
- `AuthState`: add `role: string | null`.
- `mapRouting`: add `role: u.role`.
- `LOGGED_OUT`: add `role: null`.
- initial state: `role: null`.
- Export selectors (the D3 derivation): `useIsAdmin = () => useAuthStore(s => s.role === 'admin' || s.role === 'superadmin')` and `useIsSuperadmin = () => useAuthStore(s => s.role === 'superadmin')`. (Persisted cushion: `role` joins the persisted routing fields so a reload paints before `/api/me` resolves, consistent with the existing cushion.)

### §2.B — `AdminLogin.tsx` — repoint to the keystone
- Replace `useAdminStore().login` with `useAuthStore().login` (POST `/api/signin`).
- After `await login(...)`: read role from the store; if `role∈{admin,superadmin}` → `navigate('/admin-dashboard')`; else → `toast.error('Ce compte n'est pas un compte administrateur')` + `clearSession()` (don't leave a non-admin logged into the admin surface).
- Keep the page's visual treatment unchanged.

### §2.C — `AdminRoute.tsx` — gate on the auth-store role
- Replace `useAdminStore` with `useAuthStore` (`user`, `initialized`) + `useIsAdmin()`.
- `auth.store.initialize()` already runs in `App.tsx` (root) — **drop AdminRoute's own `initialize()` call** (no second init).
- Logic: `!initialized` → spinner; `!user` → `<Navigate to="/admin-login" />`; `user` but not admin → `<Navigate to="/admin-login" />` (or `/login`); `requiredRoles.length && !requiredRoles.includes(role)` → redirect. (Keep the `requiredRoles` prop contract — App.tsx passes it.)

### §2.D — `AdminLayout.tsx` — identity + logout from auth.store
- `admin,logout` → `useAuthStore` (`contactName`/`user.email` for the greeting, `logout` for sign-out). The Supabase logout path is gone (auth.store.logout → POST `/api/signout`).

### §2.E — the 8 display-only pages — mechanical identity swap
- `const { admin } = useAdminStore()` → read identity from `useAuthStore` (e.g. `const contactName = useAuthStore(s => s.contactName)`); replace `admin?.first_name`/`admin?.email` greeting reads accordingly. **No data-layer change** (these pages stay dead-Supabase, deferred per D2). Purely to keep the build green after the store deletion.

### §2.F — delete `admin.store.ts` + trim `admin.service.ts`
- Delete `apps/web/src/features/admin/stores/admin.store.ts`.
- Remove `admin.service.ts` `login`/`logout`/`getCurrentAdmin` (+ `mapAdminError` if orphaned). Keep the deferred methods (+ their supabase import) untouched.
- `types/admin.ts` STAYS (the deferred admin.service methods + AdminManagement still reference `AdminProfile` etc.) — not G0's to remove.

### §2.G — Mechanical-vs-judgment
- §2.A/B/C/D = **judgment** (auth wiring). §2.E = **mechanical** (identity-read swap). §2.F = **mechanical** (deletion + dead-method removal).

## §3 — Commit factoring

**Default: ONE commit (G0).** The store collapse is atomic — `admin.store` can't be deleted while 11 files import it, so all 11 + the auth.store change land together.

**Optional split (surface at ratification):** G0a = the auth core (auth.store + AdminLogin + AdminRoute + AdminLayout + delete admin.store + the 8 swaps) is still atomic (the deletion forces the 8). There's no clean sub-atomic split — the 8 swaps are *required* by the deletion. So **G0 stays one commit**; flagged here only to preempt the "why is G0 11 files" question — it's the honest cost of D3's collapse, not scope creep.

Commit subject: `refactor(web): Phase-1g G0 — converge admin auth onto the keystone (role-on-users), collapse admin.store`. No `Co-Authored-By`.

## §4 — Verification gates

| Gate | Baseline | Expected |
|---|---|---|
| apps/web typecheck | 36 | **36 or DOWN** (removing the Supabase admin-auth `any`/types may clear a baseline error or two; must not go UP) |
| apps/web lint | 1 | **1** (fewer supabase imports; the `database.types` floor unchanged) |
| apps/web test | 217 | **217** (no test references admin.store; G0 adds none unless a selector test is warranted — likely none) |
| apps/web build | 135.81 kB | **flat or down** (admin.store + dead auth methods removed) |
| apps/api | 146 | **untouched** (zero BE files) |

**Visual QA (MABA):** with a promoted account (role∈{admin,superadmin} — see §6), `/admin-login` → sign in → lands on `/admin-dashboard`; a non-admin account → the error + no admin access; `/admin-*` routes gate correctly; logout works. (The admin *pages* still show dead-Supabase data — that's deferred; G0 only proves auth + gating.)

## §5 — Hard-halt conditions
- §0 source-confirm drift.
- typecheck UP / lint off 1 / tests change unexpectedly.
- A 12th `useAdminStore` consumer surfaces at execution (re-grep before deleting).
- An admin page imports `admin.store` for something beyond identity display (would need more than a mechanical swap) — surface.

## §6 — NEEDS FROM MABA (confirms — not blocking the plan, blocking the QA)
1. **Promotion:** confirm MABA + Kais accounts have `role∈{admin,superadmin}` (or run `pnpm --filter @toodooh/api promote <email>`). Without a promoted account, G0 ships correct but can't be visually tested (no admin to log in as).
2. ~~`/admin-login` exists?~~ **Confirmed** — it exists (App.tsx:490 + the page); G0 repoints it.

## §7 — Carry-forward / cross-refs
- CF-7 gate-sweep code-push; CF-9 pause-summary; Node 20.20.2; [[root-lint-vs-scoped]] (run ROOT `pnpm lint` in the sweep — admin files are under apps/web so scoped catches them, but root is the CI parity); [[lint-staged-baseline-blocker]] (none of G0's files touch `supabase.ts` directly, so no blocker).
- This is the 1f CF-24 pattern (FE catches up to BE contract authority) applied to admin identity.
- G1 (backend approve/reject + requireAdmin) builds next, gating on the `role` G0 now surfaces.

## §8 — Files touched
```
M  apps/web/src/features/auth/stores/auth.store.ts                 # +role +useIsAdmin/useIsSuperadmin (§2.A)
M  apps/web/src/features/admin/pages/AdminLogin.tsx                # /api/signin + role gate (§2.B)
M  apps/web/src/features/admin/components/AdminRoute.tsx           # auth-store role gate (§2.C)
M  apps/web/src/features/admin/components/AdminLayout.tsx          # identity+logout from auth.store (§2.D)
M  apps/web/src/features/admin/pages/AdminDashboard.tsx            # identity swap (§2.E)
M  apps/web/src/features/admin/pages/VideoManagement.tsx          # identity swap
M  apps/web/src/features/admin/pages/CreateAdmin.tsx              # identity swap
M  apps/web/src/features/admin/pages/EventManagement.tsx         # identity swap
M  apps/web/src/features/admin/pages/AdminManagement.tsx         # identity swap
M  apps/web/src/features/admin/pages/UserManagement.tsx          # identity swap (its DATA repoint is G2)
M  apps/web/src/features/admin/pages/RechargeManagement.tsx      # identity swap
M  apps/web/src/features/admin/pages/CampaignMonitoring.tsx      # identity swap
M  apps/web/src/features/admin/services/admin.service.ts          # remove login/logout/getCurrentAdmin (§2.F)
D  apps/web/src/features/admin/stores/admin.store.ts              # collapsed into auth.store (§2.F)
```
**14 files (13 M + 1 D), all `apps/web`.** No apps/api, no test, no lockfile.

## §9 — Status
Drafted, awaiting ratification. FE-only; no BE change (substrate ready). The 14-file blast is the
honest cost of the D3 store-collapse (the deletion forces the 8 identity swaps). On ratification:
§0 re-confirm → apply → gate-sweep → CF-9 → push. G1 follows.
