# TOODOOH Frontend — Cleanup Audit & Roadmap

This document is the source of truth for the **frontend cleanup phase** backlog: what's wrong
with the imported `apps/web` codebase, where, and in what order we fix it. Each anti-pattern
points at the roadmap step (and GitHub issue) that owns it. As steps land, tick the box in the
Roadmap table, close the issue, and refresh the Snapshot.

See `CLAUDE.md` for the phase scope and engineering rules. The original hand-written roadmap
this is reconciled against lives in `docs/handoff/03-cleanup-roadmap.md` (its step numbering
differs — this document's numbering is authoritative).

---

## 1. Context & scope

TOODOOH is a Tunisian DOOH advertising marketplace being migrated from a fragile single-package
Supabase frontend to a self-hosted Node.js + Postgres + nginx stack. **This phase** cleans up the
existing frontend (now at `apps/web`) so the backend-migration and auth-rewrite phases have a sound
base. **Out of scope this phase:** backend, replacing Supabase, UI redesign, the TV/APK side, and
infra/hosting.

---

## 2. Snapshot

_As of commit `c971e90` (post-mechanical-cleanup pass)._

| Metric                             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files under `apps/web/src/`        | 229 (127 `.ts`/`.tsx`)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Lines of `.ts`/`.tsx`              | ~57,000                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Files > 1000 lines                 | 15 (`NewCampaign.tsx` 4359, `Dashboard.tsx` 2635, `auth/SignUpForm.tsx` 1954, `OwnerSettings.tsx` 1845, `MyCampaigns.tsx` 1748, `admin/UserManagement.tsx` 1485, `UserProfile.tsx` 1394, `admin/EventManagement.tsx` 1247, `OwnerCampaigns.tsx` 1235, `Onboarding.tsx` 1228, `OwnerDashboard.tsx` 1209, `services/campaign.service.ts` 1127, `OwnerScreens.tsx` 1100, `services/auth.service.ts` 1055, `admin/CampaignMonitoring.tsx` 1006) |
| Files > 500 lines                  | 40                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm typecheck`                   | **182 errors** (was 310 before unused-import removal)                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm lint`                        | **~1629 errors / 27 warnings** — top rules: `no-console` 917, `@typescript-eslint/no-explicit-any` 285, `jsx-a11y/*` ~287, `@typescript-eslint/no-unused-vars` 104, `import-x/order` 29, `react-hooks/exhaustive-deps` 27 (warn)                                                                                                                                                                                                            |
| `pnpm test`                        | 3 suites pass (22 tests); 1 pre-existing import-time failure (`campaign-hourly-location-plan.service.test.ts` — `src/lib/supabase.ts` calls `createClient()` at module load; fixed by Step 4)                                                                                                                                                                                                                                               |
| `pnpm --filter @toodooh/web build` | passes — 110 chunks, main entry ~434 kB (largest chunk `Dashboard` ~622 kB)                                                                                                                                                                                                                                                                                                                                                                 |
| CI (`main`)                        | **red** — expected; goes green at Step 13                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 3. Anti-pattern inventory

### God-component `Dashboard.tsx`

`pages/Dashboard.tsx` (2635 lines) is the element for **12 routes** (`/dashboard`, `/profile`,
`/new-campaign`, `/my-campaigns`, `/parcs`, `/evenements`, `/perfor`, `/new-event-campaign`,
`/my-recharges`, `/my-invoices`, `/my-clients`, `/my-cart`) and switches internally on
`useLocation()`. It transitively bundles `pages/NewCampaign.tsx` (4359 lines), producing the
~622 kB `Dashboard` chunk. The other 14 files over 1000 lines are listed in the Snapshot.
→ **Step 5 · #3**

### Duplicate pages

**Deleted in Step 2a** (zero imports, zero string references anywhere in `src/` — genuinely dead):

- `pages/MyCart.tsx` (261 lines) — the live cart page is `pages/CartPage.tsx` (used by `Dashboard.tsx`);
  `MyCart.tsx` is an unreferenced earlier copy.
- `pages/admin/AdminDashboardSimple.tsx` (73 lines) — the live admin dashboard is
  `pages/admin/AdminDashboard.tsx` (the `/admin-dashboard` route); `AdminDashboardSimple.tsx` is an
  unreferenced stub.

**Open questions deferred to Step 5** (can't be resolved until `Dashboard.tsx` is decomposed — see
"God-component `Dashboard.tsx`"):

- `Perfor.tsx` (576 lines, advertiser-side perf page, imported only by `Dashboard.tsx`) and
  `OwnerPerformance.tsx` (929 lines, owner-side perf page, live `/owner-performance` route) — both are
  recharts perf dashboards; Step 5 must determine whether `Perfor` is a fork of `OwnerPerformance` to
  unify, or a legitimately separate advertiser page.
- `Parcs.tsx` (106 lines, hardcoded Carrefour mock data; the file comment says it duplicates a
  `Dashboard` widget; imported only by `Dashboard.tsx`) and `OwnerLocations.tsx` (458 lines, live
  `/owner-locations` route) — Step 5 must determine whether `Parcs` is dead demo code to delete, or a
  placeholder for advertiser-side location functionality that should be reimplemented (likely by reusing
  `OwnerLocations` components).

**Dashboard-coupled page files** — imported only by `Dashboard.tsx`, which switches on `useLocation()`
to render them for its 12 routes: `CartPage.tsx`, `MyCampaigns.tsx`, `MyInvoices.tsx`, `MyClients.tsx`,
`MyRecharges.tsx`, `UserProfile.tsx`, `Events.tsx`, `Onboarding.tsx` (plus `NewCampaign.tsx`). Untangled
in Step 5 when `Dashboard.tsx` is decomposed, not here.

→ **Step 2a · #1** (the two deletions) · **Step 5 · #3** (everything else above)

### Duplicate / wrapper services

**Deleted in Step 2b** (zero imports, zero string references anywhere in `src/` — genuinely dead):

- `services/campaigns.service.ts` (153 lines) — an early, abandoned generic-CRUD draft of a campaign
  service (`create`/`getAll`/`update`/…) with its own interface set; the codebase uses the
  domain-method `campaignService` in `services/campaign.service.ts` instead. Nothing imported the
  plural one.
- `services/api/screens.api.ts` (363 lines) and the now-empty `services/api/` directory — a thin
  wrapper that re-exposed `screensService` (from `services/screens.service.ts`) behind an
  `ApiResponse<T>` envelope, with no callers; every consumer imports `screensService` directly.

**Campaign-services family** (not a dedup — folder placement only): with `campaigns.service.ts` gone,
"the campaign service" is still a ~5-file cluster — `campaign.service.ts` (1127 lines, canonical; used
by `NewCampaign`/`MyCampaigns`/`CartPage`/`Dashboard`), `campaign-screens.service.ts`,
`campaign-owner-approval.service.ts`, `campaign-hourly-location-plan.service.ts`,
`dooh-new-campaign-estimate.service.ts`. These are domain-specific, not duplicates; their grouping is a
Step 5/Step 6 concern (the campaign-creation ones surface their home during the `NewCampaign`
decomposition; the folder restructure puts them under `features/campaigns/`).

**Admin-services cluster — not a duplicate; observation moved to Step 6.** Step 2b discovery found the
cluster already cleanly factored: 7 files — `admin.service.ts` (admin auth + admin CRUD + dashboard
stats) plus `admin-campaign-monitoring`, `admin-events`, `admin-recharges`, `admin-screens`,
`admin-user`, `admin-video` (`.service.ts`) — with **no cross-imports** and **no method-name
collisions**; each `admin-*.service.ts` is imported by exactly one admin page. The handoff's
"consolidate into an admin module" meant _folder placement_, not merge logic — Step 6 moves them under
`features/admin/`; there is nothing to dedup. (Step 6 should also confirm the
`admin-screens.service.ts` ↔ `screens.service.ts` boundary: they share names like
`getScreens`/`createScreen` but operate on admin vs owner views — looks like a legit split, same
pattern as events.)

**Legit split — confirmed.** `events.service.ts` (advertiser, read-only: `getAllEvents`,
`getFeaturedEvents`, `getMyEventCampaignLinks`, `getMyEventCampaignsEvents`) vs
`admin-events.service.ts` (admin, full CRUD + `linkEventToCampaign`/`toggleFeatured`/`getStats`/…).
Step 2b discovery confirmed they're genuinely separate — only the read `getFeaturedEvents` is shared by
name. Both stay; Step 6 places `events.service.ts` under `features/campaigns/`, `admin-events.service.ts`
under `features/admin/`.

→ **Step 2b · #14** (deletions) · **Step 6 · #4** (admin-cluster and campaign-services cluster folder placement)

### DOOH calculation engine coupled to Supabase

The DOOH calculation services (`services/dooh-calculation.service.ts`, `services/dooh-hourly-grid.ts`,
`services/campaign-hourly-location-plan.service.ts`, `services/dooh-location-affluence-engine.ts`)
mix pure math with persistence: `campaign-hourly-location-plan.service.ts` transitively imports
`src/lib/supabase.ts`, which calls `createClient()` at module load — so its test
(`campaign-hourly-location-plan.service.test.ts`) fails just by being imported. This engine is the
project's real IP and the only part of the codebase with tests; it must move cleanly into `apps/api/`
in Phase 1, which a Supabase-coupled engine doesn't.

Scope expansion: the current `dooh-*.ts` code implements an older pricing model. The v3.0 model (see
`docs/handoff/pricing-model-v3.md` + `docs/handoff/Toodooh_Simulateur_Pricing_v3.html`) is the
target behavior. Step 4 decouples the engine from Supabase **and** migrates the math to v3.0 — the
simulator HTML is the authoritative behavioral reference. → **Step 4 · #12**

### Auth-state layering

**Done in Step 3:** `stores/auth.store.ts` now uses Zustand `persist` (`name: 'toodooh-auth'`,
`partialize`: `profileType` / `validationStatus` / `contactName` / `onboardingCompleted`) — that
persisted state _is_ the profile cache; the hand-rolled `localStorage` is gone from `auth.store.ts`.
`services/auth.service.ts` is stateless (no `localStorage`; `login()` is back to a thin
`signInWithPassword`). Admin-detection in `fetchProfileType` reads `useAdminStore.getState().admin`
instead of parsing `admin-storage` JSON. The `onAuthStateChange` subscription is captured (re-entry
guard `authListenerInitialized || authSubscription`). `utils/clearAuthCache.ts` deleted (+ its
`App.tsx` side-effect import). `ContactPage.tsx` reads `contactName` from the store. No migration —
returning users do one extra `business_profiles` fetch on first post-deploy load (`fetchProfileType`
handles a cold cache); the old loose keys (`user_profile_type`, `user_raison_social`,
`user_validation_status`, `onboardingCompleted`, `justOnboarded`) are inert orphans until
`Dashboard.tsx` / `Onboarding.tsx` stop writing them. _(Smoke-test gap: the "hard-reload while logged
in stays logged in, no flash" persist-rehydration check was not run — no Supabase creds in the dev
env; shipped on the regression gates + diff review.)_

**Correction to the handoff framing:** "extract session logic from `auth.service.ts` into
`auth.store.ts`" was inaccurate — the store already owned session orchestration (`initialize` /
`login` / `logout` / `refreshUserStatus` / the `onAuthStateChange` listener / `fetchProfileType`).
The real fix was the `persist` middleware + de-`localStorage`-ing the service. `auth.service.ts`
remains a Supabase-auth wrapper + `business_profiles` / signup CRUD + the ~165-line `mapAuthError`;
an eventual `auth.service.ts` / `business-profile.service.ts` split is a Step 6 concern.

**Deferred to Step 5** (Dashboard-coupled — these read/write the same auth-cache keys, but the
refactor has to happen as part of decomposing those files): the `localStorage` call sites in
`Dashboard.tsx` (~16 — `onboardingCompleted`, `user_profile_type`, `user_raison_social`,
`justOnboarded`, `campaign_cart_items`) and `Onboarding.tsx` (3 — `onboardingCompleted`).

**Parallel anti-pattern:** a Zustand store exists (`stores/cart.store.ts`), but the cart state is
also hand-rolled in `localStorage` (`campaign_cart_items` in `CartPage.tsx` / `Dashboard.tsx` /
`NewCampaign.tsx`, all Dashboard-coupled) — the same shape `auth.store.ts` had before Step 3.
Deferred to Step 5 with the rest.

→ **Step 3 · #2** (done) · **Step 5 · #3** (the `Dashboard` / `Onboarding` `localStorage` sites + the `cart.store.ts` parallel)

### `console.*`

938 `console.*` calls (917 lint-flagged as `no-console`; the rest are under `src/scripts/`, which
the ESLint config exempts). No frontend logger exists. Includes leftover `console.log('🔍 …')`
debug lines. → **Step 9 · #7**

### `as any` / `@ts-ignore`

44 `as any` occurrences; 0 `@ts-ignore` / `@ts-expect-error`. The full list is produced during the
typing pass, not fixed opportunistically. → **Step 10 · #8**

### `localStorage` outside Zustand `persist`

Step 3 moved the auth/profile cache (`user_profile_type` / `user_raison_social` /
`user_validation_status` / `onboardingCompleted`) into `auth.store.ts`'s `persist` and removed the
hand-rolled `localStorage` from `auth.store.ts` / `auth.service.ts` / `ContactPage.tsx`. The remaining
direct `localStorage` use is in `Dashboard.tsx` / `Onboarding.tsx` / `NewCampaign.tsx` / `CartPage.tsx`
(the auth-cache subset + the `campaign_cart_items` cart subset) — Dashboard-coupled; both are
addressed when those files are decomposed. See "Auth-state layering" above. → **Step 5 · #3**

### `window.location.reload()`

2 calls, both in `pages/MyAccount.tsx` (the `if (shouldLeave) reload(); else reload();` block).
→ **Step 7 · #5**

### Hardcoded `#00B3A6`

449 occurrences of the brand hex; should be a Tailwind `brand` theme token. → **Step 12 · #10**

### `jsx-a11y` / `react-hooks/exhaustive-deps`

~287 `jsx-a11y/*` errors (`label-has-associated-control` ~230, `click-events-have-key-events` ~26,
`no-static-element-interactions` ~23, plus `media-has-caption`, etc.); 27
`react-hooks/exhaustive-deps` warnings (latent stale-closure risks). → **Step 11 · #9**

### Flat folder structure

`src/` is flat `pages/` + `components/` + `services/` + `stores/`, not the feature-based
`src/features/<domain>/` the architecture conventions call for. → **Step 6 · #4**

### No server-state layer

TanStack Query is not used; data fetching is hand-rolled (call a service in a component, `setState`).
Conventions want React Query for server state and Zustand for client state, no mixing. → **Step 8 · #6**

### Debug cruft

`utils/clearAuthCache.ts` (and its `App.tsx` side-effect import) was deleted in Step 3 — see
"Auth-state layering" above / §4. What remains: the scattered emoji `console.log`s (🔄 ✅ ⚠️ ❌ 📊 …),
heaviest in `services/auth.service.ts` (~70) and `stores/auth.store.ts` (~45) — cleaned in the
console-purge pass. → **Step 9 · #7**

### `tsconfig` softening

`apps/web/tsconfig.app.json` extends `tsconfig.base.json` but re-disables `verbatimModuleSyntax`,
`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature` (with a tracking comment) — to be
re-enabled after the structural refactor. → **Step 10 · #8**

### Duplicate devDependencies

`apps/web/package.json` carries devDeps that duplicate root-level ones (`eslint`, `@eslint/js`,
`eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, `typescript-eslint`,
`typescript`); `eslint-plugin-react-refresh` is unused (root ESLint config doesn't load it).
→ **Step 14 · #13**

### Not an issue here (noted for completeness)

`src/services/auth.service.ts.backup` and the source repo's `debug-*.js` / `test-*.js` / `*.zip`
were excluded during import — not present in this repo. The marketing landing-page source and the
OVH hosting snapshot belong to the later infra phase, not here.

---

## 4. Already resolved

- **`react-hooks/rules-of-hooks`** — 0 (was 20, all in `admin/CampaignMonitoring.tsx`; commit `bc63fb1`).
- **`itstrategix.tn` redirect** — removed; auth email redirects are now env-driven via `lib/app-url.ts` / `VITE_PUBLIC_APP_URL` (commit `854f112`).
- **Eager bundle / no code-splitting** — every route is `React.lazy()`; main bundle 3.25 MB → ~434 kB (commits `95df8a1`, `d80ef19`, `290024a`).
- **Formatting & import hygiene** — one-time Prettier + ESLint `import-x/order`/`prefer-const` autofix + unused-import removal (`eslint-plugin-unused-imports`) (commits `82e8f66`, `c8b5f17`, `39536c1`; recorded in `.git-blame-ignore-revs`).

---

## 5. Roadmap

Ordering principle: **decisions & deletions first** (shrink the surface) → **isolate the real IP**
(the DOOH engine) → **structure** (so later mechanical passes run once on the final shape) →
**mechanical sweeps last** (console / typing / a11y / styling / tsconfig) → **tidy-up at the end**.
Each step gets its own brainstorm → spec → plan → execute cycle.

| #   | Step                                                                                            | Touches (roughly)                                                                                                                                                                                                                                | Done when                                                                                                                                                                                                                                                                                              | Issue | Status |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------ |
| 1   | Cleanup audit & roadmap (this doc)                                                              | `docs/audit.md`, GitHub issues/milestone                                                                                                                                                                                                         | doc committed; issues created                                                                                                                                                                                                                                                                          | —     | ☑      |
| 2a  | Resolve duplicate pages and delete orphans                                                      | `pages/MyCart.tsx`, `pages/admin/AdminDashboardSimple.tsx` (deletions)                                                                                                                                                                           | the two genuinely-dead files deleted (zero refs); typecheck/lint/test/build not regressed; the rest of §3's duplicate-page list is Dashboard-coupled → resolved in Step 5                                                                                                                              | #1    | ☑      |
| 2b  | Resolve duplicate services                                                                      | `services/campaigns.service.ts`, `services/api/screens.api.ts`, `services/api/` (deletions)                                                                                                                                                      | the two dead service files deleted (zero refs); `services/api/` dir removed; typecheck/lint/test/build not regressed; admin-cluster consolidation moved to Step 6 notes                                                                                                                                | #14   | ☑      |
| 3   | Consolidate the auth-state layer                                                                | `stores/auth.store.ts` (persist + de-localStorage), `services/auth.service.ts` (stateless), `App.tsx` (drop `clearAuthCache` import), `pages/ContactPage.tsx`, delete `utils/clearAuthCache.ts`                                                  | `auth.store.ts` uses `persist`; no `localStorage` in `auth.store.ts`/`auth.service.ts`; `clearAuthCache.ts` deleted; `onAuthStateChange` subscription captured; `ContactPage` on the store; `Dashboard`+`Onboarding`+cart `localStorage` deferred to Step 5; typecheck/lint/test/build not regressed   | #2    | ☑      |
| 4   | Decouple DOOH calculation services from Supabase (+ migrate the math to the v3.0 pricing model) | `services/dooh-calculation.service.ts`, `services/dooh-hourly-grid.ts`, `services/campaign-hourly-location-plan.service.ts`, `services/dooh-location-affluence-engine.ts`; new pure-math module; v3.0 spec in `docs/handoff/pricing-model-v3.md` | failing `campaign-hourly-location-plan.service.test.ts` passes; pure functions live in a Supabase-independent module implementing the v3.0 model (output matches `Toodooh_Simulateur_Pricing_v3.html`); persistence wrappers stay in service files but become thin; surfaced business rules documented | #12   | ☐      |
| 5   | Decompose `Dashboard.tsx` / `NewCampaign.tsx`                                                   | `pages/Dashboard.tsx`, `pages/NewCampaign.tsx`, `App.tsx` routes                                                                                                                                                                                 | each route renders its own page; largest chunk materially smaller; no regressions                                                                                                                                                                                                                      | #3    | ☐      |
| 6   | Restructure `src/` into `src/features/<domain>/`                                                | almost all of `src/`                                                                                                                                                                                                                             | feature-based layout per conventions; imports updated; build OK                                                                                                                                                                                                                                        | #4    | ☐      |
| 7   | Replace `window.location.reload()` in `MyAccount.tsx`                                           | `pages/MyAccount.tsx`                                                                                                                                                                                                                            | 0 `window.location.reload()` calls                                                                                                                                                                                                                                                                     | #5    | ☐      |
| 8   | Introduce React Query for server state                                                          | new query layer; (post-decomposition) pages                                                                                                                                                                                                      | server data via React Query; Zustand limited to client state                                                                                                                                                                                                                                           | #6    | ☐      |
| 9   | Frontend logger + `console.*` purge                                                             | new logger; ~917 call sites; ESLint config                                                                                                                                                                                                       | 0 `no-console` errors                                                                                                                                                                                                                                                                                  | #7    | ☐      |
| 10  | Typing pass: fix `as any`, reduce tsc baseline, re-tighten tsconfig                             | many files; `tsconfig.app.json`                                                                                                                                                                                                                  | typecheck 0 (or documented residue); 0 `as any`; tsconfig un-softened                                                                                                                                                                                                                                  | #8    | ☐      |
| 11  | `jsx-a11y` + `exhaustive-deps` cleanup                                                          | many `.tsx` files                                                                                                                                                                                                                                | 0 `jsx-a11y/*` errors; 0 `exhaustive-deps` warnings                                                                                                                                                                                                                                                    | #9    | ☐      |
| 12  | Tailwind `brand` token: replace hardcoded `#00B3A6`                                             | `tailwind.config.js`; 449 call sites                                                                                                                                                                                                             | 0 hardcoded `#00B3A6`; `brand` token in use                                                                                                                                                                                                                                                            | #10   | ☐      |
| 13  | Get CI green                                                                                    | `.github/workflows/ci.yml`                                                                                                                                                                                                                       | CI green on `main`; no `--no-verify` needed for normal commits                                                                                                                                                                                                                                         | #11   | ☐      |
| 14  | Hoist duplicate devDependencies to root                                                         | `apps/web/package.json`, root `package.json`                                                                                                                                                                                                     | `pnpm install` resolves cleanly; no duplicate devDeps across workspaces (`eslint-plugin-react-refresh` removed if unused)                                                                                                                                                                              | #13   | ☐      |

---

## 6. Maintenance

When a roadmap step lands:

1. Tick its box in the Roadmap table (`☐` → `☑`) and add the merge commit.
2. Close its GitHub issue (link the commit / PR).
3. Move its anti-pattern subsection's findings into **§4 Already resolved** (or trim them).
4. Refresh the **§2 Snapshot** numbers.

The milestone is **Frontend cleanup phase**; all step issues carry the `cleanup` label plus an
`area:*` label.
