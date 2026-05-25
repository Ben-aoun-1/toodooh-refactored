# Frontend repoint survey — Phase 1e reconnaissance

**Source:** `apps/web` React frontend + `apps/api` Fastify backend (read directly, CF-23 —
source authoritative, not assumption).
**Date generated:** 2026-05-25 (Phase 1e opening; HEAD `3cd8d98`, working tree clean).
**Purpose:** A read-only map of `apps/web`'s current structure relevant to the Supabase→`apps/api`
repoint, plus a *proposed* Phase-1e commit breakdown for architect ratification. This is
reconnaissance — **no code edits, no commits**. The commit breakdown (§7) is a proposal to ratify,
not a plan to execute.

**Companion docs.** `frontend-backend-contract.md` is the authoritative endpoint reference (CF-24;
§7 rulings — Option B, the (a)/(b) dispositions). This survey is its `apps/web`-side execution map:
the contract says *what each endpoint must be*; this says *where in `apps/web` each call lives and
what order to rewire it*. `audit.md` §7.6 carries the floor-change note this survey relies on.

> **Scope note.** Phase 1e repoints the **account/auth layer only** — the slice-1 surface the
> backend has shipped (Phases 1b–1d): signup, signin/signout, profile edits, documents, password,
> email verification. The campaign / screen / wallet / admin / events Supabase calls (§2.3) stay on
> Supabase until their own slices ship a backend. This bounds the repoint and, critically, means
> `src/lib/supabase.ts` is **not** deleted in Phase 1e (§2.4).

**Counting caveat (CF-10).** Surface counts below come from line-anchored `grep`. Multi-line call
chains (e.g. `auth.store.ts:135` splits `supabase` / `.from('business_profiles')` across two lines)
are undercounted by the per-line tally. Treat every count as an **approximate lower bound**; the
per-file table (§2.2) is reconciled against reads where it matters. Exact call-site enumeration is
deferred to each repoint commit's own inventory.

---

## §1 — Auth architecture (current state + recommendation)

### §1.1 — It is already centralized

`apps/web` auth is **not** scattered supabase-from-every-form. It funnels through two layers:

1. **`features/auth/services/auth.service.ts`** (945 lines) — the **wire layer**. A single
   `authService` object wraps every `supabase.auth.*` call (`login`, `signUp`, `logout`,
   `getCurrentUser`, `resetPassword`, `updatePassword`, `updatePasswordWithOld`,
   `updateBusinessProfile`, `updateProfile`, `getBusinessProfile`, `deactivateAccount`) plus the
   reference-data reads (`getGovernorates`, `getBusinessSectors`, `getOwnerBusinessSectors`,
   `getCompanySizeOptions`, `getSupportObjectives*`) and the signup document/logo uploads. It also
   owns `mapAuthError` (`:20–176`) — the technical-error→French-message map.
2. **`features/auth/stores/auth.store.ts`** (586 lines) — the **session-state layer**. A Zustand
   `persist` store (`useAuthStore`, persist key `toodooh-auth`) holding `user` (Supabase `User`),
   `profileType`, `contactName`, `onboardingCompleted`, `needsApproval`, `validationStatus`. It
   exposes `login` / `logout` / `initialize` / `refreshUserStatus`, delegates wire calls to
   `authService`, and reads `business_profiles` **directly** via `supabase.from` (the multi-line
   `fetchProfileType`, `:135`) to populate routing state. Session lifecycle rides Supabase's own
   `onAuthStateChange` listener (`:278`) + `persistSession:true` (`supabase.ts:10`).

This is the Step-3 consolidation (audit §7.5 row 3 — "Auth-state layer consolidated onto a
`persist`'d Zustand store"). Components do **not** call `supabase.auth` for session reads; they read
`useAuthStore()`.

### §1.2 — Where session/identity state is read

- **"Am I logged in?"** — `useAuthStore().user` (truthy = authenticated).
- **"Who am I / my role?"** — `useAuthStore().profileType` (`'advertiser' | 'agency' |
  'individual_owner' | 'fleet_owner'`), `contactName`.
- **"My status?"** — `validationStatus` / `needsApproval` / `onboardingCompleted`.
- **Admin identity is separate** — `features/admin/stores/admin.store.ts` (`useAdminStore`), checked
  by `auth.store.ts:72`. Admin login is out of Phase-1e scope (contract §3.3; admin is Phase 1f).

### §1.3 — How routing gates on auth

`App.tsx` uses real `react-router-dom` v6 routes (cleanup Step 7) with four guard wrappers, each
reading `useAuthStore()`:

- `PublicRoute` (`:135`) — if `user`, redirect to dashboard by `profileType` (owner →
  `/owner-dashboard`, else `/dashboard`).
- `AdvertiserRoute` (`:81`) — `!user` → `/login`; owner `profileType` → `/owner-dashboard`.
- `OwnerRoute` (`:108`) — `!user` → `/login`; non-owner → `/dashboard`.
- `AdminRoute` (`features/admin/components`) — reads the admin store; `requiredRoles` prop.

`LoginForm.tsx:26–32` does the same owner-vs-advertiser redirect post-login from the store's
`profileType`. So **all role-gating reads one field: `useAuthStore().profileType`.**

### §1.4 — Recommendation: CENTRALIZE first, then repoint flows

**Repoint the wire layer (`auth.service.ts`) and the store's session model FIRST, in a dedicated
commit, before touching individual forms.** Reasoning:

- The architecture already centralizes — the forms call `authService` / `useAuthStore`, not
  Supabase. Rewiring `auth.service.ts` to hit `apps/api` (and reshaping `auth.store.ts`'s session
  source from `supabase.auth.getUser`/`onAuthStateChange` to the better-auth cookie + a
  `GET /api/...session` read) repoints **most flows at once** by construction. The forms barely
  change.
- The session model is the load-bearing swap: Supabase's client-managed JWT (`persistSession`,
  `autoRefreshToken`, `onAuthStateChange`) → a server-set **httpOnly cookie** the JS cannot read.
  `auth.store.ts` currently stores the Supabase `User` object and reacts to auth events; post-repoint
  it must derive "logged in / who am I" from a session **fetch** (cookie-authenticated), since the
  cookie is invisible to JS. This is a store-shape change that every guard depends on — do it once,
  centrally, not per-form.
- Form-by-form would mean N forms each independently learning the new session model — N chances to
  diverge. Centralizing makes the per-flow commits thin (swap the `authService` method body + adapt
  the response shape), which is the contract's (a)-class adapter work.

**Caveat surfaced (not resolved):** the store's `profileType`/`needsApproval`/`onboarding_completed`
today come from a `business_profiles` row read (`auth.store.ts:135`). Post-repoint these come from
the **signin response** (`toProfileType(role, business_type)`, `signin.ts:20`) + a session/profile
read. Whether the store keeps a separate profile fetch or folds it into a single session endpoint is
a design choice for the centralize commit — flagged for §7.

---

## §2 — The Supabase surface (call inventory → replacement)

### §2.1 — Totals (line-anchored lower bounds, CF-10)

| Call family | Sites (≈) | Files |
|---|---|---|
| `supabase.auth.*` | 35 | 13 |
| `supabase.from(…)` | 76+ | ~30 |
| `supabase.rpc(…)` | 33 | ~15 |
| `supabase.storage.*` | 27 | 10 |

The single client: **`src/lib/supabase.ts`** (`createClient<Database>` from
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, importing `./database.types`).

### §2.2 — Phase-1e in-scope files (the account layer — the repoint checklist)

These are the files Phase 1e rewires. Everything else (§2.3) stays on Supabase.

| File | auth | from | rpc | storage | Replacement (apps/api) |
|---|---|---|---|---|---|
| `features/auth/services/auth.service.ts` | 10 | 2 | 3 | 4 | The whole account API (signup/signin/signout/password/profile/documents) + reference reads |
| `features/auth/stores/auth.store.ts` | 1 | 1* | 0 | 0 | Session source: cookie + session/profile read (no `onAuthStateChange`) |
| `features/advertiser/pages/UserProfile.tsx` | 1 | 0 | 0 | 1 | `getCurrentUser`→session; logo upload→`POST /api/profile/documents/:type` |
| `features/advertiser/hooks/useProfileMutations.ts` | 0 | 0 | 0 | 3 | `PATCH /api/profile/*` + documents API |
| `features/screenhost/pages/OwnerSettings.tsx` | 1 | 0 | 0 | 2 | session + documents API |
| `features/auth/hooks/useOwnerProfileMutations.ts` | 0 | 0 | 0 | 4 | `PATCH /api/profile/{business,contact,address,notifications}` + documents API |

\* multi-line `supabase.from('business_profiles')` (`auth.store.ts:135`) — undercounted by the table.

**Reference-data reads inside `auth.service.ts`** (feed signup + profile forms): `governorates`,
`business_sectors`, `owner_business_sectors` (the §5.3 collapse → `business_sectors?audience=owner`,
2 sites incl. `performance.service.ts:450`), `company_size_options`, `support_objectives_*`. These
need read endpoints on `apps/api` — a **gap**: the backend has shipped *writes* (signup/profile)
but no reference-data GETs yet. Flagged for §7.

### §2.3 — Out-of-Phase-1e (later slices — stay on Supabase)

Per contract §3.8–§3.12, these have **no backend yet** and are not repointed in 1e:

- **Campaigns/video** — `campaign.service.ts`, `campaign-screens.service.ts`,
  `campaign-owner-approval.service.ts`, `campaign-hourly-location-plan.service.ts`,
  `video-upload.service.ts`, `useCampaignMutations.ts`, `useCampaignDetail.ts`, `useVideoById.ts`,
  `useMyApprovedVideos.ts` (+ `events.service.ts`).
- **Screens/locations** — `screens.service.ts` (auth=5/from=5/rpc=1),
  `predefined-zones.service.ts`, `useOwnerScreensMutations.ts`.
- **Wallet/money** — `useSaveBankDetails.ts`, `useInvoices.ts`, `invoice-pdf.service.ts`,
  `revenue.service.ts`, `balance.service.ts` (CLAUDE.md rule 10 — money-adjacent).
- **Admin** — all `features/admin/**` services (`admin.service.ts` auth=4, `admin-user.service.ts`,
  `admin-video.service.ts`, `admin-events.service.ts`, `admin-recharges.service.ts`,
  `admin-screens.service.ts`, `admin-campaign-monitoring.service.ts`, `platform-stats.service.ts`,
  `useUsers.ts`, `EventManagement.tsx`).
- **Performances/notifications/global-config** — `performance.service.ts`,
  `usePerformanceDataset.ts`, `use*Notifications.ts`, `global-configuration.service.ts`.

### §2.4 — Consequence: the Supabase client stays, lint-1 floor likely does NOT clear in 1e

Because §2.3 files still `import { supabase } from '@/lib/supabase'`, **`src/lib/supabase.ts`
cannot be deleted in Phase 1e**, and its `import { Database } from './database.types'` (file
**absent** — confirmed) stays unresolved. So:

- The Supabase-removal "cleanup sweep" in Phase 1e is **bounded to the account-layer call sites** —
  it removes Supabase *usage* in the in-scope files, not the client itself.
- The **lint-1 floor (`import-x/no-unresolved` on `database.types`) will NOT clear from the account
  repoint** — it clears only when either (a) all slices are repointed and `supabase.ts` is deleted,
  or (b) TBD #15 generates `database.types` (audit §7.6). **This refines the §7.6 note:** the lint-1
  clear is gated on the *last* slice or #15, not Phase 1e. Surfaced so a still-1 lint floor at
  Phase-1e close is not read as a miss.
- The **typecheck floor (51) drops partially** — the ~50 `apps/web` errors that stem from the
  untyped account-layer `supabase` calls (the `as any` / `no-explicit-any` TODOs in `auth.store.ts`
  + `auth.service.ts` tagged `see #15`) resolve as those calls leave; errors rooted in later-slice
  files (react-leaflet, `AdminActivity`/`AdminProfile`) persist. A partial ratchet-down, as §7.6
  predicted — but smaller than "all ~50."

---

## §3 — Forms/flows → backend endpoints (the repoint map)

| # | Flow | FE files | Current Supabase wiring | Backend endpoint | Class / gap |
|---|---|---|---|---|---|
| 1 | **Sign-up** (5-step wizard) | `SignUpForm.tsx` (~1940 ln), `pages/SignUp.tsx`, `auth.service.ts signUp()` (`:281`) | `auth.auth.signUp` + `from('business_profiles').insert` + RPC fallback `create_business_profile` + storage `registres` + `from('locations')` (fleet) | `POST /api/signup` (**shipped**, but **signup-grows** pending: full profile, `tax_number` nullable, `profile_type`→role+business_type) | (a)+(b); backend signup must grow first |
| 2 | **Sign-in** | `LoginForm.tsx`, `pages/Login.tsx`, `auth.store.login`, `auth.service.login` (`:269`) | `auth.signInWithPassword` + store `fetchProfileType` (`business_profiles` read) | `POST /api/signin` (**shipped** — `toProfileType` body, 403 verify-first, generic 401) | (a) consume routing body; (b) verify-first + generic |
| 3 | **Sign-out** | `auth.store.logout`, `auth.service.logout` (`:693`) | `auth.signOut` | `POST /api/signout` (**shipped**) | (a) |
| 4 | **Profile edits** | `useProfileMutations.ts`, `useOwnerProfileMutations.ts`, `UserProfile.tsx`, `OwnerSettings.tsx`, `auth.service.updateProfile` (`:820`, single method) / `updateBusinessProfile` (`:734`) | `from('business_profiles').update` | `PATCH /api/profile/{business,contact,address,notifications}` (**shipped**) — the single `updateProfile` **must SPLIT by section** | (a); the section split |
| 5 | **Documents** | `auth.service` upload helpers (`:500`,`:568`), `useProfileMutations`, `useOwnerProfileMutations`, `UserProfile`, `OwnerSettings` | `storage.from('registres').upload` + `createSignedUrl` + write `*_doc_url` | `POST` + `GET /api/profile/documents/:type` (**shipped**) — add the `type` discriminator (cin/rne/logo) | (a); discriminator + storage→API |
| 6 | **Password reset (request)** | `ResetPasswordForm.tsx`, `pages/ResetPassword.tsx`, `auth.service.resetPassword` (`:698`) | `auth.resetPasswordForEmail({ redirectTo:/update-password })` | `POST /api/password/reset-request` (**shipped** — generic 200) | (a)+(b) generic |
| 7 | **Password reset (consume link)** | `UpdatePasswordForm.tsx`, `pages/UpdatePassword.tsx`, `auth.service.updatePassword` (`:705`) | `auth.updateUser({ password })`; route `/update-password` exists | `POST /api/password/reset` (**shipped** — consumes the `verifications`-row token, revokes sessions) | (a); the reset page consumes the link token |
| 8 | **Password change (settings)** | `UpdatePasswordForm` settings path, `auth.service.updatePasswordWithOld` (`:760`), owner-settings | re-auth `signInWithPassword` + `auth.updateUser` | `POST /api/password/change` (**shipped**) | (a) |
| 9 | **Email verification (consume)** | **NONE** — no `/auth/verify-email` route in `App.tsx`; legacy auto-logged-in | — (legacy disabled email confirm) | backend issues `…/auth/verify-email?token=` | (b)/flow — **must add the route + a post-verify "please sign in" page** |

**Routing fields the FE must consume (signin, contract §3.2 / `signin.ts`):** the response carries
`profile_type` (via `toProfileType`), role/status, `onboarding_completed` — exactly the fields
`auth.store` + the `App.tsx` guards already key on. The repoint feeds these from the response instead
of a `business_profiles` read.

**Gap — reference-data GETs (§2.2):** signup + profile forms read `governorates`,
`business_sectors`/`owner_business_sectors`, `company_size_options`, `support_objectives_*` from
Supabase. No `apps/api` read endpoints exist for these yet. Either Phase 1e adds them or the forms
can't fully repoint. **Load-bearing — surfaced for §7.**

---

## §4 — Class-(b) security changes (where each lives in `apps/web`)

Per contract §7.3 — the FE changes (backend is correct). Verified against current source (CF-23):

### §4.1 — Stop email-enumeration disclosure
- `SignUpForm.tsx:283` `validateUniqueCredentials` (blur handlers `:732` email, `:757` phone),
  `:320` message *"Cette adresse email existe déjà"*.
- `auth.service.ts:203` `checkSignupConflicts` → RPC `check_signup_conflicts_secure` (`:210`).
- `auth.service.ts:392–396` re-check throw; `:438–442` `identities.length===0` disclosure.
- `auth.service.ts:27–28, :101–121` `mapAuthError` discloses email / tax / phone existence.
- **Change:** drop the blur uniqueness check + the disclosing throws; consume the **201-generic**
  signup response and **identical generic** signin 401 / reset 200.

### §4.2 — Converge password floor to 12 + complexity everywhere
- `SignUpForm.tsx:265–266` `validatePassword` (`>=8` + upper/lower/digit), `:272` `pwHasMinLen`
  (`>=8`).
- `UpdatePasswordForm.tsx:17` `hasMinLength` (`>=8`), `:50` `minLength` (`>=8`, rendered checklist
  `:86–88`).
- `auth.service.ts:707` service guard **`<6`** (the weakest — contract §5.4).
- `useOwnerProfileMutations.ts` owner-settings adds a **special-char** rule (contract §3.9; backend
  drops the special-char requirement per §7.4 — FE converges *down* on that one, *up* to 12 on
  length).
- **Change:** every floor → **12** + upper/lower/digit (backend's rule, §7.4); delete the 6-char
  guard; drop owner-settings' extra special-char.

### §4.3 — Stop sending role/privilege at signup
- `SignUpForm` / `signUp()` send `profile_type` (4 values) + write `is_admin:false`,
  `verification_status`, `onboarding_completed` directly into `business_profiles`
  (`auth.service.ts:461–488`).
- **Change:** `profile_type` becomes a non-privileged **account-type hint**; the backend maps it to
  `role` + `business_type` (`signin.ts:20` inverse) and owns role/status (`input:false`,
  `auth.ts:118`). The FE stops writing `is_admin`/`verification_status`/`onboarding_completed`.

### §4.4 — Add verify-first (403) handling + the verify flow
- No `/auth/verify-email` route (§3#9). Signin returns **403** when unverified (`signin.ts:58`).
- **Change:** add the verify-email receiving route + a post-verify "please sign in" page (the
  deferred Phase-1b `callbackURL`); handle the signin 403 with a "verify your email" message rather
  than a generic credential error.

### §4.5 — Generic credentials handling
- `mapAuthError` *"Email ou mot de passe incorrect"* (`:66–68`) is already generic for signin — keep
  the shape, point it at the backend's generic 401.

---

## §5 — API client + CORS/cookie + dev model (the prerequisites)

### §5.1 — There is NO HTTP client in `apps/web` — it must be built
Confirmed: **no `axios`, no fetch wrapper, no `VITE_API_URL`/`apiClient`** anywhere in `src`. The
only env vars are `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL`. Today the FE
talks to exactly one backend (Supabase) through its SDK. Phase 1e must **introduce an API client
from scratch** — a `fetch` wrapper with the base URL, JSON handling, error→`mapAuthError`-style
mapping, and **`credentials: 'include'`** (so the better-auth httpOnly cookie rides every request).
A new `VITE_API_URL` env var is needed.

### §5.2 — CORS is NOT configured on `apps/api` — a BACKEND PREREQUISITE
Confirmed by reading `apps/api/src/server.ts`: it registers only `authPlugin`, `apiRoutes`,
`healthRoute`. **No `@fastify/cors`** in `apps/api/package.json`, no CORS registration anywhere. The
API has been browser-client-free through Phases 1a–1d (tests hit it server-side). A browser at the
`apps/web` origin calling `apps/api` cross-origin **will be blocked** until CORS is configured with:
- `origin` = the `apps/web` dev/prod origin (not `*` — credentialed requests forbid wildcard),
- `credentials: true` (allow the cookie).

**This is a flagged backend prerequisite commit, NOT something to silently add.** It precedes any
frontend talking to the API.

### §5.3 — Cookie attributes: better-auth defaults won't ride cross-origin XHR
`auth.ts` sets **no** `advanced.cookies` / `crossSubDomainCookies` / `defaultCookieAttributes` — so
better-auth's defaults apply (`httpOnly`, `path=/`, `sameSite=lax`, `secure` in prod). **`SameSite=Lax`
cookies are not sent on cross-origin `fetch`/XHR** — which is exactly how `apps/web` (one origin)
would call `apps/api` (another origin). Two coherent resolutions (for architect decision, §7):
- **Same-origin via dev proxy** — Vite `server.proxy` routes `/api` → `:4000`, so the browser sees
  one origin and `SameSite=Lax` works; production puts both behind one nginx origin (matches the OVH
  hosting direction). Keeps cookies `Lax`, no cross-site exposure.
- **Cross-origin with `SameSite=None; Secure`** — set the cookie attribute + CORS credentials; works
  across origins but requires HTTPS even in dev and widens CSRF surface.

### §5.4 — Dev model: does Phase 1e need both apps running?
Open question for the architect (§7). Two modes:
- **Integrated dev** — run `apps/api` (:4000) + `apps/web` (Vite) together, talking live (with the
  §5.3 proxy). Real end-to-end exercise per flow; needs Postgres + MinIO + SMTP env locally (the
  full env block, per [[local-migrate-needs-full-env-block]]).
- **Contract-built, integrated at 1g** — build the FE against the contract shapes, defer live
  wiring to a Phase-1g integration pass. Lower setup, but the repoint isn't *proven* until 1g.

The choice drives the §6 verification model and whether the CORS/proxy prereq is needed at commit 1
or deferred.

---

## §6 — Verification model for `apps/web` work

### §6.1 — The gates that exist
- **Build** — `apps/web` Vite build, floor **139.80 kB gzip** main (audit §7.6 / methodology §1).
- **Typecheck** — part of root **51** (expected to drop *partially* in 1e, §2.4).
- **Lint** — root **1** (`import-x/no-unresolved` on `database.types`; **will not clear in 1e**,
  §2.4).
- **Tests** — **160 cases across 21 files** (held flat through Phases 1a–1d).

### §6.2 — What the 160 tests actually test (and what the repoint touches)
Inventory of the 21 test files: the overwhelming majority are **pure-logic unit tests** that never
touch Supabase or auth — `queryKeys.test.ts` (×8, the query-key factories), the dooh math
(`v3-model`, `hourly-plan`, `dooh-calculation.service`, `dooh-hourly-grid`), transforms
(`dashboard-stats.transform`, `campaign-zone-match`, `useCampaignWizard`), and lib (`errors`,
`logger`, `notification-feed`, `query-client`). **Only 2 files reference Supabase**
(`useCampaignWizard.test.ts`, `global-configuration.service.test.ts`) — both **mock it via
`vi.mock`**, and **both are later-slice (§2.3), not account-layer.**

**Consequence:** there is **zero existing test coverage of the auth/profile/document/password
flows** — no LoginForm test, no `auth.service` test, no `auth.store` test. The repoint will **not
break the 160** (they don't exercise the repointed code), but it also gets **no regression safety
from them.** This is the real verification gap.

### §6.3 — Proposed verification model (for ratification, §7)
The `apps/api` real-integration pattern (real Postgres/MinIO, serialized suite) doesn't transfer —
this is browser code. The frontend equivalent, in ascending strength:
1. **Floor gates every commit** — build (≤139.80 kB ± tolerance for the new client + verify page),
   typecheck (ratchet *down* as account-layer `as any` leaves), lint (held at 1), the 160 green.
2. **New component/service tests for the repointed flows** — the gap §6.2 names. Candidates: an
   `apiClient` unit test (mocked `fetch`, asserts `credentials:'include'` + error mapping); an
   `auth.service` test against a mocked API; a `LoginForm` / verify-page component test (Testing
   Library). This would *raise* the test floor deliberately (Phase-1 ratchets up, methodology §1).
3. **Running-both smoke test** (if §5.4 = integrated dev) — a manual or scripted signup→verify→
   signin→profile→signout round-trip against live `apps/api`, the FE analog of the apps/api
   real-cookie round-trip. Plus **human visual QA** (methodology §1 — the gate assistants can't
   simulate) for the auth screens.

**Recommendation:** floor gates + new per-flow component/service tests (level 2) as the standing
per-commit bar, with a level-3 round-trip at phase close. Surface the test-floor *raise* as a
deliberate Phase-1 ratchet (audit §7.6: "new-feature commits may grow; baseline ratchets up").

---

## §7 — Proposed Phase-1e commit breakdown (for ratification)

Ordering driven by the load-bearing prereqs (§7.A) gating everything else. **This is a proposal to
ratify, not a plan to execute** (CF-22 — surfaced, awaiting architect ruling).

### §7.A — Load-bearing unknowns to resolve BEFORE the first feature commit
These need architect decisions; several gate the ordering:
1. **CORS + cookie/dev model (§5.2/§5.3/§5.4).** Backend CORS is *required*. Same-origin proxy vs
   `SameSite=None`? Integrated dev vs contract-built? → determines whether commit 0 is backend-only
   and whether a Vite proxy lands.
2. **Backend signup-grows scope (§3#1, contract §7.1/§7.2).** The shipped `POST /api/signup` is
   advertiser-only/minimal; Option B requires it to accept the full profile + `tax_number` nullable
   + `profile_type`→role/business_type + `terms_accepted`/`agent_toodooh` columns. **Is the
   signup-grows a Phase-1e *backend* commit, or already-done?** (Audit §15 lists it as a 1e
   carry-forward — i.e. *not yet done*.) The signup repoint can't complete until it lands.
3. **Reference-data GET endpoints (§2.2/§3 gap).** `governorates`, `business_sectors`
   (+`audience=owner`), `company_size_options`, `support_objectives_*` have no read endpoint. Add in
   1e, or scope the forms differently? Gates the signup + profile repoints.
4. **Owner-specific signup data (contract §7.2).** Owner extras (screens/rooms/zone/formule/bank/
   fleet establishments) are **scoped out** of 1c–1g — but the wizard *collects* them. Does the 1e
   signup drop those fields from the owner path, or collect-and-ignore? Affects the wizard repoint.
5. **Session model in `auth.store` (§1.4).** One session+profile endpoint vs cookie + separate
   profile read? Shapes the centralize commit.
6. **Test-floor raise (§6.3).** Ratify the new-test expectation (level 2) so it's a deliberate
   ratchet, not scope creep.

### §7.B — Proposed commits + ordering

| # | Commit | Region | Depends on |
|---|---|---|---|
| **0** | **Backend prereq: `@fastify/cors` + cookie/dev-model config** (CORS for the web origin, credentials; cookie `SameSite` per §5.3 ruling; Vite proxy if same-origin) | apps/api (+ root vite cfg) | §7.A.1 |
| **0b** | **Backend signup-grows** (full profile, `tax_number` nullable, profile_type→role/business_type, terms/agent columns) + **reference-data GETs** | apps/api | §7.A.2/.3/.4 |
| **1** | **API client + auth-service/session centralize** (new `apiClient` w/ `credentials:'include'`, `VITE_API_URL`; rewire `auth.service` core + `auth.store` session model) | apps/web | 0, 0b, §7.A.5 |
| **2** | **Sign-in / sign-out repoint** (consume routing body, 403 verify-first, generic 401) | apps/web | 1 |
| **3** | **Sign-up repoint** (wizard → grown signup; stop enumeration; 12-char; non-privileged profile_type) | apps/web | 1, 0b |
| **4** | **Verify-email + reset pages** (`/auth/verify-email` route + post-verify "please sign in"; reset link consume) | apps/web | 1, 2 |
| **5** | **Profile edits repoint** (split `updateProfile` by section → 4 PATCH endpoints) | apps/web | 1 |
| **6** | **Documents repoint** (storage→`/api/profile/documents/:type` + discriminator) | apps/web | 1 |
| **7** | **Password reset/change repoint** (12-char convergence; drop 6-char guard + owner special-char) | apps/web | 1, 4 |
| **8** | **Account-layer Supabase cleanup sweep** (remove now-dead Supabase calls in in-scope files; `mapAuthError` retarget; the §5.3 owner_business_sectors repoint) — **client stays** (§2.4) | apps/web | 2–7 |
| **9** | **Phase-1e audit refresh** (§16 record; floor deltas; CF instances) | docs | 8 |

**Grouping note.** Commits 0/0b are the backend prereqs (could be one or two). Commit 1 is the
centralize keystone — once it lands, 2–7 are thin per-flow adapters and can be near-parallel.
Commit 8 is the bounded cleanup (not full Supabase removal). The biggest single piece is **commit
3** (the 1940-line wizard) — likely needs its own sub-factoring at plan time.

**Flagged dependency:** commits 0b + the reference GETs are **backend** work landing mid-"frontend
repoint" phase — Phase 1e is not purely frontend. The architect may prefer to front-load all backend
prereqs (0, 0b, ref-GETs) as a Phase-1e Part A before the apps/web Part B.

---

## §8 — Architect rulings (ratified 2026-05-25)

These rulings resolve §5–§7. The survey is descriptive; this section records the resolution so the
doc carries its own decisions (same precedent as `frontend-backend-contract.md` §7).

### §8.1 — Phase split: one label was two phases

The survey revealed the "Phase 1e — frontend repoint" label actually covers two phases with
different work-nature and verification models. Renumbered honestly (boundaries reflect work-nature,
not pre-baked numbers):

- **Phase 1e = BACKEND PREREQUISITES** (`apps/api`, current rhythm, real-integration tests — verifies
  exactly like 1b–1d): CORS/cookie + signup-grows + reference-data GETs + `GET /api/me`. This is §7's
  commits **0 / 0b** plus the ref-GETs and `/api/me`.
- **Phase 1f = FRONTEND REPOINT** (`apps/web`, the new verification model of §6): the survey's §7
  commits **1–9**.
- **Phase 1g = admin**, **Phase 1h = deployment.**

The seam is clean: the frontend phase's new verification model (§6) doesn't contaminate the backend
prereqs, which verify like everything before them. **§7's "Phase 1e" framing is superseded by this
split** — §7's commits 0/0b → Phase 1e; §7's commits 1–9 → Phase 1f. §7 is left intact as the record;
this section is the renumbering authority.

### §8.2 — The six rulings (resolving §7.A)

1. **CORS/cookie/dev (§5.2/§5.3/§5.4) → SAME-ORIGIN PROXY, not `SameSite=None`.** Vite dev proxies
   `/api`→`:4000` so the `Lax` cookie rides same-origin; prod nginx fronts both on one origin (the
   deployment plan anyway — dev mirrors prod). Keeps the strong `Lax` default, no cross-site CSRF
   surface, no forced-Secure-in-dev. Add `@fastify/cors` **minimally** for safety/flexibility, but
   same-origin makes CORS nearly moot. **Dev model = integrated** (both running, proxied).
2. **signup-grows (§7.A.2) → YES, backend, Phase-1e Part A.** The signup endpoint expands to accept
   the full wizard profile; real-integration tested. The 1f signup repoint blocks on it.
3. **Reference-data GETs (§7.A.3) → ADD, Phase-1e Part A.** `governorates` /
   `business_sectors`(+`audience` filter — the Q1 discriminator finally consumed) /
   `company_size_options` / `support_objectives_*`. Decide auth per-endpoint at plan-write (reference
   data may be public or require-auth).
4. **Owner-specific signup data (§7.A.4) → COLLECT-AND-IGNORE.** The frontend keeps the fields; the
   API `.strip()`s them (the established `/api/profile/business` pattern). Do **not** rip fields from
   the 1940-line wizard. Forward-compatible: the owner slice later adds columns, the endpoint stops
   stripping, the wizard already collects.
5. **Store session model (§7.A.5) → COOKIE + SEPARATE PROFILE READ.** Add **`GET /api/me`** (Part A)
   returning routing fields + profile; the store calls it on load/reload to derive identity (the
   cookie carries the session, JS can't read it, so identity comes from `/api/me`). **Confirmed: no
   `/api/me` or session-read route exists today** (only `require-auth.ts`'s internal `getSession`) —
   it is a Part-A addition.
6. **Test-floor raise (§7.A.6) → RATIFIED ratchet.** Phase-1f verification = floor gates (build /
   typecheck-ratchet-down / lint-1 / 160-green) + **new per-flow component/service tests** + a
   **running-both round-trip** + **human visual QA at phase close** (in the definition-of-done —
   honest, since some frontend correctness can't be unit-tested).

### §8.3 — Refinements ratified

- **lint-1 floor STAYS 1 through 1f** — `database.types` clears only at the last slice when
  `supabase.ts` goes, not from the account repoint (§2.4). Expected, not a miss.
- **typecheck 51 drops PARTIALLY in 1f** — account-layer types resolve; campaigns/screens/admin stay
  on Supabase. The floor moves down, not to zero (§2.4). Expected.

### §8.4 — First Part-A commit (architect lean, plan-write pending)

Phase-1e Part A Commit 1 lean: **CORS/cookie + Vite-proxy-compat config + `GET /api/me`** — the
smallest coherent "make the API browser-reachable + identity-readable" unit. signup-grows (§8.2.2)
and reference-data GETs (§8.2.3) follow as their own commits. The plan for Commit 1 is drafted after
this doc commits.

---

## Document status

**Complete and RATIFIED (§8), 2026-05-25.** Establishes: auth is
already centralized (§1, recommend centralize-first); the Supabase surface bounded to 6 account-layer
files for 1e (§2, client stays); 9 flows mapped to shipped endpoints with the signup-grows +
reference-GET gaps (§3); the class-(b) sites located in source (§4); **no FE HTTP client + no apps/api
CORS + `SameSite=Lax` defaults** as the load-bearing prereqs (§5); the test gap (zero account-flow
coverage) + a 3-level verification proposal (§6); and a proposed 10-commit breakdown with 6
load-bearing unknowns to resolve first (§7). Nothing here resolves those unknowns — they are surfaced
for the architect (CF-22).
