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

Four "keep one, drop the other" pairs: `MyCart`/`CartPage`, `Perfor`/`OwnerPerformance`,
`Parcs`/`OwnerLocations`, `admin/AdminDashboard`/`admin/AdminDashboardSimple`. Several page
files are also orphaned (referenced by no `<Route>`, or only inside `Dashboard`):
`MyCart.tsx`, `CartPage.tsx`, `Perfor.tsx`, `Parcs.tsx`, `MyCampaigns.tsx`, `MyInvoices.tsx`,
`MyClients.tsx`, `MyRecharges.tsx`, `UserProfile.tsx` (and `NewCampaign.tsx`, handled by Step 5).
→ **Step 2 · #1**

### Duplicate / wrapper services

`services/campaign.service.ts` (1127 lines) vs `services/campaigns.service.ts` (singular/plural
pair); `services/screens.service.ts` vs `services/api/screens.api.ts` (the `.api.ts`-wrapping-a
`.service.ts` anti-pattern; `services/api/` contains only that one file). Note `events.service.ts`
vs `admin-events.service.ts` is a legit user/admin split, not a duplicate. → **Step 2 · #1**

### DOOH calculation engine coupled to Supabase

The DOOH calculation services (`services/dooh-calculation.service.ts`, `services/dooh-hourly-grid.ts`,
`services/campaign-hourly-location-plan.service.ts`, `services/dooh-location-affluence-engine.ts`)
mix pure math with persistence: `campaign-hourly-location-plan.service.ts` transitively imports
`src/lib/supabase.ts`, which calls `createClient()` at module load — so its test
(`campaign-hourly-location-plan.service.test.ts`) fails just by being imported. This engine is the
project's real IP and the only part of the codebase with tests; it must move cleanly into `apps/api/`
in Phase 1, which a Supabase-coupled engine doesn't. → **Step 4 · #12**

### Auth-state layering

`stores/auth.store.ts` (Zustand, ~20.8 kB) is the one client-state store, but
`services/auth.service.ts` (~1055 lines) is a god-service that owns session logic and writes
`localStorage` directly. The fix: extract session logic from the service back into the store, move
the 66 `localStorage` references across 8 files (`auth.store.ts`, `auth.service.ts`,
`clearAuthCache.ts`, `Onboarding.tsx`, `CartPage.tsx`, `Dashboard.tsx`, `NewCampaign.tsx`,
`ContactPage.tsx`) behind Zustand `persist`, and delete the `clearAuthCache` debug import from
`App.tsx`. (CLAUDE.md's "dual auth stores" phrasing predates this — there is one store + a
god-service, not two stores.) → **Step 3 · #2**

### `console.*`

938 `console.*` calls (917 lint-flagged as `no-console`; the rest are under `src/scripts/`, which
the ESLint config exempts). No frontend logger exists. Includes leftover `console.log('🔍 …')`
debug lines. → **Step 9 · #7**

### `as any` / `@ts-ignore`

44 `as any` occurrences; 0 `@ts-ignore` / `@ts-expect-error`. The full list is produced during the
typing pass, not fixed opportunistically. → **Step 10 · #8**

### `localStorage` outside Zustand `persist`

66 `localStorage.` references across 8 files: `stores/auth.store.ts`, `services/auth.service.ts`,
`utils/clearAuthCache.ts`, `pages/Onboarding.tsx`, `pages/CartPage.tsx`, `pages/Dashboard.tsx`,
`pages/NewCampaign.tsx`, `pages/ContactPage.tsx`. → **Step 3 · #2**

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

`App.tsx` has `import './utils/clearAuthCache'; // Utilitaire de debug`; `utils/clearAuthCache.ts`
itself; scattered emoji debug `console.log`s (cleared as part of Step 9). → **Steps 3 & 9 · #2, #7**

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

| #   | Step                                                                | Touches (roughly)                                                                                                                                                                               | Done when                                                                                                                                                                                                            | Issue | Status |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| 1   | Cleanup audit & roadmap (this doc)                                  | `docs/audit.md`, GitHub issues/milestone                                                                                                                                                        | doc committed; issues created                                                                                                                                                                                        | —     | ☑      |
| 2   | Resolve duplicate pages & services                                  | `pages/*`, `services/*`, `App.tsx`                                                                                                                                                              | one impl per concept (winners chosen, not silent); orphan pages deleted; build OK                                                                                                                                    | #1    | ☐      |
| 3   | Consolidate the auth-state layer                                    | `services/auth.service.ts` (session logic out), `stores/auth.store.ts`, the 8 `localStorage` files, `App.tsx` (drop `clearAuthCache` import)                                                    | single auth-state layer; no raw `localStorage` outside Zustand `persist`; debug import gone                                                                                                                          | #2    | ☐      |
| 4   | Decouple DOOH calculation services from Supabase                    | `services/dooh-calculation.service.ts`, `services/dooh-hourly-grid.ts`, `services/campaign-hourly-location-plan.service.ts`, `services/dooh-location-affluence-engine.ts`; new pure-math module | failing `campaign-hourly-location-plan.service.test.ts` passes; pure functions live in a Supabase-independent module; persistence wrappers stay in service files but become thin; surfaced business rules documented | #12   | ☐      |
| 5   | Decompose `Dashboard.tsx` / `NewCampaign.tsx`                       | `pages/Dashboard.tsx`, `pages/NewCampaign.tsx`, `App.tsx` routes                                                                                                                                | each route renders its own page; largest chunk materially smaller; no regressions                                                                                                                                    | #3    | ☐      |
| 6   | Restructure `src/` into `src/features/<domain>/`                    | almost all of `src/`                                                                                                                                                                            | feature-based layout per conventions; imports updated; build OK                                                                                                                                                      | #4    | ☐      |
| 7   | Replace `window.location.reload()` in `MyAccount.tsx`               | `pages/MyAccount.tsx`                                                                                                                                                                           | 0 `window.location.reload()` calls                                                                                                                                                                                   | #5    | ☐      |
| 8   | Introduce React Query for server state                              | new query layer; (post-decomposition) pages                                                                                                                                                     | server data via React Query; Zustand limited to client state                                                                                                                                                         | #6    | ☐      |
| 9   | Frontend logger + `console.*` purge                                 | new logger; ~917 call sites; ESLint config                                                                                                                                                      | 0 `no-console` errors                                                                                                                                                                                                | #7    | ☐      |
| 10  | Typing pass: fix `as any`, reduce tsc baseline, re-tighten tsconfig | many files; `tsconfig.app.json`                                                                                                                                                                 | typecheck 0 (or documented residue); 0 `as any`; tsconfig un-softened                                                                                                                                                | #8    | ☐      |
| 11  | `jsx-a11y` + `exhaustive-deps` cleanup                              | many `.tsx` files                                                                                                                                                                               | 0 `jsx-a11y/*` errors; 0 `exhaustive-deps` warnings                                                                                                                                                                  | #9    | ☐      |
| 12  | Tailwind `brand` token: replace hardcoded `#00B3A6`                 | `tailwind.config.js`; 449 call sites                                                                                                                                                            | 0 hardcoded `#00B3A6`; `brand` token in use                                                                                                                                                                          | #10   | ☐      |
| 13  | Get CI green                                                        | `.github/workflows/ci.yml`                                                                                                                                                                      | CI green on `main`; no `--no-verify` needed for normal commits                                                                                                                                                       | #11   | ☐      |
| 14  | Hoist duplicate devDependencies to root                             | `apps/web/package.json`, root `package.json`                                                                                                                                                    | `pnpm install` resolves cleanly; no duplicate devDeps across workspaces (`eslint-plugin-react-refresh` removed if unused)                                                                                            | #13   | ☐      |

---

## 6. Maintenance

When a roadmap step lands:

1. Tick its box in the Roadmap table (`☐` → `☑`) and add the merge commit.
2. Close its GitHub issue (link the commit / PR).
3. Move its anti-pattern subsection's findings into **§4 Already resolved** (or trim them).
4. Refresh the **§2 Snapshot** numbers.

The milestone is **Frontend cleanup phase**; all step issues carry the `cleanup` label plus an
`area:*` label.
