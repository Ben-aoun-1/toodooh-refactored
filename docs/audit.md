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

**Companion reference docs (the triad).** `docs/user-flows.md` describes how each user type
(advertiser / screenhost / admin) flows through the app **today** — current behavior, route → page
mapping, where the code surprises you. `docs/figma-vs-code.md` maps the current frontend against the
**Figma design** — which screens exist on each side, structural divergences (e.g. one Figma hub split
across several code routes), designed-but-not-built and built-but-not-designed gaps, open questions
for the CEO/CTO. This audit tracks **technical debt and the code-cleanup backlog**. The three are
complementary and orthogonal — none subsumes the others; each should cross-reference the other two.

---

## 2. Snapshot

_As of commit `3db8aec` (post-Step-14, **cleanup phase complete**; code metrics unchanged since Step-12 `40d65c4` — Steps 13–14 are infrastructure-only). CI **green** on `main`. devDependencies: `apps/web` carries 11 (Step 14 hoisted 6 duplicates to root, removed 1 dead); root carries 14._

| Metric                             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files under `apps/web/src/`        | **236 `.ts`/`.tsx`** — unchanged across Steps 11–12 (both edited files, added none under `src/`; Step 12 used inline `sed`, preserved no codemod script — `apps/web/scripts/` holds 3: path-alias + label-htmlFor + unwrap-useless-try). TBD-C left 157; Step 10 added 79 — the `QueryClient` setup, ~50 `useQuery`/`useMutation` hook files across 8 features, per-feature `queryKeys` factories + their tests, extracted pure-fn transforms + tests, and the shared `lib/notification-feed.ts`. The prior audit "~245" counted the 101 PNG assets — the actual code surface is 236.                                                                                                                                                                                                           |
| Lines of `.ts`/`.tsx`              | net up — Step 10 added the hook layer and removed hand-rolled `useEffect`+`setState` fetch blocks; most migrated pages shrank, the new hook files are the offsetting addition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Files > 1000 lines                 | unchanged from post-Step-7 (Step 10 added small hook files, decomposed nothing). Largest still: `features/auth/components/SignUpForm.tsx` 1940 (→ TBD-D), `features/screenhost/pages/OwnerSettings.tsx` 1845, `features/campaigns/pages/MyCampaigns.tsx` ~1640, `features/campaigns/pages/NewCampaign.tsx` ~1600, `features/admin/pages/UserManagement.tsx` 1466, `features/advertiser/pages/UserProfile.tsx` 1420, …                                                                                                                                                                                                                                                                                                                                                                           |
| Files > 500 lines                  | ~38 (broadly unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm typecheck`                   | **51 errors** (held flat across every Step 10/11/12 commit — Steps 11–12 touch no Cat-A untyped-root cascade). All remaining are Cat-A pre-existing untyped-root cascades tracked in #15 for Phase 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm lint`                        | **1 problem (1 error, 0 warnings)** — Step 11 cleared 345 (`346 → 1`): 282 `jsx-a11y/*` errors, 71 `no-useless-catch`, 3 `@typescript-eslint/no-unused-expressions`, 7 `react-hooks/exhaustive-deps` warnings (Step-11 trajectory `346 → 136 → 130 → 82 → 8 → 1`). The single remaining error is `import-x/no-unresolved` (`src/lib/supabase.ts` → `./database.types`), a Phase-1 typed-client prerequisite tracked in #15 — _not_ a frontend-cleanup concern. Flat at 1 across Step 12 (a brand-token swap moves no lint rule). `import-x/order` 0. **`no-console`: 0** ✓ · **`@typescript-eslint/no-explicit-any`: 0** ✓ · **`@typescript-eslint/no-unused-vars`: 0** ✓ · **`no-empty`: 0** ✓ · **`jsx-a11y/*`: 0** ✓ · **`react-hooks/exhaustive-deps`: 0** ✓ · **`no-useless-catch`: 0** ✓. |
| `pnpm test`                        | 21 suites pass; **160 tests**; 0 failures (flat across Steps 11–12 — neither adds tests; the 98 → 160 growth was Step 10's query-key factory tests, extracted pure-fn transform tests, and the `markFeedRead` optimistic-rollback contract test)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm --filter @toodooh/web build` | passes — main `index-*.js` gzip **139.80 kB** (139.58 → 139.80 across Step 12; +0.22 kB — a brand-token swap is byte-near-flat, the drift is class-string length + JIT noise). The 131.47 → 139.60 jump was Step 10's one-time `@tanstack/react-query` runtime; `@tanstack/react-query-devtools` is dev-only, 0 prod bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CI (`main`)                        | **green** ✅ — Step 13 (`d7e52ff`). The `.github/workflows/ci.yml` `verify` job runs all four gates on every push to `main` and every PR: typecheck + lint are **baseline-gated** (fail only on regression past `TYPECHECK_BASELINE=51` / `LINT_BASELINE=1`, both annotated for #15), test and build run plain. `tsc` still emits the 51 Cat-A errors as GitHub annotations — informational, the run is green because the baseline-gate exits 0; they clear when #15 lands.                                                                                                                                                                                                                                                                                                                     |

---

## 3. Anti-pattern inventory

### God-component `Dashboard.tsx`

`pages/Dashboard.tsx` (2635 lines) is the element for **12 routes** (`/dashboard`, `/profile`,
`/new-campaign`, `/my-campaigns`, `/parcs`, `/evenements`, `/perfor`, `/new-event-campaign`,
`/my-recharges`, `/my-invoices`, `/my-clients`, `/my-cart`) and switches internally on
`useLocation()`. It transitively bundles `pages/NewCampaign.tsx` (4359 lines), producing the
~622 kB `Dashboard` chunk. The other 14 files over 1000 lines are listed in the Snapshot.
→ **Step 7 · #3** ☑

### Duplicate pages

**Deleted in Step 2a** (zero imports, zero string references anywhere in `src/` — genuinely dead):

- `pages/MyCart.tsx` (261 lines) — the live cart page is `pages/CartPage.tsx` (used by `Dashboard.tsx`);
  `MyCart.tsx` is an unreferenced earlier copy.
- `pages/admin/AdminDashboardSimple.tsx` (73 lines) — the live admin dashboard is
  `pages/admin/AdminDashboard.tsx` (the `/admin-dashboard` route); `AdminDashboardSimple.tsx` is an
  unreferenced stub.

**Open questions deferred to Step 7** (can't be resolved until `Dashboard.tsx` is decomposed — see
"God-component `Dashboard.tsx`"):

- `Perfor.tsx` (576 lines, advertiser-side perf page, imported only by `Dashboard.tsx`) and
  `OwnerPerformance.tsx` (929 lines, owner-side perf page, live `/owner-performance` route) — both are
  recharts perf dashboards; Step 7 must determine whether `Perfor` is a fork of `OwnerPerformance` to
  unify, or a legitimately separate advertiser page.
- `Parcs.tsx` (106 lines, hardcoded Carrefour mock data; the file comment says it duplicates a
  `Dashboard` widget; imported only by `Dashboard.tsx`) and `OwnerLocations.tsx` (458 lines, live
  `/owner-locations` route) — Step 7 must determine whether `Parcs` is dead demo code to delete, or a
  placeholder for advertiser-side location functionality that should be reimplemented (likely by reusing
  `OwnerLocations` components).

**Step 7 disposition (resolved with CTO, 2026-05-14):**

- `Perfor.tsx` — deletion stands (implementation was bad), but the **page itself is in scope** per
  Figma `Performances.png`. Sidebar entry "Mes performances" restored pointing at `/perfor`, with a
  placeholder route (`pages/AdvertiserPerformancePlaceholder.tsx`) until the full rebuild lands. Full
  rebuild tracked in **#19**.
- `Parcs.tsx` — sidebar entry disposition (campaign-targeting mode entry point vs standalone listing
  page) is **deferred** pending product decision. Current state (entry removed in Step 7 Commit 3
  `843498d`) is the working assumption until resolved. Revisit when picking up the next round of
  routing work.

**Dashboard-coupled page files** — imported only by `Dashboard.tsx`, which switches on `useLocation()`
to render them for its 12 routes: `CartPage.tsx`, `MyCampaigns.tsx`, `MyInvoices.tsx`, `MyClients.tsx`,
`MyRecharges.tsx`, `UserProfile.tsx`, `Events.tsx`, `Onboarding.tsx` (plus `NewCampaign.tsx`). Untangled
in Step 7 when `Dashboard.tsx` is decomposed, not here.

**Design-vs-code structural splits** (surfaced by `docs/figma-vs-code.md`) — the code splits a single
Figma surface into multiple routes in three places: "Mes Finances" (one Figma hub) → `/my-recharges` +
`/my-invoices`; "Mes Revenus" (one Figma frame, with the statement document) → `/owner-revenue` +
`/owner-statements` + `/owner-statements/:id`; "Mes campagnes" (one Figma campaigns surface) →
`/owner-campaigns` + `/owner-campaign-approvals`. None of these splits is necessarily wrong, but each is
a consolidation decision to confirm when the page structure is reworked — Step 7 (`/owner-campaigns` vs
`/owner-campaign-approvals` overlaps the perf/profile-duplication questions above) and Step 8 (folder/route
restructure).

→ **Step 2a · #1** (the two deletions) · **Step 7 · #3** (everything else above) · **Step 8 · #4** (route consolidation)

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
Step 7/Step 8 concern (the campaign-creation ones surface their home during the `NewCampaign`
decomposition; the folder restructure puts them under `features/campaigns/`).

**Admin-services cluster — not a duplicate; observation moved to Step 8.** Step 2b discovery found the
cluster already cleanly factored: 7 files — `admin.service.ts` (admin auth + admin CRUD + dashboard
stats) plus `admin-campaign-monitoring`, `admin-events`, `admin-recharges`, `admin-screens`,
`admin-user`, `admin-video` (`.service.ts`) — with **no cross-imports** and **no method-name
collisions**; each `admin-*.service.ts` is imported by exactly one admin page. The handoff's
"consolidate into an admin module" meant _folder placement_, not merge logic — Step 8 moves them under
`features/admin/`; there is nothing to dedup. (Step 8 should also confirm the
`admin-screens.service.ts` ↔ `screens.service.ts` boundary: they share names like
`getScreens`/`createScreen` but operate on admin vs owner views — looks like a legit split, same
pattern as events.)

**Legit split — confirmed.** `events.service.ts` (advertiser, read-only: `getAllEvents`,
`getFeaturedEvents`, `getMyEventCampaignLinks`, `getMyEventCampaignsEvents`) vs
`admin-events.service.ts` (admin, full CRUD + `linkEventToCampaign`/`toggleFeatured`/`getStats`/…).
Step 2b discovery confirmed they're genuinely separate — only the read `getFeaturedEvents` is shared by
name. Both stay; Step 8 places `events.service.ts` under `features/campaigns/`, `admin-events.service.ts`
under `features/admin/`.

→ **Step 2b · #14** (deletions) · **Step 8 · #4** (admin-cluster and campaign-services cluster folder placement)

### DOOH calculation engine coupled to Supabase

The DOOH calculation services (`services/dooh-calculation.service.ts`, `services/dooh-hourly-grid.ts`,
`services/campaign-hourly-location-plan.service.ts`, `services/dooh-location-affluence-engine.ts`,
`services/dooh-new-campaign-estimate.service.ts`) carry the engine. `lib/supabase.ts` calls
`createClient()` at module load, so any file importing it (even transitively) constructs the client at
import time — which broke `campaign-hourly-location-plan.service.test.ts`.

**Step 4 (this phase) — done in two parts.** _(4a)_ The genuinely-pure pieces moved into a new
Supabase-free folder `apps/web/src/lib/dooh/`: the config type/defaults (`config.ts`), the calendar
helpers (`dates.ts`), and the budget→repetitions allocator `buildHybridAdjustedHourlyPlan`
(`hourly-plan.ts`). The service files re-export the moved symbols and keep only the thin Supabase
wrappers; the failing test now passes because the math is reachable without the client. _(4b)_ The
**v3.0 pricing model** was written as a new, fully-tested, **unwired** pure module
`lib/dooh/v3-model.ts` (R with credibility/frequency ceilings, SPS, per-screenhost campaign math,
cascade, 50/44/3/3 revenue split, events, mixed cart), with `lib/dooh/README.md` documenting the
model and the function↔simulator mapping. The v3.0 spec lives in `docs/handoff/pricing-model-v3.md`
and the simulator `docs/handoff/Toodooh_Simulateur_Pricing_v3.html`.

**Step 4c — Phase 1, not this phase.** Wiring v3.0 into the wizard/cart/screenhost flows, deleting
the legacy locality engine, and the **schema changes v3.0 needs** (per-screenhost operating hours,
regular/historical affluence, sold-slot counts, event eligibility, and the six SPS criteria — none of
which exist today; see `docs/handoff/v3-data-requirements.md`) belong to the backend phase. The
current `dooh-*.ts` math implements an older model and stays live until then.

**Phase-1 v3.0 wiring flag surfaced during Step 4:**

- v3.0 wiring (Phase 1) must enforce budget ≤ available wallet balance at wizard input AND cart
  confirmation, not just at launch. Available balance = wallet − Σ other-cart-lines. See
  `docs/handoff/v3-data-requirements.md` "Wiring constraints" section.

Two latent issues in the _legacy_ engine, surfaced during Step 4 and left for Phase 1:

- **Two competing impression models coexist** — the "slot model" (`computeDoohSlotMetrics`:
  `reps × affluence`, capped at `max_spots_per_hour × rate`) and the "affluence-only model"
  (`computeDoohLocationAffluenceCampaign`: `affluence × max_billable_spot_rate_per_hour`).
  `dooh-new-campaign-estimate.service.ts` and `campaign.service.ts` layer one on the other, so the
  wizard's impressions ceiling and the published `campaign_hourly_location_plan` can disagree.
- **`NewCampaign.tsx` carries a parallel, fictional pricing path** (`reach × 0.7`, `engagement ×
0.15`, `efficiency = reach/cost` — `NewCampaign.tsx:410-427`) separate from the DOOH engine.
  Phase 1 / Step 7 cleanup — it should not survive.

→ **Step 4 · #12** (4a + 4b done this phase; 4c = Phase 1)

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
an eventual `auth.service.ts` / `business-profile.service.ts` split is a Step 8 concern.

**Deferred to Step 7** (Dashboard-coupled — these read/write the same auth-cache keys, but the
refactor has to happen as part of decomposing those files): the `localStorage` call sites in
`Dashboard.tsx` (~16 — `onboardingCompleted`, `user_profile_type`, `user_raison_social`,
`justOnboarded`, `campaign_cart_items`) and `Onboarding.tsx` (3 — `onboardingCompleted`).

**Parallel anti-pattern:** a Zustand store exists (`stores/cart.store.ts`), but the cart state is
also hand-rolled in `localStorage` (`campaign_cart_items` in `CartPage.tsx` / `Dashboard.tsx` /
`NewCampaign.tsx`, all Dashboard-coupled) — the same shape `auth.store.ts` had before Step 3.
Deferred to Step 7 with the rest.

→ **Step 3 · #2** (done) · **Step 7 · #3** (the `Dashboard` / `Onboarding` `localStorage` sites + the `cart.store.ts` parallel)

### `console.*`

**Purged in Step 5** (commits `20d5034`, `f65bd16`, `c61934d`, `f0ebb37`, `22f26cc`, plus the audit
refresh that closed the step). Pre-Step-5 baseline: 901 lint-flagged `no-console` calls (446 `.log`,
421 `.error`, 33 `.warn`, 1 `.info`, plus 1 `.table` that the original discovery's grep missed).

Sequence:

- **Commit 1** added `apps/web/src/lib/logger.ts` — pino-backed, level-by-env (silent/debug/info),
  child-logger pattern per module. pino@10.3.1 as a production dep.
- **Commit 2** bulk-deleted Category 1 (debug detritus — all 446 `console.log` + 1 `console.info`):
  445 alone-on-line deletions + 2 inline replacements (body of unbraced `else`) with `;` to keep
  control-flow valid.
- **Commit 3** bulk-deleted Category 2a + 2b (`console.error` followed on the next line by `throw`
  or `toast.*`): 126 + 68 = 194 initial matches plus 5 second-pass extras caught when line-shifts
  brought new adjacencies into existence. Total 199. Pure deletions (the throw / toast still
  signals the error).
- **Commit 4** promoted the remaining 222 `console.error` → `log.error` and 33 `console.warn` →
  `log.warn` via pino's `({ ctx }, 'msg')` call shape, plus deleted 1 stray `console.table`.
  46 files received `import { logger } from '../lib/logger'` + a `const log = logger.child({ module: '<basename>' })`
  declaration.
- **Commit 4.5** ran prettier + eslint-fix on the 46 Step-5 files (cleared `import-x/order` violations,
  collapsed multi-line ctx-object args, collapsed empty bodies) and hand-rewrote 2 bare-error
  judgment cases (`pages/OwnerPerformance.tsx`, `pages/Perfor.tsx`) with meaningful messages.
- **Pino call shape locked**: `log.<method>({ ctx }, 'msg')` — context object first, message string
  second. Discovered mid-Commit-1 (pino's TS typings reject the inverse `('msg', { ctx })` form
  the original plan example used).

End state: **0** lint-flagged `console.*` calls. The `no-console: 'error'` ESLint rule is
enforced project-wide for `apps/web/**/*.{ts,tsx}` (the existing exceptions for `**/scripts/**`,
`**/__tests__/**`, `**/*.test.*`, and `**/*.config.*` are retained — `lib/logger.ts` itself
contains no `console.*` calls, so it needs no exception).

Bundle cost of the logger: main `index-*.js` gzip moved 128.61 kB → 130.50 kB (+1.89 kB net,
well under the 8 kB soft / 10 kB hard ceilings set in Commit 1's verification gate). Chunk count
unchanged at 110.

→ **Step 5 · #7** ☑

### Step 6 typing pass — completed

**Done in Step 6** (commits `6d212fb` Commit 0 discovery, `c007783` Commit 1, `9c4839b` Commit 1b,
`ed7c261` Commit 1c, `abe594c` Commit 2, `62e8813` Commit 3, `0af5cc3` Commit 4, `00d464e` Commit 5,
plus the rule-re-enable + audit refresh that closes the step).

Pre-Step-6 baseline: 265 `no-explicit-any` + 161 `no-unused-vars` + 30 (later corrected to 26)
`no-empty` + 197 `pnpm typecheck` errors (incl. 197 TS6133 unmasks from Step 5's console deletions).

Sequence:

- **Commit 0 (`6d212fb`)** — discovery + categorization report against the post-Step-5 baseline.
  Five categories defined: Cat-A (untyped-root cascades — needs Supabase generated types, Phase 1),
  Cat-B (refactorable in isolation), Cat-C (callback-param annotation strips), Cat-D (catch-error
  narrowing via `isErrorWithCode`), Cat-Catch (no-unused-vars caught-error `_`-prefix work).
- **Commit 1 (`c007783`)** — Cat-D narrowing across 77 sites + `isErrorWithCode` helper added to
  `lib/errors.ts` + ESLint `caughtErrorsIgnorePattern: '^_'` config.
- **Commit 1b (`9c4839b`)** — Cat-C strip of 30 callback-param annotations in cascade-free files;
  78 sites escalated to Cat-A when the strip surfaced new cascades.
- **Commit 1c (`ed7c261`)** — `_err` narrowing regression fix: 52 sites switched to the
  `getErrorMessage(err)` pattern (where `err` is the unprefixed narrowed binding) + 2 sites
  pattern-2 (kept narrowed shape but renamed). Resolved a `_`-prefix-eats-narrowing bug discovered
  mid-Commit-1.
- **Commit 2 (`abe594c`)** — Cat-B refactors: 23 sites typed in-place + 22 sites escalated to Cat-A
  when type leakage from untyped roots was wider than expected.
- **Commit 3 (`62e8813`)** — Cat-A: 132 sites marked with `TODO(phase-1)` per-site annotation +
  `eslint-disable-next-line @typescript-eslint/no-explicit-any` comment + tracking via issue #15.
  Closes `no-explicit-any` to 0 at the lint level while preserving the structural debt for the
  Phase-1 typing pass that has Supabase generated types available.
- **Commit 4 (`0af5cc3`)** — `no-unused-vars` cascade: 158 → 0 across five convergence iterations;
  TS6133 typecheck subset 197 → 66 as a mirror drop (the remaining 66 are Cat-A untyped-root
  cascades tracked in #15). `_`-prefix scope clarified (catch bindings + function params per
  ESLint; `varsIgnorePattern: '^_'` added for arbitrary locals).
- **Commit 5 (`00d464e`)** — `no-empty` cleanup: 26 → 0 (plan said 30; actual main count was 26 —
  4 sites were cleared incidentally by Commit 4's `_`-prefix + eslint-fix sweep). 19 else-block
  deletions + 7 catch-binding-drops with per-site RPC-fallback comments (each naming the specific
  RPC and its fallback behavior — `services/admin-video.service.ts:531` get_campaigns_using_video,
  `services/platform-stats.service.ts:24/93/138/175/230` for the platform-stats RPCs,
  `services/auth.service.ts:634` create_business_profile) + 1 orphan-binding deletion at
  `dooh-new-campaign-estimate.service.ts:248` (unmasked by the surrounding else-branch removal).

End state: **0** `no-explicit-any` · **0** `no-unused-vars` · **0** `no-empty` · **66**
`pnpm typecheck` (down from 197; residue all in #15) · **77/77** tests · gzip 130.71 kB
(+0.21 kB vs Step 5 anchor, well under ceilings).

Re-enabled in `eslint.config.js`: `@typescript-eslint/no-explicit-any: 'error'` (line 47),
`@typescript-eslint/no-unused-vars: ['error', { argsIgnorePattern, varsIgnorePattern, caughtErrorsIgnorePattern, destructuredArrayIgnorePattern }]` (lines 70-78),
`no-empty: 'error'` (inherited from `js.configs.recommended` at line 17).

### Step 6 regression remediation cycle

Commit 4's `no-unused-vars` cleanup unmasked four sites where mechanical binding-removal had
silently swallowed Supabase API errors that were previously surfaced only via the `error` field of
the destructured response object. Triggered a regression-class audit; five hotfixes shipped, all
on `main`:

- **P0a (`830c7b9`)** — `pages/admin/RechargeManagement.tsx:196`: destructure-rename corruption
  (`const { data: error } = ...` had renamed `data` to local `error`, then `if (error) throw error`
  was throwing the recharge row on success and silently succeeding on failure).
- **P0b (`277c68f`)** — `services/admin-user.service.ts` deleteUser cascade: restored option-(c)
  collect-then-throw-after error handling across 5 child-table deletes + recharges (parent
  `business_profile` no longer silently deletes when a child cascade fails).
- **P0c (`a59cfb9`)** — `pages/UserProfile.tsx:421`: document upload + business_profile update —
  destructured both errors and inline-checked, surfacing failures rather than showing
  `toast.success` on silent storage-upload-or-update failures.
- **P0d (`b3f50cb`)** — `pages/NewCampaign.tsx:3218` (cart-add) + `:3171` (save-draft): three
  cart-add mutations + one save-draft mutation now destructure and check errors. Event-link RPC
  failure treated as hard-fail (event-campaigns require the link to be functional; partial-success
  would leave an event-campaign without its event).

Three tracking issues opened for downstream observability and typing work:

- **#15** — Phase-1 typing prerequisites (131 `TODO(phase-1)` markers + Cat-A untyped-root cascades
  - `tsconfig.app.json` un-softening, all blocked on Supabase generated types).
- **#16** — Admin destructive operations diagnostic-logging gap (catch bodies fire user-facing
  toasts but no structured log entries).
- **#17** — Tier-3 read-only data fetches with silent-failure (9 sites including two money-adjacent:
  `balance.service.ts::calculateBalanceManually`, `MyRecharges.tsx::load`).

Methodology: four-tier severity framework for Class-2(a) silent-ignore findings (admin destructive
/ user-data-mutating / read-only with money-adjacency / intentional best-effort writers); the
methodology details + 15 learnings from Step 6 live in
[`docs/audits/2026-05-14-step-6-regression-audit.md`](audits/2026-05-14-step-6-regression-audit.md).

### Residual lint after Step 6

Post-Step-6 lint total: **395 problems (373 errors, 22 warnings)**.

Residual breakdown:

- **`jsx-a11y/*`: ~288** (label-has-associated-control 230, click-events-have-key-events 26,
  no-static-element-interactions 23, media-has-caption 6, no-noninteractive-element-interactions 3
  …) — **resolved in Step 11** (`jsx-a11y/*` now 0). See §4 "Step 11".
- **`no-useless-catch`: 71** — **resolved in Step 11 · Commit 5b** (now 0). The Step-6 note's
  "some carry a `throw new Error(mapAuthError(e))` pattern that should be preserved" was a
  misread: ESLint's `no-useless-catch` fires _only_ on the bare-rethrow shape
  `catch (e) { throw e; }` — transform-rethrow and side-effect-rethrow never trip it. All 71
  were bare rethrows, unwrapped by codemod. See §4 "Step 11".
- **`react-hooks/exhaustive-deps`: 22** (warnings) — Step 10 cleared 15 (22 → 7) by deleting
  non-compliant fetch effects; **Step 11 · Commit 5 cleared the remaining 7** (now 0). See
  §4 "Step 11".
- **`import-x/order`: 9** — residual ordering in files not touched by Step 5/6 sweeps. Low
  priority; will surface again in Step 8 (`features/<domain>/` restructure).
- **Long-tail**: `@typescript-eslint/no-unused-expressions` 3, `no-constant-binary-expression` 1,
  `import-x/no-unresolved` 1 — pre-existing.

### Deferred logger refinements

Sequential `log.*` calls in some files (e.g. `services/auth.service.ts` ~660-665, where four
adjacent `log.error` calls inspect different fields of the same error) could be consolidated into
single calls with multi-key context objects. Per-call `data` fallback keys for non-identifier
expressions (e.g. `log.error({ data: (err as any).code }, 'Code erreur')`) could be refined to
semantically meaningful keys (`code: (err as any).code`). Opportunistic cleanup — scope into a
future logger-cleanup pass, not Step 6.

### `as any` / `@ts-ignore`

**Closed in Step 6** (commits `c007783`, `9c4839b`, `ed7c261`, `abe594c`, `62e8813`). 265 (not 44 —
the original discovery snapshot was incomplete) `@typescript-eslint/no-explicit-any` lint fires
brought to 0: 134 fixed directly via Cat-D narrowing / Cat-C strips / Cat-B refactors; 131 marked
`TODO(phase-1)` per-site (Cat-A untyped-root cascades, blocked on Supabase generated types) and
tracked in #15. `@ts-ignore` / `@ts-expect-error` remain at 0 — none introduced. → **Step 6 · #8** ☑

### `localStorage` outside Zustand `persist`

Step 3 moved the auth/profile cache (`user_profile_type` / `user_raison_social` /
`user_validation_status` / `onboardingCompleted`) into `auth.store.ts`'s `persist` and removed the
hand-rolled `localStorage` from `auth.store.ts` / `auth.service.ts` / `ContactPage.tsx`. The remaining
direct `localStorage` use is in `Dashboard.tsx` / `Onboarding.tsx` / `NewCampaign.tsx` / `CartPage.tsx`
(the auth-cache subset + the `campaign_cart_items` cart subset) — Dashboard-coupled; both are
addressed when those files are decomposed. See "Auth-state layering" above. → **Step 7 · #3** ☑

### `window.location.reload()`

2 calls, both in `pages/MyAccount.tsx` (the `if (shouldLeave) reload(); else reload();` block).
→ **Step 9 · #5** ☑

**Resolved in Step 9.** Both `reload()` calls in `handleSubmit` (now
`features/screenhost/pages/MyAccount.tsx`) replaced with `loadProfileData()` +
`refreshUserStatus()` + `navigate('/owner-dashboard')` — mirroring the
no-reload pattern `handleUploadDocument` already used in the same file. The
original `if (shouldLeave) reload(); else reload();` was decorative — both
branches did the same full reload regardless of the confirm answer.
`window.location.reload()` count across the codebase is now 0. Commit `7665ea7`.

### Hardcoded `#00B3A6`

**Resolved in Step 12.** The audit's "449" was an undercount — the inventory at
`df0beec` found **513** `#00B3A6` occurrences, and the codebase turned out to be
mid-rebrand: a further **115** occurrences already on the new mint `#76E6AB` plus
an un-tokenized **6-shade mint family** (~98 occ). All consolidated onto the
semantic `brand-primary` token (Algae Green `#76E6AB`); see §4 "Step 12". → **#10** ☑

### `jsx-a11y` / `react-hooks/exhaustive-deps`

**Resolved in Step 11.** All ~282 `jsx-a11y/*` errors and all `react-hooks/exhaustive-deps`
warnings cleared; `no-useless-catch` (71) + `no-unused-expressions` (3) absorbed as Commit 5b.
Lint `346 → 1`. See §4 "Step 11" for the full record.

### Flat folder structure

`src/` was flat `pages/` + `components/` + `services/` + `stores/`, not the feature-based
`src/features/<domain>/` the architecture conventions call for.
→ **Step 8 · #4** ☑

**Resolved in Step 8.** `apps/web/src/` restructured into 9 feature folders under
`features/`: 6 domain features (`auth`, `campaigns`, `events`, `performances`, `screens`,
`wallet`) + 3 role features (`advertiser`, `screenhost`, `admin`). 142 files moved across
9 rename-only feature commits. `pages/`, `stores/`, `types/`, `constants/`, `data/`,
`utils/` directories removed entirely (their contents absorbed into features).
The **types-at-root anti-pattern** is resolved as a side effect — `types/` is empty and
removed; every type module lives in its owning feature.

**Folder-structure conventions established in Step 8** (record for future contributors):

- **Feature taxonomy.** Domain features (`auth`, `campaigns`, `events`, `performances`,
  `screens`, `wallet`) own services, types, stores, and feature-internal `lib/`. Role
  features (`advertiser`, `screenhost`, `admin`) own pages, layout chrome, and
  role-specific components. Role features import services from domain features, never the
  reverse — verified circular-edge-free at Step 8 Commit 9.
- **Clarification A — `src/services/` deliberate root residual.** `src/services/` survives
  for genuinely cross-cutting services with importers spanning 3+ features (currently
  `balance.service.ts`, `global-configuration.service.ts`). Single-cluster services moved
  into their feature. Do not liquidate `src/services/` — that would re-create the
  cross-feature import edges Step 8 deliberately avoided.
- **Clarification B — feature-internal `lib/`.** Pure utilities with a single feature
  consumer live under `features/<X>/lib/`, mirroring root `src/lib/`. Established with
  `features/campaigns/lib/wizard-zones.ts` + `wizard-dates.ts`.
- **Clarification C — `lib/dooh/legacy/`.** Holds persistence-coupled pre-v3 services
  slated for Phase-1 4c deletion. They live there for cutover-diff simplicity (one
  `rm -rf`), NOT because portable IP. The portable v3 IP is everything in `lib/dooh/`
  EXCEPT the `legacy/` subdirectory.
- **`admin-screens.service` ↔ `screens.service` independence** (Step 8 Commit 5):
  confirmed via grep — `admin-screens.service` does not import `screens.service`;
  independent code paths against a shared DB table. Minor duplication; a future
  service-dedup pass, not Step 8 scope.
- **Dead-file clustering — resolved by TBD-J** (commit `78cdfc8`). Step 8 surfaced 5
  dead files; the TBD-J sweep confirmed those 5 plus 2 more (`components/Modal.tsx`,
  `features/screenhost/components/RevenueCharts.tsx`) — **7 total, 1385 lines, all
  deleted in one atomic commit.** Dead files clustered in code paths not actively
  maintained: **3 of the 7 were screenhost components** (`UnavailabilityCalendar`,
  `DetailedRevenue`, `RevenueCharts`) — the screenhost UX went through multiple
  iterations and fossil cleanup was never done; useful context for future screenhost
  work. 2 were dead services paired with pages that bypass them (Supabase-direct).
  Hot paths (campaigns, auth) were clean. `components/Modal.tsx` was dead since its
  creation in Step 7 Commit 1 (`dd9a066`) — extracted as a "shared" component but
  never wired to a consumer; Step 8 Commit 10's §6 directory-survivor check counted
  it as present (a `find` count) without verifying it was consumed. Methodology
  refinement: a directory-survivor inventory must pair `find` with a consumer-grep —
  "present" is not "alive". `cart.store.ts` and `MyCart.tsx`, flagged dead by the
  TBD-J kickoff (a Codex finding against production code), were re-verified in the
  migration branch: `MyCart.tsx` was already deleted in Step 2a; `cart.store.ts` is
  the live cart store with 5 consumers — neither was deleted.
- **Placeholder pages.** Three route-wired "à compléter" pages remain live:
  `AdvertiserPerformancePlaceholder` (tracked as #19), `OwnerActivity` (14 lines),
  `OwnerMaintenance` (16 lines). The latter two should be triaged post-Step-8 if product
  wants them tracked as rebuild targets.

### Debug cruft

`utils/clearAuthCache.ts` (and its `App.tsx` side-effect import) was deleted in Step 3 — see
"Auth-state layering" above / §4. The scattered emoji `console.log`s (🔄 ✅ ⚠️ ❌ 📊 …) — heaviest
in `services/auth.service.ts` (~70) and `stores/auth.store.ts` (~45) — were cleaned in Step 5's
console-purge pass. → **Step 5 · #7** ☑

### `tsconfig` softening

`apps/web/tsconfig.app.json` extends `tsconfig.base.json` but re-disables `verbatimModuleSyntax`,
`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature` (with a tracking comment).
**Deferred to Phase 1** with #15 — un-softening these without Supabase generated types would
re-explode `no-explicit-any` and Cat-A cascades; the cleanest path is to land it as a single
pass once the Phase-1 backend migration provides typed sources for the 131 TODO(phase-1) sites.

### Duplicate devDependencies

**Resolved in Step 14.** `apps/web/package.json` carried 6 devDeps duplicating root-level
ones (`@eslint/js`, `eslint`, `eslint-plugin-react-hooks`, `globals`, `typescript`,
`typescript-eslint`) — a Step-8 partial-migration artifact. All 6 hoisted to root-only;
`eslint-plugin-react-refresh` (unused — confirmed 0 consumers) removed. `apps/web` devDeps
`18 → 11`. See §4 "Step 14". → **#13** ☑

### Transitive dependency deprecation warnings

`pnpm install` emits 4 deprecation warnings — `deep-diff`, `node-domexception`, `popper.js`,
`tar` — all **transitive subdependencies**, pre-existing, none introduced or removable by
cleanup-phase work. No Step-14 action. Deferred to Phase 1, where dependency-tree pressure
(security / compatibility) may warrant deliberate work.

### Frontend authorization model

The frontend has route guards via `AdminRoute` and in-component role checks on 4 admin
pages. Frontend route-guard correctness was fixed in commit `1b533d3` — `AdminRoute`'s
`requiredRoles` check was commented out AND miswritten (`admin.role?.name` on a
string-typed `admin.role`). Defense-in-depth in-component checks on the 4 superadmin-tier
pages (campaigns, events, admin-management, create-admin) were preserved. Backend
authorization is out of scope for the cleanup phase and is addressed at Phase 1. ☑

### Path alias resolution

The codebase uses `@/*` mapped to `./src/*` (`tsconfig.app.json` `paths` +
`vite.config.ts` `resolve.alias`). Cross-directory imports use the alias;
intra-directory siblings stay relative. Rule applied during TBD-C: resolved
target in a different directory → alias; resolved target in the same directory →
relative. 517 imports rewritten across 114 files via a ts-morph codemod (script
preserved at `apps/web/scripts/codemod-add-path-aliases.ts` as the audit record).
ESLint's `createTypeScriptImportResolver` reads the tsconfig automatically — no
resolver config required. → **TBD-C · #24** ☑

### Not an issue here (noted for completeness)

`src/services/auth.service.ts.backup` and the source repo's `debug-*.js` / `test-*.js` / `*.zip`
were excluded during import — not present in this repo. The marketing landing-page source and the
OVH hosting snapshot belong to the later infra phase, not here.

### Methodology learnings from Step 6

Step 6 (typing pass + regression remediation cycle) surfaced 19 process and tooling lessons worth
preserving for future cleanup steps. Grouped by category. Each lesson cites its worked example
with the commit hash where applicable.

#### Sweep methodology

**AST over regex for any sweep that classifies code by syntactic structure.** Step 6 ran three
analysis sweeps (P2 Class-2 silent-ignore audit, P3 Class-3 console-deletion side-effect audit,
and the post-P0d AST re-sweep). The first version of each used regex. Each was rebuilt as an AST
walk because regex misses three repeatable patterns: (1) nested destructuring like
`{ data: { user }, error }` — `[^}]*` stops at the inner `}`; (2) multi-line statements split
across newlines; (3) brace-balanced parsing fooled by template literals containing braces. The P2
re-sweep using `ts.createSourceFile` + `TryStatement` walk found 182 try/catch blocks vs the
regex version's 95, and 13 candidates vs the regex version's 4. The undercount was systemic, not
a single bug.

**Suspicious-fraction signal — if a sweep's candidate count is a tiny percentage of the
population, sanity-check the methodology before trusting the result.** P2's first run reported 4
candidates of 95 total blocks (≈4%). That ratio felt low for a codebase known to have
incomplete error handling. The AST re-sweep with proper detection brought it to 13 of 182 (≈7%) —
still low but with a doubled candidate count and a doubled population. The right tell wasn't
"too few candidates" alone; it was "too few candidates AND population gap signals the methodology
itself is undercounting."

**Total-population gap as the stronger methodology-failure tell.** When P2's regex returned 95
blocks and the AST returned 182, the 87-block gap was the more reliable failure indicator than the
4-vs-13 candidate gap. Candidate counts vary with code quality (real codebases can have any
ratio); population counts should be deterministic. A population swing of ~2× between two
detection approaches means the cheaper approach is missing real instances, not just classifying
differently.

**Zero-category sanity check — zero in a category is often a methodology bug, not a real signal.**
Commit 1c's `_err` narrowing fix found a brace-counter bug in the discovery script that was
emitting `0` for a category that had ~50 sites. The fix was a single character (replace `}` with
`)` in the regex) but the bug had landed in the previous commit's plan as "0 sites to fix" which
the user would have approved. When a count comes back zero, verify by spot-checking a known site
manually before trusting the zero.

**Pure-callee whitelists must match by method-suffix, not by full identifier path.** P3's first
run flagged 6 "function NO LONGER CALLED ANYWHERE" findings that on manual triage all turned out
to be `Date.prototype.toLocaleDateString`, `Array.prototype.slice`, `Array.prototype.join` calls.
The whitelist contained `toString`, `JSON.stringify`, `Object.keys` (identifier forms) but didn't
match `<varname>.toLocaleDateString` (suffix form). For receiver-bearing calls, maintain two
whitelists: exact-identifier and method-suffix, and check both.

#### Discovery vs execution drift

**Plan-vs-actual count drift in chained mechanical commits.** Commit 5's plan said "30 no-empty →
0". Actual main count at execution was **26** — 4 sites had been cleared incidentally by Commit
4's `_`-prefix sweep and its eslint-fix pass. Discovery snapshots can go stale within hours when
the commit chain is active. Re-baseline the per-rule count at the start of each commit ('current
state' check) rather than carrying forward from the discovery report. Worked example: Commit 5
(`00d464e`).

**Untyped-root any cascades — Cat-C strips surface new Cat-A.** Commit 1b stripped 30
callback-param annotations expecting a clean drop in `no-explicit-any` count. Instead, removing
the annotations caused type inference to fall back to `any` at root sites whose source was
already untyped (Supabase response types). 78 sites escalated from Cat-C to Cat-A — they couldn't
be fixed without typed sources. Categorize by **distance from a typed root**, not by surface form
of the annotation. Worked example: Commit 1b (`9c4839b`).

**Dead-code cascades from compile-then-fix iteration.** During Step 6 Commit 2's Cat-B refactors,
typing one component (the `ActionCard` chain) revealed two now-unused helper functions whose only
typed callers had been removed. The compile-fix-recompile loop surfaces this naturally if you run
typecheck between each refactor; it does not surface if you batch all refactors and run typecheck
once at the end. Cost: a few extra typecheck runs per commit. Saving: avoiding a follow-up commit
to remove the dead helpers.

**Iterate sequential pattern-deletion to convergence.** Already documented in the prompt guide
from Step 5's console purge. Step 6 added a second worked example: Commit 4's `no-unused-vars`
cascade required **5 convergence iterations** — each pass deleted bindings whose only consumer
was a binding deleted in the previous pass. Single-pass is incomplete for any rule whose fires
form a chain. Worked example: Commit 4 (`0af5cc3`). For any rule that can fire on the consequence
of another fire of the same rule, the script must loop until grep returns zero.

#### Severity classification

**Class-2(a) silent-ignore findings classify into four severity tiers.** Tier 1 admin destructive
operations (worked examples: P0a `830c7b9` recharge; P0b `277c68f` deleteUser cascade). Tier 2
user-data-mutating operations with success toasts (worked examples: P0c `a59cfb9` document upload;
P0d `b3f50cb` cart-add + save-draft). Tier 3 read-only data fetches populating UI state — medium
severity, with money-adjacency escalating to medium-high per CLAUDE.md (tracked in #17). Tier 4
intentional best-effort writers — audit logs, telemetry; acceptable with diagnostic logging
(tracked in #16). The original sweep framework was binary (admin destructive vs all-else); Tier 2
and Tier 3 money-adjacent were both missed at first sweep. The tiered framework caught them on
re-sweep.

**Catch-rename vs destructure-removal are distinct non-regression classes.** Step 6 P1
re-verification of `UserManagement.tsx` initially flagged 3 sites as destructure-removal
regressions. Detailed inspection showed the pre-Step-5 catch bodies were already `toast.error(...)`
with no logging — Step 4's work had only renamed the catch binding from `error` to `_error` to
satisfy `caughtErrorsIgnorePattern: '^_'`. Native TS-safe rename, no semantic change. False alarm.
Distinguish: **catch-binding rename** (just renamed `error` → `_error` in a catch clause; safe)
vs **destructure-removal** (removed `{ error }` from a `const { data, error } =` destructure;
unsafe unless verified).

**Partial-success vs hard-fail framing.** Partial-success is appropriate only when the failed
component is genuinely independent — cosmetic, async-followup, cacheable. When the failed
component is constitutive of the operation's semantic identity (event-link to an event-campaign,
owner-permission to an owner action), hard-fail is correct. The user-facing UX of an unintended
half-state is worse than the UX of an explicit failure. Worked example: P0d's event-link RPC
decision (`b3f50cb`).

#### Failure-mode patterns

**Partial-write orphan policy — leave orphan, surface error, no cleanup attempt.** On partial-write
failures involving storage + DB, leave the storage file as orphan and surface the DB error to the
user. Cleanup is the admin-side orphan job's responsibility, not the user-flow's. Avoid
best-effort cleanup that introduces additional failure modes (e.g., cleanup itself fails, now
you've logged two errors and surfaced a third). Same policy applies to multi-write DB sequences:
do not roll back partial state, surface the failure honestly, return without proceeding. Worked
examples: P0c (`a59cfb9`) for storage + DB; P0d (`b3f50cb`) for the multi-DB cart-add sequence.

**Lint-driven cleanup vulnerability on inherited codebases.** Inherited codebases with inconsistent
error-handling conventions are vulnerable to lint-driven cleanup. Rules like `no-unused-vars` and
`no-empty` treat "binding never consumed" or "block never filled" as removable, but in code where
error-checking was incomplete, those constructs are often the only surviving evidence that the
operation can fail. The Step 6 P0a/P0b/P0c/P0d cycle is the worked example: every hotfix originated
from a site where mechanical lint cleanup had removed an `error` destructure or an `if (error) {}`
fragment that was the only remaining error-handling reference. Before any lint-driven sweep on
such a codebase, do a discovery pass scanning for patterns that may encode incomplete
error-handling: `{ error: <name> }` destructures with unused `<name>`, empty
`if (errorCondition) { }` blocks, catch bindings named `error` or `_error` with empty bodies.

**JSX expression containers cannot host eslint-disable directives.** Commit 3's Cat-A TODO marker
work tried to add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` before
`recharts` chart component props with `any` types embedded in JSX. ESLint silently ignores
disable directives inside JSX expression containers — the comment is parsed as a JSX text node, not
as a directive. Worked example: the `RevenueCharts` inline-fix attempt during Commit 3 (`62e8813`).
For Cat-A markers inside JSX, hoist the typed value into a variable above the JSX block and put
the disable directive there. Single-line JSX `any` casts cannot be locally suppressed without
restructuring.

#### Tooling pitfalls

**Renamed-destructure regex traps in bulk-edit scripts.** Commit 4's bulk no-unused-vars script
matched `const { error } = await supabase...` and rewrote `error` to `_error` blindly. It missed
that `error` was sometimes a _local rename target_ in the destructure (`const { data: error } =
...`), not the original Supabase `error` property. The rewrite produced corrupted destructure
patterns where the local variable was wrong. Worked example: P0a (`830c7b9`,
`RechargeManagement.tsx:196`) where `const { data: error } = ...` was Step-4 corrupted such that
every successful recharge `throw error` threw the inserted row. For any destructure-pattern
bulk-edit, distinguish original-property-name from local-binding-name explicitly in the script,
and refuse to edit when the form is ambiguous.

**`_`-prefix scope: ESLint vs TS6133.** ESLint's `caughtErrorsIgnorePattern: '^_'` and
`argsIgnorePattern: '^_'` cover catch bindings and function parameters. TypeScript's TS6133
(`noUnusedLocals` / `noUnusedParameters`) respects the `_` prefix ONLY for function parameters
and (since TS 4.4) destructuring pattern with explicit `_` patterns — it does NOT respect the
prefix for arbitrary locals or function declarations. A destructured-object alias rename
(`{ x: _x }`) prevents the warning at the destructure site but does not silence a separate
TS6133 fire on the alias. The audit doc's earlier "`_`-prefix everywhere" framing was too
broad — the prefix is a tool with different scopes per linter and per compiler. ESLint added
`varsIgnorePattern: '^_'` in Commit 1's config to extend the ignore to arbitrary locals; that
extends ESLint's behavior, not TypeScript's. Worked example: Commit 4 (`0af5cc3`).

**Map-keyed-by-line collision in bulk-edit scripts.** Commit 1's Cat-D narrowing script kept a
`Map<filepath:lineno, replacement>` for each rewrite. When two replacements happened to land on
the same line (e.g., two `catch (err)` on lines 100 and 101 where the script's offset-based
line-number was 100 for both after a prior edit shifted the file), the Map silently dropped one.
Use either sequential per-line application with offset re-computation between edits, or
convergence iteration (re-discover after each batch of edits). The Step 5 prompt-guide note on
iteration covers the latter pattern.

**Stash-and-restore as a known failure mode.** Step A of the resumption sequence applied
`stash@{0}` which contained 15 files of in-flight work. One file (`admin-user.service.ts`) had
been overwritten on `main` by P0b after the stash was created. The apply produced a conflict;
naively `git checkout main -- <file>` resolved by adopting main's version, which was correct
here but is a footgun in the general case (could drop the in-flight work the user expected to
keep). When stashing in-flight work for an indeterminate period, log the file list at stash time
so the resumer can compare against the head-state file list and surface discrepancies as
decisions rather than silent resolutions. Worked example: Step A of the Step 6 regression
remediation resumption.

### Methodology learnings from Step 7

Step 7 (Dashboard + NewCampaign decomposition over 15 commits) surfaced 19 process and tooling
lessons worth preserving for future cleanup steps. Grouped into five categories matching the
Step-6 precedent. Each lesson cites its worked-example commit hash; where a generalizable
principle was promoted to a persistent working-memory file during the run, that file is
referenced under "See also."

> **Note on provenance**: items marked with † were captured as named carry-forwards during
> Step 7's execution but their full content was reconstructed from conversation context after
> the fact (rather than from a disk-persistent working-memory file written at capture time).
> Disk-backed working-memory files exist for items #13, #15, #16, #18, #19 — those entries are
> the highest-confidence text. Other items may warrant verification against the worked-example
> commits if precise wording matters.

#### Inventory & discovery discipline

**Discovery-prediction verification†.** Phase-1 inventory predictions (line counts, call-site
counts, prop counts, dead-code estimates) should be verified at write time (e.g., `wc -l`,
`grep -c`, AST checks) before being treated as authoritative. Inflated or under-stated estimates
compound into inflated commit-scope expectations. Worked example: Step 7 Commit 12 inventory
estimated the hidden sidebar at ~250 lines; actual was 80 (3× overshot), which contributed to
the 1100-1200 line-count target / 1624 actual gap in the orchestrator cleanup. _(Originally
captured as two separate items during Step 7; merged into one entry as they refer to the same
methodology of verifying inventory predictions before publishing.)_

**Pre-extraction Q&A surfaces runtime-derived deps†.** Inventory-phase targeted questions to
the user surface runtime-derived dependencies that wouldn't be visible without asking. The
narrow-prop pattern's prop list, the lift-vs-pull decisions on cross-step consumers, and the
"is this state still live post-extraction" judgments all depend on dep information the
extractor doesn't have until it asks. Worked example: Step 7 Commits 9-11 inventories surfaced
the `selectedExistingVideo` memo's parent-level consumers (`computeNewCampaignDoohMaxImpressions`,
`saveCampaignDraft`, cart-create, Step 6 recap) — which forced the memo to stay in the parent
rather than move into Step 5.

**Extractions trigger cascading dead-code beyond inventory†.** Step extractions surface
transitively dead code (handlers/state/imports) that wasn't in the pre-extraction inventory.
Budget for setter-to-true verification + the resulting cleanup as part of the extraction commit,
not as a follow-up. Worked examples: Commit 8 (Step 3 extraction → 3 residual unused bindings),
Commit 9 (Step 4 extraction → dead zone modal + 3 dead useState slots, net −830 lines), Commit 12
(orchestrator cleanup → dead Events modal + dead hidden sidebar + dead `formData` facade).

**Discovery-target line-count drift when intermediate decisions change scope†.** When a
Path-A/Path-B decision (or similar mid-commit scope branch) is made, the original line-count
target drifts. Document the adjustment as the documented consequence of the decision rather
than treating the commit as under-delivering. Worked example: Commit 11 Path B decision
(extract verbatim instead of adopt hook wrappers) kept ~245 lines in the parent that Path A
would have moved; the Commit 12 target of ~1100-1200 lines became 1624 actual, with the gap
attributable to the Path B decision documented in the commit body.

**Line-count estimates drift 2-3× — verify with `wc -l`.** Pre-extraction inventory line-count
estimates of JSX/code blocks drift 2-3× from actual because eyeball estimates are biased by
visual density (nesting depth, long className strings, wrapped attributes inflate perception).
The Commit 12 hidden sidebar estimate was ~250 lines; actual was 80 — a 3× error. Methodology
refinement: for any pre-extraction prediction of code-block line counts, count with `wc -l` (or
equivalent line-range count) before publishing. See also: [[verify-line-counts-not-eyeball]]
working memory.

**Inventory phase 1 surfaces scope expansion — surface for user accept/decline/defer, don't
reconcile silently†.** When the inventory phase reveals work outside the explicit prompt scope
(another doc to update, another file to touch, another finding worth tracking), surface as a
finding in the deliverable; don't reconcile silently by either expanding scope unilaterally or
ignoring the finding. Worked example: Commit 13a inventory surfaced that `docs/audit.md` (not
listed in the user's prompt) is the actually-authoritative doc per its own self-description
and the Step 6 precedent (`a8de588`) updated it — expanded scope was the right call, but it
was surfaced explicitly rather than slipped in.

#### Extraction patterns

**Setter-shim pattern for migration†.** When migrating from per-field `useState` to a unified
`useState<WizardState>` (or equivalent state-machine), wrap each field's setter as a one-time
`useCallback` shim that preserves the `setX(value|updater)` API: `const setCampaignName =
useCallback((next) => setState(prev => ({ ...prev, campaignName: typeof next === 'function' ?
next(prev.campaignName) : next })), [setState])`. The pattern is a one-time architectural
investment that zero-touch propagates to subsequent step extractions — every existing
`setX(value)` or `setX(prev => ...)` call site continues to work without rewriting. Worked
example: Commit 6 `useCampaignWizard` adoption introduced 16 setter shims; Commits 6-12 reused
them without rewriting a single call site.

**Closure-capture → explicit-parameter during extraction†.** When extracting a function whose
inner closure captures parent-scope vars (e.g., `validateDate(dateType, date)` reading
`endDate` and `startDate` via closure), promote those vars to explicit parameters
(`validateDate(dateType, date, otherDate)`) so the extracted version is testable in isolation
and its dependencies are visible at the call site. Worked example: Commit 8 (Step 3 extraction)
refactored `validateDate` to take `otherDate` explicitly + threaded the cross-field
re-validation logic from `handleDateChange` accordingly.

**State-as-single-prop departure from narrow-prop pattern for read-heavy step components†.**
When a step component reads ~10+ WizardState fields (rather than the 4-8 typical of earlier
steps), passing the whole `wizardState` object as a single read-only prop is the right
departure from the narrow-prop pattern. Setters and handlers stay narrow. The reduction in
prop-list noise outweighs the loss of explicit-read tracking. Worked example: Commit 11 Step 6
extraction — Step 6 reads ~14 WizardState fields for its recap pane; the props interface was
22 narrow props vs 14 props with the `wizardState: WizardState` single-prop approach.

**Extraction-without-rewrite (Path B) when production-vs-wrapper divergence exists.** When
extracting code whose inline implementation has diverged from a pre-existing pure wrapper
(hook, service function, or helper), extract verbatim and track the wrapper-adoption decision
as a separate issue. Path A (adopt the wrapper, expand it to model the divergences) breaks the
scoped-extraction commit's safety profile (decomposition-without-logic-change) by adding a
logic rewrite no matter how it's framed. Worked example: Commit 11 Save/AddToCart extraction —
the parent's inline handlers had acquired 5 production behaviors the `useCampaignWizard`
wrappers didn't model (`content_validation_status` update, `link_campaign_to_event` RPC,
recommended-events preload, custom insufficient-balance UX with 3s auto-nav, `prixTotal`
fallback). Path B preserved production behavior; Issue #20 tracks the adoption debt. See also:
[[extraction-without-rewrite-discipline]] working memory.

#### Dead-code detection

**Dead-UI detection via setter-to-true call-site verification (pattern a)†.** Modals, overlays,
and conditionally-rendered surfaces gated on `{showX && ...}` are dead when their gate variable
is never flipped to its open state — i.e., zero `setShowX(true)` call sites in the symbol
table. Detection is mechanical via `grep -n 'setShowX(true)'`; zero hits means the entire gated
block is unreachable. Worked examples: Commit 9 dead zone modal (370 lines, `setShowZoneModal(true)`
never called); Commit 12 dead Events modal (172 lines, `setShowEventsModal(true)` never called).

**Dead-UI detection requires two complementary patterns: setter-to-true (a) AND CSS-gated (b).**
Pattern (a) catches `{cond && ...}`-style conditional rendering. Pattern (b) catches
unconditionally-rendered JSX with hardcoded `hidden` / `display:none` / `visibility:hidden` in
its `className` — the element renders but doesn't paint. Conditional-rendering audits scan for
`{cond && ...}` expressions and miss pattern (b) entirely. Both must run. Worked example:
Commit 12 hidden sidebar — `<div className="space-y-6 hidden">` rendered ~80 lines of "Estimation
dynamique" UI that `display:none` hid; class was hardcoded with no toggle. Setter-to-true would
have missed it because there's no gate variable; the CSS-gated grep caught it. See also:
[[dead-ui-detection-patterns]] working memory.

#### Documentation / source-of-truth consultation

**Figma consultation rule — consult the design source-of-truth BEFORE asking the user, deleting
UI, or inventing UX.** The directory `~/Downloads/toodooh_figma/` is the canonical product-intent
source for this project. Specific triggers: apparently-dead UI (check Figma before deleting —
it may be unimplemented, not unintended), empty/loading/error states (check before inventing UX
in either direction), conditional/mode-branching merges (check before merging visually-similar
branches), copy/labels/button text (check before changing wording), removed nav entries (check
before removing). At each commit's pre-extraction inventory, explicitly state either "Figma
directory checked: [screen X.png] reviewed, [finding]" or "no UI/UX hesitancy in this commit,
Figma check skipped." Worked example: Step 7 Commit 3 deleted `pages/Perfor.tsx` as dead code
without consulting Figma; `Performances.png` showed the intended page — issue #19 had to be
opened retroactively. Commits 9 onward formalized the rule. See also: [[figma-consultation-rule]]
working memory.

**Figma consultation rule produces first proactive product-gap finding.** Worked example:
Commit 11 inventory consulted `screencast/Mon panier.png` before extracting the post-cart UI
and found that Figma places the "Augmentez votre impact" recommendations section on the
`/panier` cart page, not in the wizard's post-cart screen. The current code's in-wizard
implementation was preserved as-is in the scoped extraction commit; Issue #21 was opened to
track the product decision on placement. The retroactive-versus-proactive distinction matters:
Performances.png in Commit 3 was a retroactive finding (deleted, then restored); Mon panier.png
in Commit 11 was a proactive finding (preserved, tracked, no rebuild required). See also:
[[design-source-of-truth-consultation]] working memory (generalizable principle).

#### Process and review

**Chunk-size hard-halt phrasing — use ±delta framing, not absolute thresholds†.** Hard-halt
conditions for chunk size should specify the allowed delta (e.g., "moves more than ±5 kB from
27.20") rather than an absolute floor or ceiling. The delta framing allows legitimate growth
or shrink within tolerance while catching regressions; an absolute threshold either becomes
stale (set too low, every commit halts) or meaningless (set too high, real regressions sneak
through). Worked examples: Step 7 Commits 5-12 used `±5 kB` consistently, with the anchor
re-baselining each commit to the previous commit's actual value.

**Eager-imports in routing module — keep eager unless first-render latency demands lazy†.** Step
components imported into the parent route eagerly (rather than via `React.lazy`) are simpler
and produce stable chunk-size growth. Switching to lazy adds first-render latency on every step
navigation and adds Suspense boundary plumbing. Worked example: the 6 step components +
PostCartStep were imported eagerly throughout Step 7; cumulative NewCampaign chunk growth was
under +2 kB across 13 extraction commits, well within the ±5 kB tolerance budget. Defer
lazy-loading to a future-phase optimization if the chunk grows past the budget.

**Singular-vs-plural legacy shadow detection†.** Service or page filename pairs like
`service.ts` + `services.ts` are a class of pattern (legacy shadow created during ad-hoc
refactors), not one-off dedups. Treat the pattern: grep across the relevant directory for
filename twins differing only by a final `s` or `_v2` or capitalization variant. Worked
examples: `campaign.service.ts` + `campaigns.service.ts` (resolved in earlier audit Step 2b);
`screens.service.ts` + `services/api/screens.api.ts` (the `.api.ts` wrapping `.service.ts`
shadow pattern).

**Pre-commit lint-staged bypass — workspace `pnpm lint` is the authoritative gate†.** When the
pre-commit hook's lint-staged surfaces pre-existing per-file errors that block a scoped commit
on a long-lived inherited file (e.g., NewCampaign.tsx with 22 pre-existing jsx-a11y errors that
predate Step 7), `--no-verify` is justified for the duration of that step's commit chain. The
workspace `pnpm lint` total is the authoritative gate that matters for "is the codebase
getting better or worse." Worked example: every Step 7 commit (Commits 6-12 + 13a + 13b) used
`--no-verify` per standing authorization; workspace lint dropped 395 → 370 across the chain
while lint-staged would have blocked every commit on inherited NewCampaign.tsx a11y errors.

**Pause-review-vs-actual-diff blind spot in spec verification†.** The pause-summary describes
what was intended; only the actual diff confirms what landed. When a previous commit's
deliverable says "X was done" and the next commit's inventory finds X was actually NOT done,
the gap typically is in the pause-summary verification — the writer described the intended
change rather than the diff. Worked example: Commit 10 inventory found the Commit-9 footer-gate
was still `currentStep > 3` despite Commit 9's deliverable claiming `currentStep > 4`; the
pause-summary described the planned target, not the shipped diff. Commit 10 bundled in the fix.

**Carry-forward #20 / Inventory scope expansion handling†.** When a Phase-1 inventory surfaces
work outside the prompt's explicit file list (another doc to update, another finding to track,
another decision the prompt didn't enumerate), surface as a "scope expansion finding" in the
inventory deliverable with three options: (a) user accepts the expansion, (b) user declines and
the work is dropped, (c) user defers to a follow-up commit. Don't reconcile silently by either
expanding scope unilaterally or pretending the finding doesn't exist. Worked example: Commit 13a
inventory surfaced `docs/audit.md` as the actually-authoritative doc not listed in the prompt;
flagged as scope expansion; user accepted; `docs/audit.md` was updated in 13a alongside the
named handoff docs.

### Methodology learnings from Step 8

Step 8 (the `features/<domain>/` restructure over 9 rename-only feature commits + a discovery
commit + a plan commit + 8 interleaved notes/CF micro-commits) produced 9 carry-forward rules
(CF-1…CF-9) plus a meta-observation. Captured live in
`docs/superpowers/plans/2026-05-15-step-8-notes.md`; promoted here. These generalize to any
future bulk file-move / restructure work.

#### Sed-driven rename discipline

**CF-1 — Sed coverage has four import-path shapes.** When moving a directory's contents:
(1) external imports — `'../X'`, `'../../X'`, `'../../../X'` — the rewrite list must cover
_every_ root directory referenced, including ones easy to forget (`constants/` was missed at
Commit 1); (2) self-sibling imports `'./X'` — covers BOTH static `from './X'` AND **dynamic
`import('./X')`** (Commit 7's `admin-video.service` dynamic import was missed by a static-only
grep; Commit 9 hit the same file again — dynamic service imports are a rare outlier worth a
dedicated `import\(` grep); (3) intra-feature post-move siblings auto-correct via git rename
detection — trust it; (4) **depth-classification by inspection** — never assume a file shares
its directory-peers' depth; Commit 6's `AdvertiserNotificationsBell` was depth 1 while its
`components/layout/` peers were depth 2. _Amendment:_ generic patterns (`'../../services/X'`)
matter alongside specific names — Commit 7 missed the generic `global-configuration.service`
bump because the sed listed only admin-prefixed service names.

**CF-2 — Post-sed autofix is routine, not regression.** Standard cadence:
`typecheck → sed → eslint --fix (scoped to touched files) → lint → test → build`. Sed-injected
`features/*` paths reshuffle import order; the resulting `import-x/order` spike is expected and
cleared by the scoped `--fix`. Halt only if a _non-order_ rule regressed after autofix.
_Blind spot:_ `--fix` cannot reorder across a CSS / side-effect import (`import 'x.css'`);
when one interleaves path-rewritten imports, a manual reorder is needed (Commit 7's
`GeographicZonesManagement`).

**CF-3 — Chunk-hash is a soft signal, not a gate.** Source-string changes (a rewritten import
path) legitimately change Vite chunk hashes. Hash _identity_ is a happy outcome (module-graph
collapse), not the expected case. Halt only on an _unexplained_ hash change, an unexpected
new/missing chunk, or gzip drift past tolerance.

#### Inventory & discovery discipline

**CF-4 — Importer-count predictions are ±1-suspect.** Numeric predictions in discovery/plan
docs drift; re-grep importer surfaces at each commit's inventory phase, report actual vs
predicted. (Generalizes Step 7's "verify line counts, don't eyeball" from line-counts to
importer-counts.)

**CF-8 — Grep-verify discovery claims at write time.** Discovery's "who imports X" claims must
be grep-verified when written, not eyeballed. CF-8 was _generated_ after Commit 4 surfaced
three importer-count discrepancies; it then caught Commit 5's dead 153-line `locations.service`
that discovery had treated as live. **Anchor the grep** (`'screens\.service'` not the bare
substring) — Commit 5's first pass over-counted by matching `admin-screens.service`.

**CF-8 meta-observation.** Methodology rules generated by recent commits' findings catch
failure modes the discovery phase missed. When a refinement is surfaced mid-step, apply it
retroactively to the next inventory — it often catches more than the originating finding did
(CF-8, born to catch count drift, caught a dead 153-line file instead).

**CF-5 — Audit/plan text drifts between major-step refreshes.** Four staleness findings
accrued during Step 8 (stale §2 lint per-rule breakdown; an inaccurate §3 "OwnerDashboard
imports performance.service" claim; a wrong plan §5 "4 revenue.service consumers" count; a
wrong plan §5 "31 admin files" count). Pattern: re-verify audit text at the _start_ of any
future step rather than trusting the prior refresh.

#### Process and review

**CF-6 / CF-7 — Two-tier push policy.** Doc commits (plan, discovery, notes, audit refresh)
push immediately — they are reviewed against the rendered version. Code commits hold local
until the user's "go" approves them, so a bad commit can be amended/reverted without polluting
`origin/main` with a public revert.

**CF-9 — Pause-summary delivery format.** Deliver each commit's pause summary as a single
copy-paste-fidelity text block in chat: all mandatory items inline, gates as a table, no
"see file X" indirection, no terminal control sequences.

**Risk-register accuracy.** The plan's §9 double-update predictions (a domain service moved
before its owner-side consumers takes two path updates — once at the domain commit, once at
the screenhost commit) held _exactly_ across execution: 5 predicted pairs, 5 settled. When
commit ordering forces double-updates, count them at plan time and verify the settle count
per commit.

---

## 4. Already resolved

- **`react-hooks/rules-of-hooks`** — 0 (was 20, all in `admin/CampaignMonitoring.tsx`; commit `bc63fb1`).
- **`itstrategix.tn` redirect** — removed; auth email redirects are now env-driven via `lib/app-url.ts` / `VITE_PUBLIC_APP_URL` (commit `854f112`).
- **Eager bundle / no code-splitting** — every route is `React.lazy()`; main bundle 3.25 MB → ~434 kB (commits `95df8a1`, `d80ef19`, `290024a`).
- **Formatting & import hygiene** — one-time Prettier + ESLint `import-x/order`/`prefer-const` autofix + unused-import removal (`eslint-plugin-unused-imports`) (commits `82e8f66`, `c8b5f17`, `39536c1`; recorded in `.git-blame-ignore-revs`).
- **Step 5 — Frontend logger + `console.*` purge** — Pino logger module landed at `apps/web/src/lib/logger.ts` with dev/prod/test config (silent in vitest, debug in dev, info in prod). 901 `console.*` calls (446 .log + 421 .error + 33 .warn + 1 .info + 1 .table) removed or promoted across 46 files. 222 `console.error` promoted to `log.error` and 33 `console.warn` to `log.warn` via pino child loggers scoped per-module; the rest were deleted (Cat-1 debug detritus, Cat-2a console.error+throw, Cat-2b console.error+toast — all signalled elsewhere). `no-console: 'error'` ESLint rule enforced project-wide. Bundle gzip 128.61 → 130.50 kB (+1.89 kB net pino-browser cost). Side effect: typecheck rose 179 → 197 (19 TS6133 unused-variable unmasks surfaced by removing console.log consumers; deferred to Step 6). → Issue #7. Commits `20d5034`, `f65bd16`, `c61934d`, `f0ebb37`, `22f26cc` (this audit refresh + Step-5 close-out).
- **Step 6 — Typing pass + regression remediation** — 265 `@typescript-eslint/no-explicit-any` → 0 (134 fixed via Cat-D narrowing + Cat-C strips + Cat-B refactors; 131 marked `TODO(phase-1)` and tracked in #15); 161 `@typescript-eslint/no-unused-vars` → 0 via `_`-prefix + delete + restructure; TS6133 typecheck subset 197 → 66 as mirror drop (66 residue all Cat-A untyped-root cascades → #15); 26 `no-empty` → 0 via else-deletion + per-site catch-fallback comments + 1 orphan-binding cleanup. Five P0 hotfixes shipped during the regression remediation cycle triggered by Commit 4 unmasking incomplete error-handling: P0a (`830c7b9` recharge destructure), P0b (`277c68f` deleteUser cascade), P0c (`a59cfb9` document upload), P0d (`b3f50cb` cart-add + save-draft). Three tracking issues opened: #15 (Phase-1 typing prerequisites), #16 (admin destructive ops observability), #17 (Tier-3 read-only fetch observability). Full methodology + 15 learnings in `docs/audits/2026-05-14-step-6-regression-audit.md`. Bundle gzip 130.50 → 130.71 kB (+0.21 kB net). → Issue #8. Commits `6d212fb` (Commit 0), `c007783`, `9c4839b`, `ed7c261`, `abe594c`, `62e8813`, `0af5cc3`, `00d464e`, plus this audit refresh + #8 close-out.
- **Step 7 — Dashboard + NewCampaign decomposition** — `Dashboard.tsx` (2635 lines) retired entirely, replaced by `AdvertiserDashboard` page + 4 hooks + 6 components + ModalProvider (Commits 1-4) + App.tsx route flip pointing all 12 advertiser routes at their real page components instead of `<Dashboard />` (Commit 7). The "Mes performances" sidebar entry restored per Figma `Performances.png` (tracked in #19 for the page-body rebuild). `NewCampaign.tsx` 4030 lines → **1624 lines** (-2406 net, ~60% shrink) via extraction of the campaign wizard's 6 steps into `pages/new-campaign/{Step1NameType,Step2,Step3,Step4,Step5,Step6,PostCartStep}.tsx`, the wizard state machine into `hooks/new-campaign/useCampaignWizard.ts` (composed over a generic `hooks/useWizard.ts`), pure functions into `wizard-{steps,serialize,init}.ts` + `lib/wizard-zones.ts`, and the dead-modal + dead-sidebar cascades surfaced by the setter-to-true and CSS-gated dead-UI detection patterns (Commits 9, 12). Path B chosen for the Save/AddToCart flow (extract verbatim) when the parent's inline handlers were found to have diverged from the Commit 5 `useCampaignWizard` wrappers across 5 production behaviors — tracked in #20 for future reconciliation. Figma consultation rule formalized in Commits 9-11 after the retroactive Performances.png finding; first proactive product-gap finding produced (#21 post-cart placement on /panier vs wizard). 19 methodology carry-forwards captured for the methodology learnings refresh in 13b. Typecheck 66 → 58, lint 395 → 370, tests 77 → 98 (21 new pure-function tests on the wizard's serialize/perform layer). Bundle gzip 130.71 → 131.42 kB (+0.71 kB net = wizard machinery); Dashboard chunk retired entirely; new NewCampaign chunk gzip 25.77 kB. Three follow-up tracking issues opened: #19 (Mes performances page rebuild per Figma), #20 (hook-wrapper adoption: reconcile useCampaignWizard with inline cart-add behavior), #21 (post-cart recommendations placement: wizard vs cart page per Figma). → Issue #3. Commits `46ae53d` (discovery), `dd9a066`, `2ba80bf`, `843498d`, `6022672`, `53bea06`, `5511110`, `6e47c6a`, `2a25ad8`, `329f576`, `ceec832`, `2bc7ebf`, `fade44f`, `6ed1103`, `6c48d30`, plus this audit refresh + #3 close-out.
- **Step 8 — `src/features/<domain>/` restructure** — `apps/web/src/` restructured from a flat `pages/`+`components/`+`services/`+`stores/` layout into 9 feature folders under `features/`: 6 domain features (`auth`, `campaigns`, `events`, `performances`, `screens`, `wallet`) + 3 role features (`advertiser`, `screenhost`, `admin`). 142 files moved across 9 rename-only feature commits, ordered by fan-in / risk (auth first — broadest fan-in; campaigns last — largest). `pages/`, `stores/`, `types/`, `constants/`, `data/`, `utils/` directories removed; their contents absorbed into features. `src/components/` retains 4 truly-shared files (`Modal`, `AnimatedLogo`, `PageLoadingFallback`, `ContentErrorBoundary`); `src/hooks/` retains the generic `useWizard.ts`; `src/services/` retains the 2 cross-cutting services (`balance`, `global-configuration`) as a deliberate residual (Clarification A); `src/contexts/` retains `ModalContext.tsx` pending TBD-A. `lib/dooh/legacy/` added for the 5 persistence-coupled pre-v3 DOOH services (Clarification C). Pure rename — typecheck unchanged at 58, test unchanged at 98/8/0, build gzip 131.42 → 131.34 kB (rename noise); lint 370 → 364 (−6 incidental `import-x/order` autofix). 5 dead files surfaced for follow-up deletion (TBD-E…I); 10 follow-up issues filed (TBD-A…J); 9 carry-forward methodology rules (CF-1…9) captured — see §3 "Flat folder structure" for the conventions and the methodology subsection below. → Issue #4. Commits `63f73d2` (discovery), `45a4e2c` (plan), `9c34c60`, `eb31899`, `1c49f07`, `1d631f4`, `eb2511e`, `2516a0d`, `6752bf7`, `8bc614a`, `6af378e` (9 feature commits) + interleaved notes/CF doc commits (`e4ee678`, `e7e19cf`, `487ee59`, `3572e15`, `48529d7`, `f34c02f`, `11be543`, `3999fd8`) + this audit refresh + #4 close-out.
- **Step 9 — Replace `window.location.reload()` in MyAccount.tsx** — Two identical `reload()` calls in `handleSubmit` replaced with `loadProfileData()` + `refreshUserStatus()` + `navigate()` — mirroring `handleUploadDocument`'s existing no-reload pattern in the same file. `window.location.reload()` count across the codebase: 0. Test-coverage decision: `MyAccount.tsx` has zero coverage; adding a single handler test would be arbitrary, deferred to a future scoped MyAccount test suite. Side finding: `toast.success` + `window.confirm` redundancy post-fix is mildly inconsistent UX — not blocking, not filed (commit-body annotation suffices). → Issue #5. Commit `7665ea7` + this audit refresh + #5 close-out.
- **Step 10 — React Query for server state** — `@tanstack/react-query` v5 introduced as the server-state layer for `apps/web`; every hand-rolled `useEffect`+`setState` read became a `useQuery` and every write a `useMutation` with an explicit invalidation graph, leaving Zustand holding only client state (auth/admin session coordination, the cart). Resolves the §3 "No server-state layer" anti-pattern. A single `QueryClient` (`lib/query-client.ts`, defaults `staleTime` 30 s · `gcTime` 5 min · `refetchOnWindowFocus` false · `retry` 1) is provided at the `App.tsx` root; `@tanstack/react-query-devtools` is dev-only (`import.meta.env.DEV`-gated, 0 prod bytes). Each feature grew a `hooks/` directory: a per-feature `queryKeys.ts` factory (hierarchical readonly tuples, `.all` prefix) plus `useQuery`/`useMutation` hooks wrapping the _existing_ data-access path — service methods where a service exists, inline Supabase fetchers where the page called Supabase directly. **Six locked decisions held throughout:** D1 auth/admin Zustand stores stay Zustand; D2 the cart store stays Zustand; D3 no new service abstractions (the D5 notification-bell consolidation the one scoped exception); D4 migration wraps data-access paths, does not restructure them; D5 both notification bells consolidate onto React Query with optimistic mark-read + `onError` rollback (fixes the confirmed mark-read staleness bug); D6 new code lands in the feature that owns the _service_, not the consumer. Invalidate-and-refetch is the default mutation pattern; optimistic-rollback is the D5 bells only. Executed as a 15-commit chain (the 8–12-commit estimate proved low — admin split three ways, campaigns two): Commit 1 install/provider, 2/2b advertiser + profile, 3 events, 4 wallet, 5a/5b/5c1/5c2 screenhost, 6a/6b/6c admin, 7a/7b campaigns, 8 the bells. Methodology carry-forwards CF-13 (per-feature query-key factories; first amendment — bundle `useMutation`s by mutationFn identity; second amendment — hooks created at first-consumer point), CF-14 (every mutation enumerates its invalidation graph with (a) within-session / (b) cross-session-cross-role classification), CF-16 (consumer-side reference-identity discipline) and CF-5-extended (typecheck-drift stash-diff protocol) were formalized — see the Step-8 notes file. Gates across the chain: typecheck flat **51**; lint **357 → 346** (errors flat 339, −11 `exhaustive-deps` warnings from deleted fetch effects); test **98 → 160**; build main gzip **131.47 → 139.60 kB** (one-time React Query runtime), NewCampaign chunk **26.04 → 26.46 kB**; file count **157 → 236**. Two latent findings filed (TBD-Q `OwnerDashboard._alerts`, TBD-S `CampaignDetails` dead fetch); the OwnerScreens missing-persistence cluster confirmed bounded at 3 instances (TBD-O). → Issue #6. Commits `577ca38`, `ed441d6`, `4493536`, `e57c4ba`, `ddfa09e`, `0e14a13`, `ea68b62`, `b28a645`, `bad14ca`, `46f51eb`, `b423af8`, `6aad21c`, `75e217f`, `b7dcd15`, `38f7f8b`, plus the plan doc `d06afc0`, the 7a resume brief `947836b`, and this audit refresh + #6 close-out.
- **Step 11 — `jsx-a11y` + `exhaustive-deps` cleanup** — the last mechanical lint pass. Lint **`346 → 1`** (the residual `1` is `import-x/no-unresolved` on `src/lib/supabase.ts` → `./database.types`, a Phase-1 typed-client prerequisite tracked in #15 — not a frontend-cleanup concern; the post-cleanup lint floor is genuinely 1). Cleared: **282 `jsx-a11y/*` errors**, **71 `no-useless-catch`**, **3 `@typescript-eslint/no-unused-expressions`**, **7 `react-hooks/exhaustive-deps` warnings**. Executed as a plan doc + 5 work commits. **Commit 2** (`cf93647`) — 210 `label-has-associated-control`: a ts-morph codemod (`apps/web/scripts/codemod-label-htmlfor.ts`, TBD-C transient-install precedent) auto-paired 168 `htmlFor`+`id`, demoted 33 caption-only `<label>`→`<span>`, 4 manual `aria-label`, 3 manual ternary/file-input, 8 hand-fixed `SignUpForm`. **Commit 3** (`baa560d`) — 6 `<video>` got `<track kind="captions" />` (`media-has-caption`). **Commit 4** (`c8ff011`) — 24 click-only elements got `role="button"`+`tabIndex={0}`+`onKeyDown` (all-fallback, zero visual change by construction; the two `OwnerRevenue` `role="dialog"` modals kept dialog semantics behind two rule-targeted `eslint-disable` lines referencing TBD-T; one `<article>`→`<div>`). **Commit 5b** (`24427b7`) — 71 `no-useless-catch` unwrapped by a second ts-morph codemod (`codemod-unwrap-useless-try.ts`) + 3 `no-unused-expressions`→`if`-statements; the codemod's first run dropped leading-comment trivia (AST `.getText()` excludes it), losing 13 inside-try `no-explicit-any` `eslint-disable` directives — fixed by slicing the block text verbatim (`getTryBlock().getText()` trimmed of outer braces). **Commit 5** (`5f8dbae`) — 7 `exhaustive-deps` resolved per a per-warning taxonomy (intentional-omission `eslint-disable` for the `NewCampaign` `*Key`-keyed effect, module-scope hoists, dep-array adds). **Six locked decisions (D-A…D-F):** D-A absorb `no-useless-catch`/`no-unused-expressions` as Commit 5b (lint floor 1, not 75); D-B `htmlFor`+`id` default; D-C native `<button>`/`role` default; D-D empty `<track>` over suppression; D-E Commit 2 split allowed; D-F `exhaustive-deps` intentional-omission default for `*Key`-keyed effects. **Commit ordering note:** 5b was reordered _before_ 5 — lint-staged lints the whole staged file, so Commit 5's edits to `NewCampaign.tsx` were blocked by that file's pre-existing `no-useless-catch` errors until 5b's mechanical sweep cleared them; mechanical-cleanup-before-judgment-edit is the general rule (→ §3 methodology, CF-7-adjacent). Gates flat: typecheck **51**, test **160**; build main gzip **139.60 → 139.58**. → Issue #9. Commits `0debf0e` (plan), `cf93647`, `baa560d`, `c8ff011`, `24427b7`, `5f8dbae`, plus this audit refresh + #9 close-out. Methodology refinements (codemod trivia-preservation, lint-rule sub-class classification, strategy/verification-capability coupling → **CF-17**) recorded in the Step 11 plan doc closeout and the Step-8 notes file.

- **Step 12 — Tailwind `brand` token + brand refresh** — both the tokenization and the brand-colour change. The legacy teal `#00B3A6` is replaced by the new TOODOOH palette (Algae Green `#76E6AB`, Plantation `#204B43`, Portage `#9195F8`) and every brand-colour site is consolidated onto **semantic** tokens (`brand-primary` / `brand-deep` / `brand-accent`; D-A). **This step is the documented exception to the cleanup-phase "no user-facing UI/UX change" contract** — the brand refresh _is_ the deliverable; the exception is Step-12-only and does not carry to Steps 13–14. **Scope ballooned far past the plan's "449 sites"** as the inventory discovered the codebase was mid-rebrand: ~740 brand-colour occurrences touched in total — 502 `[#00b3a6]` arbitrary-value classes + 14 non-className `#00B3A6` (SVG/Leaflet/jsPDF/inline-style, literal-in-place per D-1) + a 45-occurrence 5-shade **teal hover/gradient family** + **115 occurrences already on `#76E6AB`** (a previous developer's incomplete hand-rebrand) + an 86-occurrence **6-shade mint family** + 16 contrast fixes. Algae Green is too light for white text (~1.3:1), so every `text-white` on a mint surface became `text-brand-deep` (~5.8:1, WCAG AA) — 57 className sites (Commit 3c) + 14 inline-style + 2 jsPDF (Commit 4c). `#1FC16B` (12 occ — a semantic success-green: ROI values, "Actives" counts, status pills) was deliberately **excluded** as out of brand scope. The dead `leviosa-*` token family (5 colours + `leviosa-gradient` + 7 `@apply` classes, 0 component consumers) was removed in Commit 2 as an atomic unit (a 6/4 split across commits broke the PostCSS `@apply` build — surfaced and corrected at the inventory boundary). **Three locked decisions:** D-A semantic token names; D-B `brand-deep`/`brand-accent` config-only in Step 12 (no component adopts them yet); D-C human visual QA against project-knowledge screenshots gates every push. Executed as a 10-commit chain — all swaps flat `sed` (D-3), recorded in commit bodies as audit record, no preserved script. Gates flat throughout: typecheck **51**, test **160**; build main gzip **139.60 → 139.80**. → Issue #10. Commits `4299c9c` (plan), `3ee3a8b`, `dc0d545`, `5d2e3a4`, `d3146a1`, `a955f75`, `e896b88`, `ec8e267`, `40d65c4`, plus this audit refresh + #10 close-out. Methodology: **CF-18** — token-tokenization inventory must grep three axes (neighbourhood / representation / source-target) across two phases (inventory / fix); five worked examples and the three-axis form recorded in the Step-8 notes file. The CF-7 gate-sweep-flow push policy held across all 9 work commits (mechanical and judgment-density alike).

- **Step 13 — Get CI green** — `.github/workflows/ci.yml`'s `verify` job now runs all **four gates** on every push to `main` and every PR, and `main` is **green** for the first time since the workflow landed. The cleanup-phase no-UI-change contract resumed — Step 13 is infrastructure-only, no source touched (gates flat: typecheck **51**, lint **1**, test **160**, build main gzip **139.80**). The crux: two of the four gates carry **accepted, deferred baselines** — 51 typecheck errors (Cat-A untyped-root cascades) and 1 lint error (`import-x/no-unresolved` on `supabase.ts`), both blocked on the Phase-1 Supabase typed client (#15). A naïve "make `tsc` exit 0" is impossible (`@ts-ignore` is forbidden; the 51 genuinely need the typed client). So CI verifies **"no regression past the committed baseline", not "exit 0"**: the Typecheck and Lint steps are **baseline-gated** — each runs the tool, counts errors, **fails only when the count exceeds the inline baseline** (`TYPECHECK_BASELINE=51` / `LINT_BASELINE=1`, both commented with the #15 reference), and emits a non-failing `::notice::` when the count drops _below_ baseline (prompting a manual ratchet-down of the constant; CI never self-commits). When #15 lands, both baselines ratchet to 0. Test and Build run plain (exit-0). Also: Node pinned `20 → 20.20.2` exact (`.nvmrc` parity); the build gate was added (it had been absent — the build gate verifies _compilation_, not runtime correctness, which needs deployment infrastructure). `tsc`'s 51 errors still surface as GitHub annotations — informational only, the run is green. → Issue #11. Commits `407c68f` (plan), `d7e52ff` (ci.yml gate rewrite), plus this audit refresh + #11 close-out. Methodology: _baseline-as-ceiling CI gating_ (a cleanup phase handing off to CI before all debt is cleared gates on the committed baseline, not zero) and a _CI-diagnosis discipline_ note (confirm a CI run's `headSha` matches the commit under diagnosis before reading its log — a mid-step recovery was drafted against the wrong run's log) — both recorded in the Step-8 notes file.

- **Step 14 — Hoist duplicate devDependencies to root** — the cleanup phase's **final step**. `apps/web/package.json` `devDependencies` went **18 → 11**: 6 exact duplicates of root devDeps (`@eslint/js`, `eslint`, `eslint-plugin-react-hooks`, `globals`, `typescript`, `typescript-eslint`) removed — root keeps them — and 1 dead dep (`eslint-plugin-react-refresh`, confirmed 0 consumers, not loaded by the ESLint flat config) removed outright. Root `package.json` untouched. The 6 duplicates carried apparent version drift (`apps/web` ranges older than root — a Step-8 partial-migration artifact: the monorepo restructure added the root tooling without pruning the pre-monorepo `apps/web` copies), but `pnpm-lock.yaml` had already deduped both importers to one resolved version each — so removing the `apps/web` declarations changed **zero** resolved versions. Verified: the lockfile regen was **30 deletions / 0 additions / 0 version-node changes** (the `apps/web` importer block lost 7 entries; `eslint-plugin-react-refresh@0.4.26` left the tree). `apps/web` tooling (`tsc`/`eslint`/`vitest`) now resolves the hoisted deps from root via pnpm's upward `node_modules` resolution — confirmed, all gates flat (typecheck **51**, lint **1**, test **160**, build main gzip **139.80**) and CI green. Cleanup-phase no-UI-change contract held. → Issue #13. Commits `d9f59bd` (plan), `3db8aec` (hoist + lockfile), plus this audit refresh + #13 close-out. Methodology: a **CF-18 Axis-3 worked example at the dependency layer** — declared versions vs lockfile-resolved versions diverge when a partial migration leaves stale declarations; the lockfile is the source of truth for actual versions. Recorded in the Step-8 notes file.

- **TBD-C — `@/*` path alias + 517-import sweep (issue #24).** `tsconfig.app.json` + `vite.config.ts` add `@/*` → `./src/*` mapping (commit `412912e`). A ts-morph codemod rewrites 517 cross-directory imports across 114 files (commit `5ecd223`, with the codemod script preserved at `apps/web/scripts/codemod-add-path-aliases.ts` as audit record; ts-morph itself uninstalled post-sweep — the script's ts-morph import carries an `eslint-disable-next-line` annotation documenting the intentional absence). Closure doc this commit. Refined alias rule: resolved-target-different-directory → alias. ESLint resolver picks up tsconfig paths automatically. Lint baseline: 358 → 357 (TBD-C net −1, from NewCampaign `import-x/order` cleared by alias work; codemod script's ts-morph import suppressed via `eslint-disable` annotation, not counted in baseline). NewCampaign chunk gzip 25.76 → 26.04 (+0.28, within ±0.5 tolerance). → Issue #24. Commits `412912e` (config), `fee386d` (notes), `5ecd223` (sweep), plus this audit refresh + #24 close-out.

- **Phase 1a — Backend foundation** — `apps/api/` scaffold + env validation + pino logger + `/health` + error handler + Drizzle + local Postgres via Docker + migration runner. The first feature-building phase (cleanup phase + P0a/P0b were preparation); `apps/api/` stands up from an empty workspace slot to a bootable Fastify service with a validated DB connection. Three implementation commits: `d723ae6` (scaffold — Fastify v5, exact-pinned toolchain), `326d39b` (env validation via zod + pino logger + `/health` + shaped error/not-found handlers), `4a5289a` (Drizzle client + Dockerized Postgres 16/PostGIS 3.4 + migration runner installing the `postgis` extension + `/health` DB-ping with `ok`/`degraded`). Gate floors **post-Phase-1a**: root typecheck **51** / lint **1** / test **170** / build `apps/web` **139.80 kB** gzip; `apps/api` per-package typecheck **0** / lint **0** / test **10** / build success. Carry-forwards: **CF-19** promoted (exact-pin discipline), **CF-20** promoted (test-tooling tsconfig split), **CF-21** parked candidate (eager-singleton env shim) — see §7.4. Plan docs: `2026-05-20-phase-1a-commit-1-api-scaffold.md` (`d0dbc22`), `2026-05-20-phase-1a-commit-2-env-logger-health-errors.md` (`7e8d4f4`), `2026-05-20-phase-1a-commit-3-drizzle-postgres-docker.md` (`56c26d7`). Plan docs' §9 sections are the canonical CF-19/20/21 write-up home. Phase 1a was direct feature work, not a tracked-issue fix (no `→ Issue`). Commits `d723ae6`, `326d39b`, `4a5289a`, plus the three plan-doc commits above and this audit refresh.

- **Phase 1b — Auth foundation** — the single `users` table + better-auth integration + signup endpoint + OVH SMTP email verification. Six commits across four units: `d59bf75` (single `users` table — the dual-identity collapse — + `promote-to-admin` script + initial migration), `1648159` (better-auth integration — `accounts`/`sessions`/`verifications` tables + Fastify catch-all `/auth/*` plugin + `AUTH_SECRET` env + `role`/`status` `input:false` to block signup self-elevation), `927d61b` (`POST /api/signup` wrapping `auth.api.signUpEmail` server-side — anti-enumeration on duplicate email, `tax_number` 409 pre-check, business fields registered as additionalFields, orphan-rollback for better-auth's non-atomic signup — plus the first real-Postgres integration tests + a CI Postgres service container), `249fc87`→`4ab1229` (OVH SMTP email send via nodemailer + an `EmailSender` abstraction + a brand-aligned, role-aware French verification template; `249fc87` failed CI on a lockfile-sync miss — `pnpm-lock.yaml` dropped from `git add` against §10 policy, caught by `pnpm install --frozen-lockfile` — fixed forward at `4ab1229`, `main` not rewritten). Real send verified end-to-end (OVH-to-OVH + OVH-to-Gmail, spf/dkim/dmarc pass, JWT verification flips `email_verified`); Gmail spam-landing is new-domain reputation, not auth (domain warm-up carried to Phase 1g, along with the production `BETTER_AUTH_URL` and the Phase-1e verification `callbackURL`). Gate floors **post-Phase-1b**: root typecheck **51** / lint **1** / test **200** / build `apps/web` **139.80 kB** gzip; `apps/api` per-package typecheck **0** / lint **0** / test **40** / build success. Carry-forwards: **CF-21 promoted** (eager-singleton env shim, + the CF-21a/b runtime-shim-vs-typed-literal sub-pattern), **CF-22 promoted** (literal-vs-spirit surface-and-ratify), **CF-23 promoted** (two-layer library verification) — see §7.4. Plan docs: `d907e05`, `367c73d`, `9c9faf2`, `333b68f` (their §9 sections are the canonical CF write-up home). Phase 1b was direct feature work (no `→ Issue`). Closes 2026-05-22. Commits `d59bf75`, `1648159`, `927d61b`, `249fc87`, `4ab1229`, plus the four plan-doc commits above and this audit refresh.

- **Phase 1c — Onboarding-data + profile edits + document storage** — the screenhost's business-profile data, the profile-edit surface, and document storage. Five feature commits: `9e9d716` (9 onboarding columns on `users` + the `governorates`/`business_sectors`/`predefined_zones` reference tables with legacy-verbatim seeds — migration 0003; the `owner_business_sectors` view folded into `business_sectors.audience='owner'`), `46649d8` (MinIO container + the `StorageProvider` abstraction + S3-compatible client — shaped `{key|error}` results, private bucket + presigned-GET access, columns hold the object KEY not a URL), `a821789` (the reusable `requireAuth` session-guard preHandler + `PATCH /api/profile/business` + migration 0004 — `name`→`contact_name` RENAME, the three `notify_*` columns, lenient `tax_number` CHECK), `ed8d273` (`PATCH /api/profile/{contact,address,notifications}` + `fonction`/`zone` columns — migration 0005), `46a56e9` (`POST`+`GET /api/profile/documents/:type` — RNE/CIN upload+retrieve through the StorageProvider, the first multipart endpoint, new dep `@fastify/multipart` 10.0.0 with the lockfile in the same commit). **Architecture pivot:** the DB-side "Model 1" (minimal signup + a separate onboarding gate) was **abandoned for Option B** (combined-registration wizard; no onboarding gate; profile fields edited via section-scoped PATCH endpoints; Commit 3's endpoint reframed as an _edit_ surface, not a required gate) — the reversal forced by the frontend-contract audit (`faed78d`, `docs/handoff/frontend-backend-contract.md` §7), the first worked CF-24 instance. The Commit-3 guard is the auth foundation every later authenticated endpoint reuses — proven across 7 endpoints in Commits 3-5 (only session _validation_; session _creation_ is the Phase-1d boundary). Gate floors **post-Phase-1c**: root typecheck **51** / lint **1** / test **259** / build `apps/web` **139.80 kB** gzip; `apps/api` per-package typecheck **0** / lint **0** / test **99** / build success (entered post-1b at `apps/api` **40** / root **200**; the +59 is all `apps/api` integration tests — `apps/web` held at 160). Carry-forwards: **CF-24 FORMALIZED** (frontend contract authoritative for endpoint shape; backend conforms except security/integrity exceptions); **CF-19/21/22/23 instances accumulated** across the phase — see §7.4. The `apps/api` suite was **serialized** (`fileParallelism:false`, Commit 3) with shared-pool teardown at a file-level `afterAll` (Commit 4) — §7.6. Plan docs: `9b24404`, `230cfa5`, `27dc500`, `8389783`, `db46f2c` (their §9 sections + `frontend-backend-contract.md` are the canonical CF-24/19/21/22/23 write-up home). Phase 1c was direct feature work (no `→ Issue`). **Phase-1e carry-forwards:** signup-route `tax_number` required→optional (the schema column is already nullable — only the signup zod enforces required); FE phone normalize-at-repoint (un-normalized owner phone would 400 against the backend E.164 validator); FE `updateProfile` single-method splits by section; FE documents add the `type` discriminator + swap `supabase.storage`→this API. Closes 2026-05-24. Commits `9e9d716`, `46649d8`, `a821789`, `ed8d273`, `46a56e9`, plus `faed78d` (the mid-phase contract audit) + the five plan-doc commits above and this audit refresh.

- **Phase 1d — Session auth (sign-in/out + password management)** — the session-creation surface completing server-side auth. Two feature commits: `e9ee9a5` (`POST /api/signin` — better-auth `signInEmail` wrapped + shaped to the FE routing response [role/status/`onboarding_completed`/`profile_type` reconstruction], a 403 verify-first branch, generic-401 anti-enumeration; `POST /api/signout`; the **real-cookie round-trip** — sign-in mints a real session cookie, replayed through the Commit-3 `requireAuth` guard to a `PATCH`, closing the session-creation boundary Commit 3 left open with only a mocked session), `aa8121d` (password management — `POST /api/password/{reset-request,reset,change}`: better-auth `requestPasswordReset`/`resetPassword`/`changePassword` wrapped + shaped, a new French reset-email template routed through the existing `EmailSender`/OVH SMTP via a never-throw `sendResetPassword` hook, anti-enumeration on reset-request, and session invalidation on both reset [`revokeSessionsOnPasswordReset`] and change [`revokeOtherSessions` — the current device survives via the refreshed cookie]). With it the session-auth surface is complete server-side: signup → verify → signin → authenticated requests → signout → password reset → change. **The shortest feature phase** — better-auth owned the session machinery; the work was wrap-and-shape, not build. Gate floors **post-Phase-1d**: root typecheck **51** / lint **1** / test **282** / build `apps/web` **139.80 kB** gzip; `apps/api` per-package typecheck **0** / lint **0** / test **122** / build success (entered post-1c at `apps/api` **99** / root **259**; the +23 is all `apps/api` — signin +11, password +12; `apps/web` held at 160). **No new formal CF** (CF-19–24 all already formal); CF-23/24 instances accumulated, CF-21 clean — see §7.4. The strongest CF-23 instance: **the reset-token-is-a-verifications-row finding** — password reset uses a random-token `verifications` row, the OPPOSITE of email-verify's stateless JWT; the Commit-3-class "assume same-as-verification" trap was AVOIDED by source-reading at plan-write, then execution-confirmed (the test reads the row to drive a real reset). Plan docs: `85dc727` (Commit 1), `94a779c` (Commit 2) — their §9 sections + `frontend-backend-contract.md` §3.5/§3.6 are the canonical CF write-up home. Phase 1d was direct feature work (no `→ Issue`). **Phase-1e carry-forwards:** FE signin repoint + routing-field consumption + verify-first (403) + generic-credentials handling; FE password reset/change repoint + 12-char floor convergence + the reset-page `callbackURL` (joining the verification `callbackURL`). Closes 2026-05-25. Commits `e9ee9a5`, `aa8121d`, plus the two plan-doc commits above and this audit refresh.

- **Phase 1e Part A — Backend prerequisites (browser-reachability + signup-grows + reference data)** — the backend half of the frontend-repoint work: making `apps/api` reachable from a browser, growing signup to the full wizard profile, and exposing the reference-data the forms fetch. Opened by the **frontend repoint survey** (`3d84dd8`, `docs/handoff/frontend-repoint-survey.md`) whose §8 **split "Phase 1e = frontend repoint" into Phase 1e = backend prerequisites (this) + Phase 1f = frontend repoint** (pushing admin→1g, deployment→1h — see §16 for the renumbering reconciliation vs the older "1e=frontend" references in §13/§15). Three feature commits: `7a71eb3` (browser-reachable API — `@fastify/cors@11.2.0` + better-auth `trustedOrigins:[WEB_ORIGIN]` + `advanced.disableOriginCheck:false` + a Vite same-origin dev proxy + `WEB_ORIGIN` env; **`GET /api/me`** the cookie-authenticated full self-view the FE store rehydrates from; `toProfileType` extracted to `lib/profile-type.ts`), `a63b50d` (**signup-grows** — `POST /api/signup` accepts the full wizard profile; `profile_type→role(+business_type=agency)` mapped server-side via a duplicate-safe post-create `db.update` [role stays `input:false`]; `tax_number` required→optional; new columns `agent_code` + `terms_accepted_at` [migration 0006]; `name`→`contact_name` wire; owner-extras `.strip()`'d; terms backend-enforced 400-if-not-accepted), `30c28cf` (**reference-data GETs** — public `GET /api/governorates` + `GET /api/business-sectors?audience=advertiser|owner`, the latter consuming the Phase-1c `audience` discriminator [the §5.3 `owner_business_sectors` collapse]; `company_size_options` ruled OUT — fetched but no table + collect-and-ignore field, the dead-infrastructure-avoided call). Gate floors **post-Phase-1e-Part-A**: root typecheck **51** / lint **1** / test **306** / build `apps/web` **139.80 kB** gzip; `apps/api` per-package typecheck **0** / lint **0** / test **146** / build success (entered post-1d at `apps/api` **122** / root **282**; the +24 is all `apps/api` — Commit 1 +8, Commit 2 +10, Commit 3 +6; **`apps/web` held at 160 — Part A is backend-only**, so the long-flat 51/1/139.80 `apps/web` floors are untouched; Phase 1f is the first to move them). **No new formal CF** (CF-19–24 all already formal); **CF-23 taxonomy completed** (four named sub-classes of right-looking-but-wrong source-reads, all caught by execution — see §7.4), **CF-24 instances** (truthful-to-frontend: `/api/me` self-view, signup wire-truthfulness, reference GETs built only for fetched categories), **CF-21 instance** (`WEB_ORIGIN` defaulted-var cascade). Plan docs: `e58a6c8` (Commit 1), `64a582e`+`ab668b0` (Commit 2 plan + rulings-finalize), `615067b` (Commit 3) — their §11 sections + the survey are the canonical write-up home. Phase 1e Part A was direct feature work (no `→ Issue`). **Phase-1f carry-forwards** (the frontend repoint — now substantial; full list §16): `auth.service.ts`→an API client (cookie + `/api/me` identity, `credentials:'include'`, the same-origin proxy); the signin/signup/profile/documents/password repoints; `useSectors`/`useOwnerBusinessSectors`→`?audience=`, `useGovernorates`→`GET /api/governorates`; the advertiser `company_size` dropdown hardcodes (§2.C); the verify-email + reset pages; the 12-char + anti-enum + verify-first FE changes. Closes 2026-05-25. Commits `7a71eb3`, `a63b50d`, `30c28cf`, plus `3d84dd8` (survey) + the four plan-doc commits above and this audit refresh.

- **Phase 1f — Frontend repoint (`apps/web` → `apps/api`)** — the largest phase of the project: every user-facing flow rewired off Supabase onto the apps/api backend the four prior phases shipped. Ten commits (keystone + seven per-flow repoints + two cleanup commits), each CI-green; the per-flow arc K → F1 → F2 → F3 → F4a → F4b → F5 → F6 → F7a → F7b. Opened by the **keystone design read** (`5d46b48`, `docs/handoff/phase-1f-keystone-design.md` — the source-driven design of the api-client + the auth-store session model + the 10 D-rulings D1-D10 every per-flow commit consumes). Keystone (`0c9826a`): `lib/api-client.ts` (typed `fetch` singleton, base `/api` via same-origin proxy, `credentials:'include'`, the two-error-shape normalizer `ApiError` with `code` read from `body.error`); `lib/auth-errors.ts` (`apiErrorMessage` code→French, the `mapAuthError` successor); auth-store rewrite (`{id,email}` user shape per D4, `/api/me` rehydration per D3 fetch-authoritative + cushion-only persist, status→`pending|approved|rejected` per D5, the 401-mid-session shared-clear per D6); session methods rewired (`login`→`POST /api/signin` populate-from-response, `logout`→`POST /api/signout`, `getCurrentUser`→`GET /api/me`); `LoginForm` 403 verify-first branch; three anti-enum/Supabase-hack methods deleted (`checkSignupConflicts`, `ensureBusinessProfileExists`, `createDefaultProfile`). The 30 importer files of `useAuthStore` + the 16 of `authService` are untouched by construction — the centralize-first premise (survey §1.4) held. **F1 reference reads** (`2935697`): `useSectors`/`useOwnerBusinessSectors`→`/api/business-sectors?audience=`, `useGovernorates`→`/api/governorates`; advertiser `company_size` hardcoded inline (D8); support_objectives left on Supabase (D8 later-slice); the `owner_business_sectors` no-remap (the endpoint returns `{id,name}` directly). **F2 signup wizard** (`ee67d7d`, the largest single file in the project at ~1940 lines): the wizard sends the grown profile to `POST /api/signup`; the blur-RPC `check_signup_conflicts_secure` (the email-enumeration disclosure) is removed; 12-char password floor with upper/lower/digit (matching the backend); `profile_type` becomes a non-privileged hint; owner-extras collected-but-`.strip()`'d server-side; 201-generic consumed. **F3 verify-email page + callbackURL** (`aa72b37`, **cross-package**): new `apps/web/src/features/auth/pages/VerifyEmail.tsx` consuming better-auth's redirect (`/verify-email?token=...&callbackURL=...&error=...`); apps/api `auth.ts` adds `emailVerification.sendOnSignIn=true` (B′ — the deliberate Phase-1d behavior change: unverified-signin now resends the verification email, enabling the verify-page's error CTA recovery loop); apps/api `signup.ts` passes absolute `callbackURL=${WEB_ORIGIN}/verify-email` to `signUpEmail`; signup.test Q8 extended to assert the verify link carries the callback. **F4a profile advertiser** (`b320f4c`): `UserProfile`'s 4 sub-section saves rewired to the 4 PATCHes (`/api/profile/{contact,business,address,notifications}`); the read-bridge — no `GET /api/profile` exists (it couldn't supply the deferred logo/bank fields anyway), so `getBusinessProfile` reads `/api/me` and maps to `BusinessProfile` (notifications nested→flat, status→verification_status); per-field null handling (`||undefined` for uuid optionals to clear via JSON-drop, `||null` for nullable text fields); the `mapAuthError`→`apiErrorMessage` retarget pattern. **F4b profile owner** (`30c684b`): the parallel OwnerSettings repoint reusing F4a's tested service methods; owner-extras (screens/rooms/company_size) `.strip()`'d functionally — the inputs render and the wire carries them, but slice 1 doesn't persist (forward-compat for the owner slice). **F5 documents** (`c3dfe6d`): the multipart upload moves to `POST /api/profile/documents/:type` (rne|cin discriminator); the GET presigns on-demand and never stores the URL; the upload **flow-position moved** from signup (where the user is unverified+logged-out and can't call `requireAuth`) to post-signin, with both pages exposing the upload control through the section-tab; remove disabled with caption (D-F5-3) — the dead remove-path was severed at F7b. **F6 password domain** (`b5e15cd`): all three flows wired — `/password/reset-request` (anti-enum already correct, no oracle), the new `/update-password` reset-landing page consuming `?token=`/`?error=` via `confirmPasswordReset(token,new)`, and `/password/change` for the with-old change. 12-char convergence (`isValidPassword`/`passwordChecks` from `utils/password.ts`); 6-char service guard dropped (`updatePassword` deleted); owner special-char dropped. **MyAccount no-old password change** removed at source (D-F6-5a — the only way to honor the backend's re-auth requirement). UpdatePasswordForm restyled to the light auth-form pattern. **F7a independent cleanup** (`38c3dab`): the three zero-caller `auth.service` methods removed (`getCompanySizeOptions`, `getSupportObjectivesForAdvertiserAgency`, `getSupportObjectivesForOwners`) + the orphaned `CompanySizeOption` type; MyAccount.tsx (848-line hidden duplicate page) consolidated/deleted — fully covered by OwnerSettings, no nav link to it (`/my-account` was reachable only by URL, the OwnerDashboard CTA was `className="hidden ... aria-hidden"`). **F7b deferred-control wirings + cascade removals** (`737b43f`): the caption-vs-wire fix — the per-flow rulings D-F4-4 (logo) + D-F5-3 (doc-remove) named UX defers but only **captioned** them ("Bientôt disponible" beside still-live buttons + handlers + Supabase chains); F7b actually **severs** the wirings (logo controls statically disabled with placeholder slot; doc-remove dead else-branch gone, local-pick-clear preserved). **Deactivation control disabled** (D-F7-2, new) — pre-K the form re-auth-confirmed via `supabase.auth.signInWithPassword` before destroying the account; post-K the Supabase auth store is no longer the password source so the gate became a broken no-op (rejects every password) — a **class-(b) security finding** closed defensively with a static "coming soon + contact `support@too-dooh.com`" message until the backend `POST /api/account/deactivate` ships. **Cascade** (verify-dead-at-execution): post-wiring re-grep proved updateProfile=0/deactivateAccount=0/signInWithPassword=1 (admin only, Phase-1g out-of-scope) — `authService.updateProfile` + `authService.deactivateAccount` removed; re-grep proved mapAuthError=0 — the 157-line any-typed function removed (its branches were Supabase-error-string heuristics no longer firing; `apiErrorMessage` handles every live error path). Unused supabase imports dropped from UserProfile/useProfileMutations/useOwnerProfileMutations; the auth.service.ts supabase import STAYS (still used by `updateBusinessProfile` for the wallet slice + `getAppointmentObjectives` per D8); OwnerSettings.tsx supabase import STAYS (bank-doc createSignedUrl, wallet/later-slice); `lib/supabase.ts` STAYS (59 later-slice importers — campaigns/screens/admin/wallet/performances/events). Gate floors **post-Phase-1f**: `apps/web` typecheck **36** / lint **1** / test **217** / build **135.73 kB** gzip; `apps/api` per-package typecheck **0** / lint **0** / test **146** / build success (entered post-1e-Part-A at `apps/web` **51/1/160/139.80**, `apps/api` **146**). The full arc: typecheck **51→36** (-15 — account-layer types resolve; the **last-slice ratchet** will clear the remaining 36 when `supabase.ts` + `database.types` go), test **160→217** (+57 — all `apps/web` node-level: api-client, apiErrorMessage, auth-store with mocked fetch, auth.service.reference/profile/password/signup, password utils, errors; **RTL never stood up — the thin-adapter outcome**, §7.6), build **139.80→135.73 kB** (**-4.07 kB net — the repoint made the app SMALLER**: dead Supabase + the MyAccount/F7b removals exceeded the new pages/client added), lint **1** (held — `database.types` only in `lib/supabase.ts`, clears at last-slice). `apps/api` **146 untouched except F3** (cross-package: F3 added `sendOnSignIn=true` + the `callbackURL` wire + extended Q8 in signup.test — no new test files; the apps/api floor held flat). **No new formal CF** (CF-19–24 all already formal); **three CF refinements promoted** (see §7.4): **CF-25 caption-vs-wire** (a defer/disable ruling is satisfied only when the wiring is severed, not when a caption announces it), **the third dead-UI-detection pattern (attribute-gated unreachability)** complementing setter-to-true + CSS-gated, and **CF-23 instances** across the per-flow source-reads. Operating learnings (see §7.6): the thin-adapter outcome (RTL provisioned-but-never-needed), the read-bridge pattern (`/api/me` as the profile read source), truthful-data over convenience (the empty-optional/null→400 lesson recurring across F2/F4), the sendOnSignIn behavior change recorded, the deactivation class-(b) finding, the named owner-extras functional reduction, the F7b orphaned-consumer learning (grep the consumer-name after a handler removal). The keystone + 9 per-flow scoping/plan docs: `5d46b48` (keystone design), `374fae2` (keystone plan), `71245bb` (F1 plan), `5a80aae` (F2 scoping+plan), `6dd1f02` (F3 scoping+plan), `a78568c` (F4 scoping+F4a plan), `aab9fcb` (F4b scoping+plan), `f0d88ca` (F5 scoping+plan), `d13378b` (F6 scoping+plan), `29b2e87` (F7 scoping+F7a plan), `1a42e0d` (F7b plan) — their §-sections are the canonical CF-25 + caption-vs-wire + read-bridge + thin-adapter write-up home. Phase 1f was direct feature work (no `→ Issue`). **Phase-1g carry-forwards** (admin slice — full list §17): the deactivation backend (`POST /api/account/deactivate` + current_password re-auth, mirroring `/password/change`); the logo storage column + endpoint + control re-enable; the document DELETE endpoint + remove-control re-enable; the owner-extras persistence (screens/rooms/company_size columns + un-strip + re-enable the inputs); company_size reference table+endpoint; WiFi-at-signup wizard field + column + provisioning consumer; the money-slice `assertOrigin ∈ [WEB_ORIGIN]` CSRF gate; the inline-`#76E6AB` styling pass (13 legacy files); the `database.types` lint-1 floor clears with the last Supabase removal; strict tax_number matricule; 2FA. Closes 2026-05-26 (CI-green on `737b43f`); Phase 1f's **record** closes with this audit refresh; the **phase itself** closes after the phase-close human visual QA against the three F7b-disabled controls + the F1-F6 repointed flows end-to-end. Commits `0c9826a` (K), `2935697` (F1), `ee67d7d` (F2), `aa72b37` (F3), `b320f4c` (F4a), `30c684b` (F4b), `c3dfe6d` (F5), `b5e15cd` (F6), `38c3dab` (F7a), `737b43f` (F7b), plus the eleven plan/scoping doc commits above and this audit refresh.

---

## 5. Roadmap

Ordering principle: **decisions & deletions first** (shrink the surface) → **isolate the real IP**
(the DOOH engine) → **bulk mechanical sweeps next** (console-purge, typing pass — done before
decomposition so they run once on the current shape, not twice on the decomposed shape) →
**structural decomposition + restructure** (Dashboard/NewCampaign decomp, then features/<domain>/
folder layout) → **remaining mechanical passes** (jsx-a11y, brand token, tsconfig re-tighten) →
**tidy-up at the end** (CI green, devDeps hoist). Each step gets its own brainstorm → spec →
plan → execute cycle.

| #   | Step                                                                                                                                                           | Touches (roughly)                                                                                                                                                                                          | Done when                                                                                                                                                                                                                                                                                                                                                                                    | Issue | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| 1   | Cleanup audit & roadmap (this doc)                                                                                                                             | `docs/audit.md`, GitHub issues/milestone                                                                                                                                                                   | doc committed; issues created                                                                                                                                                                                                                                                                                                                                                                | —     | ☑      |
| 2a  | Resolve duplicate pages and delete orphans                                                                                                                     | `pages/MyCart.tsx`, `pages/admin/AdminDashboardSimple.tsx` (deletions)                                                                                                                                     | the two genuinely-dead files deleted (zero refs); typecheck/lint/test/build not regressed; the rest of §3's duplicate-page list is Dashboard-coupled → resolved in Step 7                                                                                                                                                                                                                    | #1    | ☑      |
| 2b  | Resolve duplicate services                                                                                                                                     | `services/campaigns.service.ts`, `services/api/screens.api.ts`, `services/api/` (deletions)                                                                                                                | the two dead service files deleted (zero refs); `services/api/` dir removed; typecheck/lint/test/build not regressed; admin-cluster consolidation moved to Step 8 notes                                                                                                                                                                                                                      | #14   | ☑      |
| 3   | Consolidate the auth-state layer                                                                                                                               | `stores/auth.store.ts` (persist + de-localStorage), `services/auth.service.ts` (stateless), `App.tsx` (drop `clearAuthCache` import), `pages/ContactPage.tsx`, delete `utils/clearAuthCache.ts`            | `auth.store.ts` uses `persist`; no `localStorage` in `auth.store.ts`/`auth.service.ts`; `clearAuthCache.ts` deleted; `onAuthStateChange` subscription captured; `ContactPage` on the store; `Dashboard`+`Onboarding`+cart `localStorage` deferred to Step 7; typecheck/lint/test/build not regressed                                                                                         | #2    | ☑      |
| 4   | Decouple DOOH engine's pure math from Supabase (4a) + write the v3.0 pricing model as a tested, unwired pure module (4b). Wiring + schema + UI = Phase 1 (4c). | `apps/web/src/lib/dooh/{config,dates,hourly-plan,v3-model}.ts` + `README.md`; `docs/handoff/pricing-model-v3.md`, `Toodooh_Simulateur_Pricing_v3.html`, `v3-data-requirements.md`                          | `pnpm test` exits 0 (previously-failing `campaign-hourly-location-plan` test passes from `lib/dooh/hourly-plan.test.ts`); `lib/dooh/v3-model.ts` implements the v3.0 model and its tests match the simulator's numeric examples; `lib/dooh/README.md` documents the model + function↔simulator mapping; v3.0 is unwired (build output unchanged); 4c (wiring/schema/UI) tracked for Phase 1. | #12   | ☑      |
| 5   | Frontend logger + `console.*` purge                                                                                                                            | new logger; ~917 call sites; ESLint config                                                                                                                                                                 | 0 `no-console` errors                                                                                                                                                                                                                                                                                                                                                                        | #7    | ☑      |
| 6   | Typing pass: fix `as any`, reduce tsc baseline, re-tighten tsconfig                                                                                            | many files; `tsconfig.app.json`                                                                                                                                                                            | 265 no-any → 0 (134 fixed directly, 131 marked TODO(phase-1) → #15); 161 no-unused-vars → 0; 26 no-empty → 0; typecheck 197 → 66 (66 residue = Cat-A untyped-root cascades, → #15); tsconfig un-softening deferred to Phase 1 with #15; regression cycle P0a-P0d shipped                                                                                                                     | #8    | ☑      |
| 7   | Decompose `Dashboard.tsx` / `NewCampaign.tsx`                                                                                                                  | `pages/Dashboard.tsx` (retired), `pages/NewCampaign.tsx` (4030 → 1624), `App.tsx` routes, `pages/new-campaign/*` (7 step components), `hooks/new-campaign/*` (5 hook+pure-fn files), `lib/wizard-zones.ts` | Dashboard retired, replaced by AdvertiserDashboard + 4 hooks + 6 components; NewCampaign decomposed into wizard-hook + 6 step components + PostCartStep; bundle Dashboard chunk eliminated; new NewCampaign chunk gzip 25.77 kB; 21 new pure-function tests on the wizard serialize/perform layer; 3 follow-up issues (#19/#20/#21). 15 commits over the work session.                       | #3    | ☑      |
| 8   | Restructure `src/` into `src/features/<domain>/`                                                                                                               | almost all of `src/` (142 files moved)                                                                                                                                                                     | 9 feature folders (6 domain + 3 role); imports updated, no orphans; typecheck 58 / lint 364 / test 98 / build green; §2/§3/§5 refreshed; 10 follow-ups filed (TBD-A…J). Merge `6af378e`.                                                                                                                                                                                                     | #4    | ☑      |
| 9   | Replace `window.location.reload()` in `MyAccount.tsx`                                                                                                          | `features/screenhost/pages/MyAccount.tsx`                                                                                                                                                                  | 0 `window.location.reload()` calls; replaced with in-place state refresh + router navigation. Merge `7665ea7`.                                                                                                                                                                                                                                                                               | #5    | ☑      |
| 10  | Introduce React Query for server state                                                                                                                         | new query layer; (post-decomposition) pages                                                                                                                                                                | server data via React Query; Zustand limited to client state. 15-commit chain `577ca38`…`38f7f8b` (committed direct to `main`, no merge commit). See §4 "Step 10" for the full record.                                                                                                                                                                                                       | #6    | ☑      |
| 11  | `jsx-a11y` + `exhaustive-deps` cleanup                                                                                                                         | many `.tsx` files; 2 ts-morph codemod scripts                                                                                                                                                              | 0 `jsx-a11y/*` errors; 0 `exhaustive-deps` warnings; `no-useless-catch` (71) + `no-unused-expressions` (3) absorbed as Commit 5b. Lint `346 → 1` (floor = the Phase-1 `import-x/no-unresolved`, #15). Plan `0debf0e` + commits `cf93647`, `baa560d`, `c8ff011`, `24427b7`, `5f8dbae` (direct to `main`, no merge commit). See §4 "Step 11".                                                  | #9    | ☑      |
| 12  | Tailwind `brand` token: replace hardcoded `#00B3A6` + brand refresh                                                                                            | `tailwind.config.js`; ~740 brand-colour sites                                                                                                                                                              | semantic `brand-primary`/`brand-deep`/`brand-accent` tokens; 0 hardcoded `#00B3A6`; legacy teal replaced by the new TOODOOH palette; mid-rebrand `#76E6AB` + mint shade-family consolidated; `text-brand-deep` contrast pass. 10-commit chain `4299c9c`…`40d65c4` (direct to `main`). Documented exception to the no-UI-change contract. See §4 "Step 12".                                   | #10   | ☑      |
| 13  | Get CI green                                                                                                                                                   | `.github/workflows/ci.yml`                                                                                                                                                                                 | CI green on `main` — `verify` job runs 4 gates (typecheck + lint baseline-gated for the #15-deferred 51/1 debt; test + build plain); Node pinned 20.20.2; build gate added. 3-commit chain `407c68f`/`d7e52ff`/audit-refresh. See §4 "Step 13".                                                                                                                                              | #11   | ☑      |
| 14  | Hoist duplicate devDependencies to root                                                                                                                        | `apps/web/package.json`, root `package.json`                                                                                                                                                               | `apps/web` devDeps `18 → 11` — 6 duplicates hoisted to root-only, dead `eslint-plugin-react-refresh` removed; `pnpm-lock.yaml` regen = 30 deletions / 0 version changes; `pnpm install` clean. 3-commit chain `d9f59bd`/`3db8aec`/audit-refresh. See §4 "Step 14".                                                                                                                           | #13   | ☑      |

---

## 6. Maintenance

When a roadmap step lands:

1. Tick its box in the Roadmap table (`☐` → `☑`) and add the merge commit.
2. Close its GitHub issue (link the commit / PR).
3. Move its anti-pattern subsection's findings into **§4 Already resolved** (or trim them).
4. Refresh the **§2 Snapshot** numbers.

The milestone is **Frontend cleanup phase**; all step issues carry the `cleanup` label plus an
`area:*` label.

---

## 7. Cleanup phase — closing summary

_All 14 roadmap rows are ☑ as of `3db8aec` (2026-05-19). This section closes the
cleanup phase. (Section numbering: these phase-exit sections are §7–§10 — the natural
continuation of §1–§6; the Step-14 brief sketched them as "§10–§13", corrected here to
avoid a numbering gap.)_

### 7.1 — What the 14 steps accomplished

The codebase **entered** cleanup as an inherited single-package Supabase frontend with
no monorepo structure, no test suite, no CI, a typing/lint baseline in the hundreds, a
flat `pages/`+`components/`+`services/` layout, ~447+ hardcoded brand-colour sites,
God-component pages (`Dashboard.tsx` 2635 lines, `NewCampaign.tsx` 4030 lines), a
~950-line auth service, and `console.*` / `window.location.reload()` / dual-auth-store
anti-patterns throughout.

It **exits** cleanup with: a pnpm monorepo (`apps/web` + room for `apps/api` /
`apps/player-api` / `packages/shared`); a feature-folder layout
(`src/features/<domain|role>/`); React Query for server state + Zustand for client
state; 160 passing tests across 21 suites; **CI green on `main`** (4 gates,
baseline-gated); brand colours on semantic Tailwind tokens; `Dashboard.tsx` retired and
`NewCampaign.tsx` decomposed 4030 → ~1600 lines; the DOOH pricing IP isolated as a pure,
portable module. typecheck **51** and lint **1** remain — both accepted, both blocked on
the Phase-1 Supabase typed client (#15), both ratchet to 0 when it lands.

The work is **structural preparation for backend replacement**, not feature work.

### 7.2 — What the cleanup phase did NOT do

It did not touch the Supabase backend, deploy to any environment, redesign the UI
(Step 12 re-skinned to locked brand colours but changed no layout/flow), or write
product features. Known residue — simulated revenue data, missing-persistence clusters,
the storage-service abstraction — is filed as TBDs (§8), not fixed. All of that is
Phase-1 scope.

### 7.3 — The two contracts that held

- **No user-facing UI/UX change** — held in 13 of 14 steps. Step 12 (brand refresh) was
  the single _documented_ exception: the brand-colour change _was_ the deliverable,
  applied uniformly per the locked brand guidelines.
- **No gate regression** — held throughout. typecheck, lint, test, build counts moved
  only monotonically toward their floor; every commit ended green.

### 7.4 — Methodology: CF-1…CF-23 + the Step-13 notes

The carry-forward rules (`CF-1…CF-18`) and the Step-13 CI-gating notes accumulated in
the **Step-8 notes file** (`docs/superpowers/plans/2026-05-15-step-8-notes.md`) — that
file is their canonical home and the operating manual for structurally-similar Phase-1
work. Headline rules: CF-1…CF-9 inventory/pause/halt/commit discipline · CF-10 drift
verification at session boundaries · CF-11…CF-16 per-step methodology growth (sed/AST
sweeps, query-key factories, invalidation graphs) · **CF-17** couple the conversion
strategy to the available verification capability (Step 11) · **CF-18** token-tokenization
inventory walks three axes (neighbourhood / representation / source-target) across two
phases (inventory / fix) — five worked examples, extended at Step 14 to the dependency
layer · **Step-13 notes** baseline-as-ceiling CI gating, `headSha`-verification before
CI diagnosis, output-parse fragility.

Phase 1a added three more (their canonical write-ups live in the **Phase-1a plan docs'
§9 sections**, the same "audit summarizes, canonical home elsewhere" precedent this
section uses for the Step-8 notes file):

- **CF-19** — exact-pin discipline for every `apps/api/package.json` dependency and
  devDependency (no caret, no tilde; floating versions are a CF-18 source/target drift
  vector). Three worked examples across Phase-1a Commits 1.1, 2.1, 3.1. Canonical
  write-up in the three Phase-1a plan docs' §9
  (`2026-05-20-phase-1a-commit-1-api-scaffold.md` `d0dbc22`,
  `2026-05-20-phase-1a-commit-2-env-logger-health-errors.md` `7e8d4f4`,
  `2026-05-20-phase-1a-commit-3-drizzle-postgres-docker.md` `56c26d7`).
- **CF-20** — test-tooling tsconfig split: the test-side `tsconfig.test.json` extends the
  build `tsconfig.json` and adds test-adjacent paths (`tests/`, `scripts/`, app-root
  config files) to its `include`, while the build tsconfig stays `rootDir`-strict for
  `tsc` emit. Two worked examples (Commit 2.1 introduction, Commit 3.1 refinement
  extending `include` to `scripts/` + `drizzle.config.ts`). Canonical write-up in the
  Commit 2.1 + 3.1 plan docs' §9.
- **CF-21** — parked at Phase 1a (single instance); **PROMOTED at Phase 1b** — full
  entry in the Phase-1b block below.

Phase 1b promoted three carry-forward rules to formal CFs, each having earned
worked-example coverage across the phase (canonical write-ups in the **Phase-1b plan
docs' §9 sections** — same "audit summarizes, canonical home elsewhere" precedent):

- **CF-21 — PROMOTED.** Eager-singleton env shim via test-env injection. When `env` is
  an eager-validated singleton, every test importing anything that transitively imports
  `env` must satisfy `env`'s schema at module load — inject required vars via the
  test-env shim, never by making `env` lazy (lazy `env` defeats fast-fail-at-boot).
  **Sub-pattern CF-21a/b:** runtime shims (`vitest.config` `test.env`, `parseEnv` test
  calls) need only the REQUIRED vars (defaults cover the rest); typed `Env` literals
  (inline `Env` objects in tests) need ALL vars, because TypeScript enforces the full
  type regardless of runtime defaults. Six worked instances — Phase-1a Commit 3.1 +
  Phase-1b Commits 2.1 / 3.1 / 4.1.
- **CF-22 — PROMOTED.** Literal-instruction-vs-spirit conflicts get surfaced via
  executor judgment with architect ratification: when a literal prompt step would
  produce work conflicting with the work's actual structure, library invariants, or
  system constraints, the executor (a) picks the semantically right interpretation or
  surfaces alternatives, (b) flags the deviation in the CF-9 pause with reasoning,
  (c) waits for ratification. Surfacing is the load-bearing step — the executor does
  not unilaterally rescope. Seven worked instances: P0a non-destructive git read,
  P0b 44→41 column count, P0b §11→§12 structural, Phase-1b Commit 1 four-question UI
  surfacing, Commit 2 F1 (verifications table missing) + F2 (input:false security),
  Commit 3 F1 (EMAIL_TAKEN anti-enumeration) + F2 (raw-route bypass) + F3 (atomicity
  premise), Commit 4 F1 (ethereal CI-network incompatibility) + F2 (hook-never-throw).
- **CF-23 — PROMOTED.** Verify the integrating library's actual behavior before locking
  decisions that depend on it — and verify at BOTH layers: plan-write (Context7 / docs /
  installed-source reading) AND execution-time (integration-test behavior). Plan-write
  verification is necessary but not sufficient; execution-time behavior catches truths
  source-reading misses. Four worked instances: Commit 1 (better-auth `users` schema
  column verification), Commit 2 (account/session/verifications schema + input:false
  security via source), Commit 3 (`signUpEmail` anti-enumeration + sequential-writes via
  source, then the JWT-not-row truth via execution-time testing — the two-layer
  discipline demonstrated cleanly: source said one thing about verification storage,
  execution revealed a stateless JWT), Commit 4 (hook-await-vs-orphan-rollback
  cross-commit interaction via source).

Phase 1c formalized one new CF and accumulated worked instances of four existing
ones (canonical write-ups in the **Phase-1c plan docs' §9 sections** +
`docs/handoff/frontend-backend-contract.md` — same "audit summarizes, canonical
home elsewhere" precedent):

- **CF-24 — FORMALIZED.** The frontend contract is authoritative for endpoint
  shape, field naming, and flow; the backend conforms, EXCEPT where the backend is
  deliberately correct on security/integrity grounds (class (b)). Where they
  differ, the executor surfaces per-case and the architect rules: **(a)
  backend-conforms** [the default — casing, missing columns, extra collected
  fields], **(b) frontend-changes** [the security exception — anti-enumeration,
  password floors, privilege fields], or **load-bearing** [a tension needing an
  architecture decision]. Canonical home:
  `docs/handoff/frontend-backend-contract.md` (§1 the rule, §7 the rulings).
  **First + load-bearing worked instance: the Model-1→Option-B reversal** — the
  frontend contract (a combined-registration wizard with no separate-onboarding
  step) overrode an architect decision (Model 1, locked from DB-side docs _before
  the contract existed_), catching the wrong call BEFORE it propagated into
  Commits 3+ and a speculative Phase-1e onboarding build. **Greenfield sub-case**
  (Commit 5 documents): where the FE has no API-level contract — it writes Supabase
  storage directly, the type implicit in `isIndividualOwner`, no `type` field —
  CF-24 has nothing to be authoritative about; the endpoint is designed clean and
  the FE is repointed in Phase 1e.
- **CF-19 — instances:** AWS SDK `3.1052.0` (`client-s3` + `s3-request-presigner`)
  - the pinned MinIO image tag (Commit 2); `@fastify/multipart` `10.0.0`
    (Commit 5). Exact-pin discipline held across the phase, lockfile-in-commit for
    the one dependency change.
- **CF-21 — instances:** the five `STORAGE_*` env cascade (Commit 2 — 21a runtime
  shim + 21b typed-literal); plus the operational corollary that the eager `env`
  singleton validates ALL vars at import, so running `migrate` / any `tsx` script
  locally needs the full env block, not just `DATABASE_URL` (recurred Commits 4-5).
- **CF-22 — instances:** the `tax_number`-already-nullable correction + the
  vitest-serialize decision (Commit 3); the M1 path-param document discriminator
  (vs the literal "type field") + the M3 5 MB cap correcting a ~10 MB plan estimate
  from the verified FE value (Commit 5); the Finding-A/B legacy-seed forks
  (Commit 1).
- **CF-23 — instances:** legacy-SQL seed verification incl. Findings A/B
  (Commit 1); the `forcePathStyle` two-layer config + the live MinIO round-trip
  (Commit 2); the better-auth `name`→`contactName` mapping + `getSession` +
  drizzle-adapter resolution at plan-write, then the RENAME + signup round-trip at
  execution (Commit 3); the `zone`=free-text name-collision catch — `predefined_zones`
  feeds only the campaign wizard, not the owner address form (Commit 4); the
  `@fastify/multipart` buffer/limit API + the greenfield FE finding + streaming-layer
  oversize rejection (Commit 5).

Phase 1d accumulated worked instances of existing CFs — **no new formal CF** (CF-19–24
all already formal; canonical write-ups in the **Phase-1d plan docs' §9 sections** +
`docs/handoff/frontend-backend-contract.md` §3.5/§3.6):

- **CF-23 — instances (the phase's strongest two-layer demonstrations):** (a) the
  **signin cookie mechanism** — better-auth's `returnHeaders:true` + `headers.getSetCookie()`
  forwarding verified against installed source at plan-write, then **round-trip-verified
  with a real cookie** at execution (sign-in → real `Set-Cookie` → replayed through the
  `requireAuth` guard to a `PATCH` → `request.user` populated); (b) **THE
  reset-token-is-a-verifications-row finding** — source-reading at plan-write established
  that password reset stores a random 24-char token in a `verifications` row (`identifier
'reset-password:<token>'`), the OPPOSITE of email-verify's stateless JWT, and execution
  then confirmed it (the test reads the row to drive a real reset). (b) is the cleanest
  demonstration in the project that the CF-23 source-read pre-empts a specific recurring
  assumption-class error: the exact "assume same-as-verification" surprise that bit
  Commit 3 (the JWT-not-row truth) was AVOIDED here by reading first.
- **CF-24 — instances:** signin's response is mixed-class — the shaped routing body
  (role/status/`onboarding_completed`/`profile_type`) is (a)-class FE-adapts, while the
  403-verify-first and generic-credentials behaviors are (b)-class FE-consumes; password
  reset/change are **greenfield** (the FE drives Supabase directly —
  `resetPasswordForEmail`/`updateUser`/`signInWithPassword`, no API wire), so the
  endpoints were designed clean and the FE repoints in Phase 1e (the Commit-5 documents
  greenfield sub-case, recurred).
- **CF-21 — clean across the phase:** no new env var, no cascade — the `EmailSender`/SMTP/
  `BETTER_AUTH_URL` from Phase 1b cover the reset email, and the reset link reuses
  better-auth's own `url`.

Phase 1e Part A accumulated instances of three existing CFs — **no new formal CF** (canonical
write-ups in the **Phase-1e Part-A plan docs' §11 sections** + `frontend-repoint-survey.md`):

- **CF-23 — TAXONOMY COMPLETED.** The better-auth origin-check arc (Commit 1, four CF-9 rounds)
  closed the set of ways a source-read can be **right-looking but wrong** — and the through-line is
  that **execution-against-reality caught all four; none would have been caught by re-reading
  source.** The four named sub-classes:
  - **(i) assume-same-as-last-similar** — Phase-1b Commit 3's "verification storage is a JWT" then
    Phase-1d's "reset-token is a `verifications` row, the OPPOSITE" (avoided by reading first).
  - **(ii) missed-its-scope** — `originCheckMiddleware` is registered at the **router** level
    (`createRouter` `routerMiddleware`), so it fires on the `/auth/*` handler path but NOT on the
    custom routes that call `auth.api.*` directly (the source named the middleware; the scope of its
    registration was missed).
  - **(iii) misattributed-the-result** — a bogus-origin `POST /api/signin` returning **200** was
    read as proof of the (ii) bypass, but the real cause was better-auth's **test-env
    `skipOriginCheck=true`** default (`create-context.mjs`, `isTest()`); only pinning
    `disableOriginCheck:false` made the test trustworthy and the bypass genuinely provable.
  - **(iv) intent-right-failure-mode-wrong** — signup-grows' post-create `db.update` (Commit 2): the
    source-read got the **intent** right (don't touch an existing user on a duplicate) but the
    **failure-mode** wrong (assumed a graceful no-op; reality = better-auth's synthetic duplicate
    user has a **non-uuid** id → `where id = <non-uuid>` throws on the Postgres uuid cast → 500). The
    safety property held throughout (no-op or throw, the existing user is never modified); the fix
    (re-fetch by email, apply only when the persisted id matches the returned id) made it robust vs
    working-by-accident.
- **CF-24 — instances (truthful-to-frontend):** `GET /api/me` is an (a)-class self-view shaped to
  what the FE store consumes; signup-grows is wire-truthful (`contact_name` zero-map [wire→property→
  column all align], `agent_toodooh`→`agent_code`, `profile_type` validated-and-mapped not
  trusted-as-privilege); the reference GETs are built **only** for categories the FE actually fetches
  (`company_size_options` OUT — fetched but no table + collect-and-ignore field; the
  dead-infrastructure-avoided call, the WiFi-columns trap's sibling).
- **CF-21 — instance:** `WEB_ORIGIN` (defaulted) needed no `vitest.config` `test.env` entry (21a —
  defaults cover it, like `STORAGE_BUCKET`) but DID force the one typed `Env` literal in
  `error-handler.test.ts` to add it (21b).

Phase 1f promoted one new formal CF and refined two existing patterns; canonical write-ups in the
**Phase-1f keystone design + per-flow scoping/plan docs** (their §-sections are the home; see §4
for the doc hashes):

- **CF-25 — PROMOTED — caption-vs-wire.** A defer / disable ruling is satisfied only when the
  **wiring is severed**, not when a **caption announces** it. Verify the path-cut (the handler,
  the state, the chain), not the label. Reporting corollary: a CF-9 "disabled" must mean
  path-severed; if it means "caption added, wiring deferred," say so explicitly. **Three worked
  instances:** D-F4-4 (logo, F4a/b — captioned-not-wired: the `disabled` attribute + "Bientôt
  disponible" text rendered correctly while the handlers + `uploadLogo` + Supabase storage
  chain stayed loaded), D-F5-3 (doc-remove, F5 — captioned-not-wired: the `disabled={!documentFile}`
  attribute gated the UI correctly but the dead `else { handleRemoveDocument(); }` branch was
  loaded code with a real Supabase chain), and **the counter-example** D-F6-5a (MyAccount no-old
  password change, F6 — correctly severed at source: the field + handler + caller deleted in
  the same commit that pruned its UI text; proves the pattern CAN be done right). Surfaced
  during F7's source caller-check (`docs/handoff/phase-1f-f7-cleanup-scoping.md` §1.B — the
  "kept-dead methods" inversion: the methods were LIVE, kept alive by deferred-but-not-wired
  handlers). F7b severs all three remaining instances in one commit; with the F6 counter-example,
  the CF is fully demonstrated. Canonical home: the F7 scoping + F7b plan doc.
- **CF-23 — instances (the per-flow source-reads that refined assumptions).** Phase 1f
  accumulated four worked CF-23 instances across the per-flow commits, each catching an
  assumption that source-reading at plan-write avoided as a CF-9 mid-execution surprise:
  - **the better-auth verify-link mechanism** (F3) — the assumption was "verify-link hits
    `/auth/verify-email`"; source said the `/auth/*` handler is server-side and **redirects** to
    the `callbackURL` (`/verify-email` in apps/web), so the FE page is the redirect TARGET, not
    the `/auth/*` handler. The corollary: the proxy already owns `/auth/*`, so the absolute
    `callbackURL=${WEB_ORIGIN}/verify-email` is required (without it, better-auth's `originCheck`
    would reject relative URLs).
  - **the `sendOnSignIn` config-read** (F3 — the false-promise UI catch) — the assumption was
    "Phase-1d signin re-sends the verification email on a 403"; source confirmed `sendOnSignIn`
    was config-`false`, so the Phase-1d behavior was 403-without-resend. F3 deliberately FLIPPED
    it to `true` (the B′ recovery loop). Caught a UI plan that would have promised resend
    behavior the backend didn't yet deliver.
  - **the read-bridge discovery** (F4a) — the assumption was "the FE will GET `/api/profile`";
    source confirmed no such endpoint exists, and the column set the FE needs (logo, bank,
    deferred fields) couldn't be supplied by any dedicated endpoint either. The pattern:
    `getBusinessProfile` reads `/api/me` and maps to `BusinessProfile` (notifications nested→flat,
    status→verification_status, deferred fields undefined). One transform, one read.
  - **the F7 caption-vs-wire inversion** (the "kept-dead methods" finding) — the assumption was
    "F4 left `updateProfile`/`updateBusinessProfile` dead-Supabase, ready for cleanup removal";
    source caller-check proved both methods were LIVE (5 + 1 callers respectively), kept alive by
    the captioned-but-not-wired logo/doc-remove handlers and the wallet/MyAccount paths. The
    cleanup commit reframed: F7a = independently-dead removals, F7b = sever the captioned-defers
    THEN cascade-remove the now-zero-caller methods.
- **the third dead-UI-detection pattern: attribute-gated unreachability.** The existing two
  patterns (see [[dead-ui-detection-patterns]]) — **(a)** setter-to-true verification (the state
  flips but the consumer never renders) and **(b)** CSS-gated verification (a `className="hidden"`
  / `display:none` static gate on a conditional-rendering site) — caught the cleanup-phase
  dead-UI cases. F7 surfaced **(c) attribute-gated unreachability**: controls rendered with the
  HTML `disabled` attribute but with **loaded handlers** (`onClick`/`onChange`) + state + a dead
  service chain — visually disabled but the code path is real, just unreachable from the UI in
  the current state. Found only via the §1.B source caller-check (greping the _methods_ the
  handlers call), not by the conditional-rendering scans pattern (a) + (b) use. The methodology
  upshot: when auditing a "disabled" control, grep its handlers; a disabled attribute is a UI
  state, not a wiring assertion.

### 7.5 — Per-step record

Each row's full record is in §4 "Already resolved"; one line each here (numbering per
the §5 roadmap):

| Step    | Outcome                                                                       | Issue    |
| ------- | ----------------------------------------------------------------------------- | -------- |
| 1       | Cleanup audit & roadmap (this doc)                                            | —        |
| 2a / 2b | Duplicate pages + duplicate services deleted                                  | #1 / #14 |
| 3       | Auth-state layer consolidated onto a `persist`'d Zustand store                | #2       |
| 4       | DOOH engine's pure math decoupled from Supabase + v3.0 pricing module written | #12      |
| 5       | Pino logger + `console.*` purge (901 calls)                                   | #7       |
| 6       | Typing pass — 265 `no-explicit-any` → 0, regression cycle                     | #8       |
| 7       | `Dashboard.tsx` retired, `NewCampaign.tsx` 4030 → 1624 lines                  | #3       |
| 8       | `src/` restructured into `features/<domain\|role>/` (142 files)               | #4       |
| 9       | `window.location.reload()` removed                                            | #5       |
| 10      | React Query introduced for server state (15-commit chain)                     | #6       |
| 11      | `jsx-a11y` + `exhaustive-deps` cleanup; lint `346 → 1`                        | #9       |
| 12      | Brand-token migration + brand refresh (~740 sites)                            | #10      |
| 13      | CI green on `main` via baseline-gating                                        | #11      |
| 14      | Duplicate devDependencies hoisted to root                                     | #13      |

### 7.6 — The operating pattern

The phase was disciplined by a repeated shape: **inventory-first plan-writing** per step
→ **mechanical-vs-judgment classification** → **halt-on-finding** (scope is surfaced,
never improvised) → **per-commit four-gate verification** → **CF-9 pause summary before
push** → **visual-QA pause** where the change is rendered. Steps 12 and 13 hit
halt-and-resolve cycles (leviosa `@apply` transitivity, the mint shade-family, the
mid-rebrand discovery, the `headSha` mis-diagnosis); each surfaced at the right boundary
and **none shipped broken**. The recurring lesson — captured as CF-18's source/target
axis and the Step-12 partial-migration meta-note — is that an inherited codebase carries
residue from incomplete prior work, so inventory must surface both declared-state and
actual-state.

Phase 1a (the first feature-building phase) added two plan-quality learnings — both
caught at execution by gates rather than at plan time, so both feed back into how
Phase-1b plans should inventory (canonical detail in
`2026-05-20-phase-1a-commit-2-env-logger-health-errors.md` §22):

- **Plan §2 inventory must verify ESM NodeNext relative-import resolver behavior, not
  assume it.** ESLint's default node resolver cannot follow NodeNext `./foo.js`→`./foo.ts`
  relative imports without a TypeScript resolver pointing at the appropriate tsconfig.
  Worked example: Commit 2.1 deviation #1 — a root `eslint.config.js` scoped resolver
  block was added in-commit when 7 `import-x/no-unresolved` errors surfaced on all
  `./*.js` relative imports across `apps/api/src` + `tests`.
- **Fastify's two error pathways need shape-coverage in every commit introducing shaped
  errors.** Exceptions thrown by handlers route through `setErrorHandler`; requests
  matching no registered route route through `setNotFoundHandler`. A shaped-error commit
  must wire and Gate-4-assert both. Worked example: Commit 2.1 deviation #2 —
  `buildNotFoundHandler` was added in-commit when Gate 4's `/missing` assertion failed
  because the plan only wired `setErrorHandler`.

Phase 1b (the auth foundation) added four operating learnings, three of them caught at
execution rather than plan time:

- **Cross-commit interaction discipline.** Library hooks called by sequential flows
  interact with downstream rollback compensations. When implementing a hook callback,
  verify the calling function's error semantics (throw → upstream rollback fires? log →
  no rollback?); when implementing rollback compensation, verify which error conditions
  trigger it; map the cross-product. Worked example: Commit 4's `sendVerificationEmail`
  hook — better-auth awaits it, so a throw would fail `signUpEmail` and trip Commit 3's
  `deleteOrphanUser`, deleting the account on an SMTP outage. Fix: the hook never throws
  (returns a shaped result, logs).
- **Test-mocking vs network dependence.** Tests depending on external network calls at
  test time (ethereal account provisioning, third-party API checks) are inherently flaky
  and CI-restriction-incompatible. Default: module-level mocking for all external
  integrations; external-network tests are acceptable only for manual verification
  (boot/smoke tests outside CI). Worked example: Commit 4 dropped ethereal-in-tests for
  `vi.mock('nodemailer')`.
- **Fix-forward over force-push; `main` is append-only.** When a pushed commit fails CI,
  fix forward with an append-only commit rather than rewriting history. The honest record
  (red commit + green fix) is more trustworthy than a force-pushed-clean history and
  keeps the safety net visibly working. Worked example: Commit 4's `249fc87` (a
  lockfile-sync miss caught by `pnpm install --frozen-lockfile`) fixed forward at
  `4ab1229`.
- **Dependency change → lockfile in the same commit.** When a commit adds or changes a
  dependency, the commit MUST include the updated lockfile; the §10 file list is the
  guard, and dropping a listed file is the failure mode — a pre-push checklist item for
  any dependency-touching commit. Worked example: Commit 4's `249fc87` omitted
  `pnpm-lock.yaml` from `git add` despite §10 specifying it.

Phase 1c (onboarding-data + profile edits + document storage) added three operating
learnings:

- **The `apps/api` test suite is serialized.** `vitest fileParallelism:false`
  (Commit 3) — users-writing suites race signup's `beforeEach` TRUNCATE under parallel
  files; shared-pool teardown is a single file-level `afterAll`, not per-describe
  (Commit 4, where a second profile suite's per-describe `sql.end()` would have closed
  the pool before the first suite finished). Any new users-writing suite inherits both.
  A deliberate determinism-over-speed trade for a small suite.
- **Drive an interactive CLI non-interactively rather than hand-fabricating its
  output.** Commit 3's `name`→`contact_name` rename: drizzle-kit's rename detection is
  interactive (a TTY prompt absent in this env). The plan's fallback was to hand-author
  the `RENAME COLUMN` SQL, but that risks snapshot drift (the generated
  `meta/*_snapshot.json` would not reflect the hand-edit). Driving the prompt produced
  a clean `RENAME COLUMN` migration AND an in-sync snapshot — when a tool's correct path
  is interactive, drive it; don't fabricate its artifacts. (Commits 4-5's migrations
  were pure `ADD COLUMN` — no rename — so `generate` ran clean non-interactively.)
- **Estimate-drift surfaced, not absorbed.** The `~N` test-count figures in plan §11
  are approximate; the enumerated cases are truth. When actual differs — Commit 2
  (+10 vs +9), Commit 4 (88 vs ~85), Commit 5 (11 vs ~13 cases) — report the gap, never
  pad to hit the estimate.

Phase 1d (session auth) added three operating learnings:

- **Name an inherent boundary, then close it in the phase that makes it testable.**
  Phase-1c Commit 3 could only test the `requireAuth` guard with a _mocked_ session —
  session _creation_ did not exist yet — and it honestly flagged the real-cookie
  round-trip as the deferred boundary rather than faking an end-to-end proof. Phase-1d
  Commit 1 closed it with a real minted cookie replayed through the guard. Naming the
  boundary and closing it at the right phase, rather than mocking past it or claiming
  false coverage, is the pattern.
- **Anti-enumeration is a cross-endpoint invariant, asserted per-endpoint by symmetry.**
  The same property — a credential-accepting endpoint must not reveal whether an account
  exists — recurs at signup (201-generic on duplicate email), signin (identical generic
  401 for wrong-password vs unknown-email), and reset-request (timing-equalized identical
  200 + no-send for unknown). Each endpoint earns its own symmetry test (the existing-case
  body byte-identical to the unknown-case body); the invariant is enforced everywhere
  credentials are accepted, not assumed from one site.
- **Security-hook never-throw generalizes to every awaited email hook.** Both
  `sendVerificationEmail` (Phase 1b Commit 4) and `sendResetPassword` (Phase 1d Commit 2)
  are awaited by better-auth inside a flow; a throw would break the flow, leak existence
  (a 500 on reset-request is an enumeration oracle), or cascade (the verification hook
  into Commit 3's orphan-rollback). The Q2 discipline — try/catch, shaped result, log,
  never throw — is a standing requirement for any awaited email hook, verified by an
  SMTP-failure-still-generic test.

**Floor-interpretation note for Phase 1e.** The **root typecheck floor (51) has been flat
across Phases 1a–1d because every phase touched `apps/api` only**. Phase 1e is the
**first to touch `apps/web`** — the ~50 pre-existing `apps/web` type errors (react-leaflet
exports, `AdminActivity`/`AdminProfile` shapes, the `supabase.ts`→`database.types`
unresolved import) are expected to **change (drop)** as the frontend repoints to
`apps/api` and Supabase is removed. The 51/1 baselines ratcheting down in Phase 1e is the
intended outcome, not a regression — and the moment the `import-x/no-unresolved` lint-1
floor clears is when the Supabase typed-client prerequisite (#15) finally lands. Recorded
here so the Phase-1e floor change is not mistaken for a regression.

> **[Post-split clarification — §16]** This note predates the survey's Phase-1e/1f split. The
> "Phase 1e" it refers to (the first to touch `apps/web`, where the 51/1 floors move) is now
> **Phase 1f — the frontend repoint**. **Phase 1e Part A was backend-only — `apps/web` held at
> 51/1/160/139.80**, exactly as the note's "every phase touched `apps/api` only" pattern. The lint-1
> clear is further refined by survey §2.4: it does NOT clear from the account-layer repoint (the
> shared `supabase.ts` client + its `database.types` import stay until the last slice / #15), so a
> still-1 lint floor through 1f is expected.

Phase 1e Part A (backend prerequisites) added four operating learnings:

- **Tested == shipped, especially for security controls.** A suite that disables a control prod
  enables cannot tell the truth about it. better-auth defaults `skipOriginCheck=true` under
  `isTest()`, which silently disabled the origin check in tests and produced three contaminated
  observations across the Commit-1 origin investigation (the CF-23 (iii) misattribution). Pinning
  `advanced.disableOriginCheck:false` made tests exercise prod's real behavior — only then was the
  router-vs-`auth.api` boundary genuinely provable. Zero dev/prod impact (both already had the check
  on); it only flips the test default.
- **Capture-irreversible-now vs collect-and-ignore.** Two distinct dispositions for fields the FE
  sends but a feature doesn't yet consume: **STORE** when losing the datum is irreversible
  (`agent_code` — acquisition attribution captured at signup, even though the agents table/validation
  is a future slice), vs **`.strip()`** when it's reconstructable later (owner-extras —
  screens/rooms/company_size/zone/fleet). The test: is the data recoverable after the moment passes?
- **Server-stamped consent.** `terms_accepted_at` is set server-side to `now()` when the wizard's
  boolean is true, and the route **rejects (400) if terms are not accepted** — never trust a
  client-supplied timestamp, never rely on the client alone to enforce acceptance.
- **Dead-infrastructure-avoided (truthful-to-frontend), and intentionally-plaintext-non-sensitive.**
  Build endpoints/columns only for what the FE actually fetches/sends AND what's actually stored: the
  WiFi columns (Commit 2) and the `company_size_options` endpoint (Commit 3) were both NOT built —
  each would serve nothing (no producer / no consumer / discarded value). Build the reference table or
  column **with its real consumer**, not ahead of it (the agents-table-later pattern). Distinct from
  this: the deferred WiFi password is **intentionally plaintext non-sensitive** — a public-venue
  shared credential needed in cleartext for device provisioning; a future hardening pass must NOT
  hash/encrypt it (the opposite handling from the account password).

**The CSRF model (proven, Phase 1e Part A) + the money-slice gate.** Custom `/api/*` routes call
`auth.api.*` directly and **bypass** better-auth's router-level origin check (proven with the check
forced on: bogus origin → `POST /api/signin` → 200; `/auth/*` cookie POST → 403). So custom-route
CSRF rests on the **`SameSite=Lax`** session cookie (a forged cross-site POST carries no cookie →
`requireAuth` 401); `/auth/*` IS origin-checked; `trustedOrigins:[WEB_ORIGIN]` is intent-doc covering
that surface. Login-CSRF on `/api/signin` is the accepted low-severity residual. **THE MONEY-SLICE
GATE:** before wallet/recharge/payment ships, its mutating custom routes get an explicit
`assertOrigin ∈ [WEB_ORIGIN]` preHandler (built with the first money-route consumer, the
require-auth "build-with-first-consumer" discipline) — defense-in-depth beyond `Lax` for
money-movement. Recorded here so the money slices inherit the decision rather than rediscover the
question.

Phase 1f (frontend repoint) added seven operating learnings — the largest set of any phase, and the
first set drawn from `apps/web` work:

- **The thin-adapter outcome — RTL provisioned-but-never-needed.** The keystone's centralize-first
  premise (survey §1.4: rewrite `auth.service` + `auth.store` once, leave the 30+16 importers
  untouched) **held across all 7 repoints** (F1 easy / F2 the hardest-file 1940-line wizard / F4
  split into 4 section saves / F5 multipart / F3 cross-package / F6 cross-page domain). Each
  per-flow commit was a **localized data-flow change** — a service method body swap + a thin
  adapter on the response shape — not a consumer rewrite. **Consequence:** the test-floor raise the
  keystone design ratified (D10) for jsdom + Testing Library never materialized — the thin-adapter
  architecture **structurally kept the load-bearing logic in the service layer**, which is
  **node-testable** without a DOM. The 57 new `apps/web` tests are all node-level: api-client +
  apiErrorMessage + auth-store (mocked fetch + localStorage shim) + the auth.service.reference /
  profile / password / signup unit suites + utils. RTL would have covered only form-binding
  (framework behavior, not project behavior). Render-correctness moved to the **phase-close human
  visual QA** as the gate the assistants can't simulate. _The test infra we planned and didn't
  stand up — and why._
- **The read-bridge pattern.** Phase 1f's profile reads consolidate on `GET /api/me` rather than
  a hypothetical `GET /api/profile` (the keystone D9-style decision recurring through F4): the
  endpoint that exists (`/api/me`, the cookie-authenticated self-view) is the source; the FE
  adapter maps it to whatever shape the consumer expects (`BusinessProfile`, with notifications
  flattened nested→flat, status→verification_status, deferred fields undefined). No dedicated
  read endpoint per page; one transform per consumer. The pattern transfers: when a feature reads
  the user's own data, prefer `/api/me`-as-bridge over a per-page GET — the FE adapter is the
  shape boundary, not a backend route per shape.
- **Truthful-data over convenience — the empty-optional/null→400 lesson recurring.** F2 signup
  taught it (omit-empty rather than send `''` against backend uuid optionals — `''` fails
  `z.uuid()` while undefined is "field absent"); F4 PATCH recurred it per-field (uuid optionals
  use `||undefined` to JSON-drop, while nullable text fields use `||null` to clear). The
  JSON-drop guard in `api-client` (drops `undefined` keys before serialization) protects both —
  but the FE caller still has to express the right shape per field-class. Honest reporting note:
  the F2 plan caught it once; F4 had to relearn it per-field at scoping. CF-22 surfacing
  works — the surface caught the lesson before code shipped both times.
- **The `sendOnSignIn` behavior change recorded for the record.** Phase 1d's signin returned a
  403 verify-first without re-sending the verification email; Phase 1f F3 flipped
  `emailVerification.sendOnSignIn=true` (the B′ recovery loop — the verify-page's error CTA is a
  real recovery path: expired link → signin → 403 + fresh email → click → verified).
  **Recorded here so future sessions read this as a deliberate behavior change, not a Phase-1d
  contradiction.** The decision: a re-sender on signin is rate-limited (better-auth's default
  +the per-account scope), own-address-only (no enumeration vector), and closes a real UX gap
  (expired verification link with no other recovery path).
- **The deactivation class-(b) finding.** Pre-K the deactivation form called
  `supabase.auth.signInWithPassword` for re-auth before destroying the account — a real
  security gate against accidental/unauthorized destruction. Post-K the Supabase auth store is
  no longer the password source (users live in apps/api's `users` table), so the gate became a
  **broken no-op that rejects every password attempt** — a control that LOOKS like it confirms
  but silently skips the broken gate. F7b's defensive disable (the static "coming soon + contact
  `support@too-dooh.com`" message) closes the UX honesty gap; the backend slice tracked is **`POST
/api/account/deactivate` with `current_password` re-auth, mirroring `/password/change`**. The
  lesson: a re-auth gate's correctness moves with the auth store; a phase that changes the auth
  store must audit every re-auth call-site for whether the gate is still real.
- **The named owner-extras functional reduction.** Slice 1 collects `number_of_screens`,
  `number_of_rooms`, `company_size` from the wizard + the owner-settings form, the wire sends
  them, the backend `.strip()`s them (Phase 1e Part A — the collect-and-ignore pattern; columns
  exist neither on `users` nor on a side table). Pre-K the Supabase backend HAD columns for
  these fields and the FE persisted them. **Phase 1f is a functional reduction vs the legacy:**
  the FE collects and the wire carries; the backend doesn't persist, and the inputs that
  display "saved data" (the owner-settings entreprise sub-form) come back empty after a refresh.
  Recorded as a deliberate reduction, not a regression — the **owner slice** will add columns,
  un-strip, and re-enable the read path. The forward-compat wire is built; the persistence is
  the slice's only addition. (Similarly: logo storage, document DELETE, account deactivation,
  company_size reference table, WiFi-at-signup — see §17.)
- **The F7b orphaned-consumer learning.** A removal severing a handler can orphan **what the
  handler used** (`useNavigate` in `UserProfile.tsx` was the sole consumer's import — when
  `handleDeactivateAccount`'s `navigate('/login')` was removed, the `const navigate = useNavigate()`
  was suddenly unreferenced). The +1 gate regression escaped the §10 plan-doc inventory because
  the inventory was "what the commit edits," not "what those edits orphan." **Discipline for
  future cleanup commits: after each handler removal, `grep -n <consumer-name>` (the variable
  the handler called) to pre-check whether the variable becomes unreferenced.** Caught at the
  gate sweep, fixed in-commit; surfaced honestly in CF-9 rather than re-running the gates
  silently.

---

## 8. TBD follow-ups — standing list (Phase-1 prerequisites & candidates)

Cleanup-phase follow-ups filed as GitHub issues. `TBD-A…TBD-J` are closed (resolved or
folded into a step); the open standing list:

| TBD   | Issue | Summary                                                                                       | Disposition                                                           |
| ----- | ----- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| TBD-K | #32   | Storage service abstraction — 9 files call `supabase.storage` directly                        | Phase 1 — storage-layer scope (new backend)                           |
| TBD-L | #33   | Campaign-relationships service — consolidate the campaign↔screen↔location↔approval join logic | Phase 1 candidate                                                     |
| TBD-O | #34   | `OwnerScreens` missing-persistence cluster — 3 bounded instances                              | Phase 1 — needs the new backend's optimistic-update story             |
| TBD-P | #35   | Consolidate advertiser `useUserProfile` + owner `useBusinessProfile` onto one auth-owned hook | Phase 1 candidate                                                     |
| TBD-Q | #36   | `OwnerDashboard._alerts` — dead state (set, never rendered)                                   | Easy (~30 min) — landable pre-Phase-1                                 |
| TBD-R | #37   | Simulated revenue data in `revenueService` — production data-integrity issue                  | **ELEVATED** — Phase-1 prerequisite; CEO/CTO conversation queued (§9) |
| TBD-S | #38   | `CampaignDetails.loadCampaign` — dead fetch (result discarded)                                | Easy (~30 min) — landable pre-Phase-1                                 |
| TBD-T | #39   | Backdrop a11y excellence pass — proper modal-dialog semantics                                 | Phase 1 — component-library work                                      |

---

## 9. Pre-Phase-1 prerequisites

1. ~~**Supabase documentation work.**~~ **☑ Done** — completed as the **P0a + P0b**
   prerequisite track (see §11). The current schema, RLS policies, auth provider config,
   storage buckets, RPC bodies, and the v3-pricing `global_configuration` are inventoried
   in `docs/handoff/supabase-schema-inventory.md` (~98% — 100% of what the legacy
   artifacts can yield).
2. **TBD-R conversation (CEO/CTO).** Simulated revenue data is elevated — screenhosts
   seeing fabricated earnings is a customer-trust issue that must be settled before
   launch. The conversation was deferred "until cleanup closes"; that condition is now
   met.
3. **Easy-TBD sweep (optional).** TBD-Q (#36) + TBD-S (#38) are ~30-minute dead-code
   removals. They could land as a small pre-Phase-1 commit to clear obvious dead code
   before architecture work begins — defensible either to do or to defer.

---

## 10. Phase 1 entry conditions

The cleanup→Phase-1 transition is reached when:

- ✓ All 14 cleanup-phase roadmap rows ☑ (this commit)
- ✓ CI green on `main` (Step 13)
- ✓ Brand identity locked and applied (Step 12)
- ✓ Codebase structurally fit for backend replacement (every prior step contributed)
- ✓ **Supabase documentation prerequisite complete** — P0a + P0b (§11); the schema
  reference Phase 1 must replicate now exists
- ☐ Remaining §9 prerequisites — the TBD-R conversation, the optional easy-TBD sweep

Phase 1 (backend migration off Supabase, auth rewrite, the Supabase typed client that
clears the typecheck-51 / lint-1 baselines) is a **fresh brainstorm → spec → plan
cycle**. Its commits are larger, riskier, and less mechanically classifiable than
cleanup-phase commits — the cleanup-phase operating pattern (§7.6) is a strong default
but should be revisited for Phase-1's risk profile when Phase 1 begins.

---

## 11. P0a + P0b — Supabase prerequisite work

The §9 "Supabase documentation work" prerequisite ran as a two-step track between the
cleanup-phase close and the Phase-1 architecture conversation. It used the same operating
pattern as the cleanup phase (§7.6) — inventory-first, halt-on-finding, CF-9 pause
summaries, per-commit four-gate verification, CI-green on every push.

**P0a — extraction.** Brought the previous developer's SQL artifacts into the repo as
historical reference (not runnable migrations). Source: `github.com/toodooh-source/toodooh`
at `df0ef04`, read non-destructively (`git show`, no checkout). Landed under
`docs/handoff/legacy-migrations/` — 74 formal migrations, 22 backup-tree migrations,
5 backfill scripts, 73 triaged root scripts (of 167; the rest were diagnostics/data-only).
Commits `3781fb2` (methodology + inventory reference docs), `6b1eef2` (the SQL artifacts).

**P0b — schema inventory.** Built `docs/handoff/supabase-schema-inventory.md` from those
artifacts: per-table schemas with origin migration, RLS by policy generation, RPC bodies,
seeds, 9 legacy-migration defects, the Leviosa→Toodooh reconciliation, and Phase-1 choice
points. Ran across four working sessions:

| Commit    | Scope                                                                 |
| --------- | --------------------------------------------------------------------- |
| `fba93b9` | `business_profiles`, admin-tables cluster, `auth.users`, defects 1–6  |
| `e171272` | campaign tables cluster, geographic data model, reference tables      |
| `bd58b55` | financial tables, video subsystem (Session 4 areas A+B)               |
| `84517d5` | screen-affluence, events, `global_configuration`, storage, RPCs, auth |
| (this)    | P0b closeout — methodology consolidation, CF-18 reference doc         |

**Outcome.** The inventory is ~98% complete — 100% of what the legacy artifacts can
yield; four tables (`admin_permissions`, `admin_roles`, `factures`, `external_api_keys`)
have no `CREATE` in any artifact and are Phase-1 live-DB discovery items. The dominant
methodology rule, **CF-18 (the source/target axis)**, was extracted to its own reference,
`docs/handoff/cf-18-source-target-axis.md`; the broader operational notes were appended to
`docs/handoff/methodology-and-prompt-format.md` Part 4.

**The prerequisite phase is complete.** Next is the Phase-1 architecture conversation —
a fresh brainstorm → spec → plan cycle.

---

## 12. Phase 1a — Backend foundation

Phase 1a is the first feature-building phase after the cleanup phase and the P0a/P0b
Supabase prerequisite track. Three commits open `apps/api/` from an empty workspace slot
through Drizzle/Postgres/Docker integration: `d723ae6` (Fastify scaffold), `326d39b`
(env validation + pino + `/health` + error/not-found handlers), `4a5289a` (Drizzle +
Dockerized Postgres 16/PostGIS 3.4 + migration runner + `/health` DB-ping). See the §4
"Already resolved" Phase 1a row for full detail, gate floors, and plan-doc references.
It used the same operating pattern as the cleanup phase (§7.6) — inventory-first plans,
halt-on-finding, CF-9 pause summaries, per-commit gate verification, CI-green on every
push — with larger commit scopes and an added boot/DB-verification gate per the Phase-1
risk profile (§10). Closes 2026-05-20. **Phase 1b opens next:** the `users` table +
better-auth + the screenhost signup endpoint.

---

## 13. Phase 1b — Auth foundation

Six commits opening the auth foundation: the single `users` table through OVH SMTP email
verification. See the §4 "Already resolved" Phase-1b row for full detail, gate floors,
and plan-doc references. It used the same operating pattern as Phase 1a (§7.6) —
inventory-first plans, halt-on-finding, CF-9 pause summaries, per-commit gate
verification, CI-green on every push — extended with real-Postgres integration tests
(a CI Postgres service container), operator-gated real-send email verification, and the
fix-forward-over-force-push discipline (the one CI failure, `249fc87`, fixed forward at
`4ab1229`, `main` not rewritten). Promotes CF-21/22/23 to formal CFs (§7.4) and captures
four operating learnings (§7.6). Carry-forwards to later phases: production
`BETTER_AUTH_URL` and OVH→Gmail domain-reputation warm-up (Phase 1g), and the
verification `callbackURL` redirect target (Phase 1e). Closes 2026-05-22. **Phase 1c
(onboarding flow** — business-profile columns, reference-table seeds, the onboarding
endpoint, document upload**) opens next.**

---

## 14. Phase 1c — Onboarding-data + profile edits + document storage

Phase 1c is the third feature-building phase: the screenhost's business-profile data, the
profile-edit surface, and document storage. Five feature commits — `9e9d716` (onboarding
columns + reference-table seeds), `46649d8` (MinIO + the `StorageProvider`), `a821789`
(the `requireAuth` session-guard + `PATCH /api/profile/business` + migration 0004),
`ed8d273` (`PATCH /api/profile/{contact,address,notifications}` + `fonction`/`zone` +
migration 0005), `46a56e9` (`POST`+`GET /api/profile/documents/:type` +
`@fastify/multipart`) — plus the mid-phase frontend-contract audit (`faed78d`). See the
§4 "Already resolved" Phase-1c row for full detail, gate floors, and plan-doc references.

**The architecture pivot.** The phase opened expecting the DB-side "Model 1" — a minimal
signup followed by a separate onboarding gate (the §13 pointer that closed Phase 1b
reflects that expectation). The frontend-contract audit (`faed78d`) proved it wrong: the
frontend is a single combined-registration wizard collecting the entire profile +
documents before one signup call, with no separate-onboarding step and
`onboarding_completed` flipped only by admin. Per CF-24 the contract is authoritative, so
**Model 1 was abandoned for Option B** — no onboarding gate; profile fields are edited via
section-scoped PATCH endpoints; Commit 3's endpoint became an _edit_ surface, not a
required gate. The rulings live in `docs/handoff/frontend-backend-contract.md` §7. This is
the first worked CF-24 instance (§7.4) — the contract catching a wrong architect call
before it propagated into the dependent endpoints.

It used the same operating pattern as Phases 1a/1b (§7.6) — inventory-first plans,
halt-on-finding, CF-9 pause summaries, per-commit gate verification, CI-green on every
push — extended with real-MinIO integration tests alongside real-Postgres (Commit 5
exercises both services), a serialized test suite, and the
dependency→lockfile-in-the-same-commit discipline (Commit 5's `@fastify/multipart`).
Formalizes **CF-24** and accumulates **CF-19/21/22/23** instances (§7.4); captures three
operating learnings (§7.6). Gate floor moved `apps/api` **40 → 99** / root **200 → 259**.

**Phase-1e carry-forwards:** signup-route `tax_number` required→optional (the schema
column is already nullable — only the signup zod enforces required); FE phone
normalize-at-repoint (un-normalized owner phone would 400 against the backend E.164
validator); FE `updateProfile` single-method splits by section at the repoint; FE
documents add the `type` discriminator + swap `supabase.storage`→this API. Closes
2026-05-24. **Phase 1d (sign-in flow) opens next** — its first verification is the
real-cookie session round-trip through the Commit-3 `requireAuth` guard, closing the
session-creation boundary Commit 3 deliberately left open (Commit 3 only validated
sessions; creation is Phase 1d).

---

## 15. Phase 1d — Session auth (sign-in/out + password management)

Phase 1d is the fourth feature-building phase and the **shortest** — better-auth owned the
session machinery, so the work was wrap-and-shape, not build. Two feature commits complete
the session-creation surface: `e9ee9a5` (`POST /api/signin` + `POST /api/signout`, with the
real-cookie round-trip) and `aa8121d` (password management — reset-request/reset/change).
See the §4 "Already resolved" Phase-1d row for full detail, gate floors, and plan-doc
references.

**The session-auth surface is now complete server-side:** signup → verify → signin →
authenticated requests → signout → password reset → change. Commit 1's first act was the
round-trip the §14 pointer named — a real minted session cookie replayed through the
Commit-3 `requireAuth` guard — closing the session-creation boundary Commit 3 deliberately
left open (it had validated sessions only, with a mocked session).

It used the same operating pattern as Phases 1a–1c (§7.6) — inventory-first plans,
halt-on-finding, CF-9 pause summaries, per-commit gate verification, CI-green on every
push — extended with real-cookie round-trip verification through the auth guard and an
`emailSender.send` spy for the anti-enumeration symmetry + SMTP-fail-still-generic
assertions. **No new formal CF** (CF-19–24 all already formal); accumulates **CF-23/24**
instances and holds **CF-21** clean (§7.4); captures three operating learnings (§7.6).
Gate floor moved `apps/api` **99 → 122** / root **259 → 282** (signin +11, password +12;
`apps/web` held at 160).

**Phase-1e carry-forwards** (now substantial — the frontend repoint is the largest phase):

- signup-route `tax_number` required→optional
- FE phone normalize-at-repoint
- FE `updateProfile` single-method splits by section
- FE documents: `type` discriminator + `supabase.storage`→API swap
- FE signin repoint + routing-field consumption + verify-first (403) + generic-credentials handling
- FE password reset/change repoint + 12-char floor convergence + the reset-page (the reset link's `callbackURL`, like the verification `callbackURL`)

Note the **`apps/web` typecheck-floor change** expected as Phase 1e opens (§7.6): Phase 1e
is the first phase to touch `apps/web`, so the long-flat 51/1 baselines are expected to
move as Supabase is removed — a drop, not a regression. Closes 2026-05-25. **Phase 1e
(frontend repoint — the largest phase) opens next.**

---

## 16. Phase 1e Part A — Backend prerequisites (browser-reachability + signup-grows + reference data)

Phase 1e Part A is the backend half of the frontend-repoint work — the prerequisites that make
`apps/web`'s repoint possible. It opened with the **frontend repoint survey** (`3d84dd8`,
`docs/handoff/frontend-repoint-survey.md`): a read-only architecture map of `apps/web`'s
Supabase surface that established the repoint shape and surfaced the load-bearing prerequisites
(no HTTP client in `apps/web`, no CORS on `apps/api`, the better-auth cookie model). See the §4
"Already resolved" Phase-1e-Part-A row for the full per-commit detail, gate floors, and plan-doc
references.

**The renumbering (reconciliation of §13/§15's "1e = frontend repoint").** The survey's §8 found that
the single label "Phase 1e — frontend repoint" actually covered two phases with different work-nature
and verification models, and **split it: Phase 1e = BACKEND PREREQUISITES (this, Part A — `apps/api`,
the 1b–1d real-integration rhythm) and Phase 1f = FRONTEND REPOINT (`apps/web`, a new verification
model)**, pushing admin→1g and deployment→1h. The §15 pointer ("**Phase 1e (frontend repoint — the
largest phase) opens next**") and the §13/§14/§15 references to "Phase 1e = frontend repoint" all
predate this split and now read as **Phase 1f**; the §7.6 floor-interpretation note's "Phase 1e is
the first to touch `apps/web`" is likewise now Phase 1f (Part A was backend-only — `apps/web` held at
51/1/160/139.80). Per the honest-trail discipline (the §13 Model-1 precedent: clarify, don't rewrite
the old reference), the older pointers stand and this section is the reconciliation.

It used the same operating pattern as Phases 1a–1d (§7.6) — inventory-first plans, halt-on-finding,
CF-9 pause summaries, per-commit gate verification, CI-green on every push — with the load-bearing
work concentrated in **survey-driven scoping** (build to the frontend's reality: the WiFi columns and
`company_size` endpoint were NOT built because the wizard doesn't collect/store them) and the
**four-round better-auth origin-check investigation** that completed the CF-23 taxonomy (§7.4). **No
new formal CF**; accumulates CF-23 (taxonomy completed) / CF-24 (truthful-to-frontend) / CF-21
instances (§7.4); captures four operating learnings + the proven CSRF model and money-slice gate
(§7.6). Gate floor moved `apps/api` **122 → 146** / root **282 → 306** (Commit 1 +8, Commit 2 +10,
Commit 3 +6; `apps/web` untouched — backend-only). Closes 2026-05-25.

**Phase-1f carry-forwards (the frontend repoint — the largest phase):**

- `auth.service.ts` → an **API client** (a `fetch` wrapper with `credentials:'include'` so the
  httpOnly cookie rides every request; `VITE_API_URL`; identity rehydrated from the cookie via
  `GET /api/me`, since JS can't read the cookie) + the `auth.store` session-model swap (off
  Supabase's `onAuthStateChange`/`persistSession` onto the cookie + `/api/me`).
- **signin** repoint — consume the routing body (role/status/`onboarding_completed`/`profile_type`),
  the **403 verify-first** branch, generic-credentials handling.
- **signup wizard** repoint — send the full profile the backend now accepts (`contact_name` wire,
  `agent_toodooh`, `terms_accepted`, `tax_number` optional, `profile_type` as a non-privileged hint);
  stop disclosing email-existence (consume the 201-generic); converge the password floor to **12**.
- **reference fetches** — `useSectors` → `GET /api/business-sectors?audience=advertiser`,
  `useOwnerBusinessSectors` → `?audience=owner`, `useGovernorates` → `GET /api/governorates`; the
  advertiser **`company_size`** dropdown **hardcodes** its options (a frontend constant, like the
  owner `parcCountOptions` — the §2.C ruling, no backend).
- **profile** repoint — the `updateProfile` single method splits into the four section PATCHes
  (`/api/profile/{business,contact,address,notifications}`).
- **documents** repoint — add the `type` discriminator + swap `supabase.storage` →
  `POST/GET /api/profile/documents/:type`.
- **password** reset/change repoint + the 12-char convergence (drop the 6-char service guard) + the
  owner-settings special-char drop.
- the **`/auth/verify-email` page** (the deferred Phase-1b `callbackURL`) + the **reset page** (the
  reset-link `callbackURL`), with a post-verify "please sign in" page.

**Phase 1f (frontend repoint — the largest phase) opens next**, on a **new verification model** (§6
of the survey): the `apps/api` real-integration pattern doesn't transfer to browser code, so 1f gates
on build + typecheck-ratchet-down + lint-1 + the existing 160 green, **plus** new per-flow
component/service tests (a deliberate test-floor raise) + a running-both round-trip + **human visual
QA** at phase close. Expected `apps/web` floor movement: typecheck **51 drops partially** (account-layer
types resolve as Supabase leaves; campaigns/screens/admin stay on Supabase), while **lint-1 stays
through 1f** (the shared `supabase.ts` + `database.types` import survive until the last slice / #15) —
neither is a regression (§7.6 floor note + survey §2.4).

---

## 17. Phase 1f — Frontend repoint

Phase 1f is the largest phase of the project: every user-facing flow rewired off Supabase onto the
apps/api backend the four prior phases shipped. **Ten commits** across the per-flow arc K → F1 → F2
→ F3 → F4a → F4b → F5 → F6 → F7a → F7b, each CI-green. See the §4 "Already resolved" Phase-1f row
for full per-commit detail, gate floors, and plan-doc references; this section is the closing
summary.

The phase opened with the **keystone design read** (`5d46b48`,
`docs/handoff/phase-1f-keystone-design.md`) — a source-driven design of the api-client + the
auth-store session model that produced 10 ratified D-rulings (D1-D10) every per-flow commit
consumes. The **keystone commit** (`0c9826a`) implemented `lib/api-client.ts` (typed fetch
singleton, base `/api` via same-origin proxy, `credentials:'include'`, the two-error-shape
normalizer), `lib/auth-errors.ts` (`apiErrorMessage` code→French), and the auth-store rewrite
(`/api/me` rehydration + the fetch-authoritative + cushion-only persist + the 401-mid-session
shared-clear). Per the centralize-first premise (survey §1.4), the 30 importers of `useAuthStore`

- the 16 of `authService` were untouched by construction — the per-flow commits became thin
  adapters.

The seven repoint commits each closed one user flow: **F1** the reference reads (sectors /
governorates / company_size hardcoded per D8), **F2** the 1940-line signup wizard (the largest
single file repoint of the project), **F3** the verify-email page + cross-package `callbackURL`
wiring (the only Phase-1f commit that touched apps/api, adding `sendOnSignIn=true` for the
unverified-signin recovery loop), **F4a/F4b** the profile-edit surface as 4 section PATCHes

- the `/api/me` read-bridge (advertiser then owner), **F5** the document upload as multipart
  post-signin with `rne|cin` discriminator, **F6** the password domain (reset-request +
  reset-landing token-consumption + change). Then the two cleanup commits: **F7a** the
  independently-dead removals + the 848-line hidden `MyAccount.tsx` consolidation (a duplicate
  page reachable only by URL — the OwnerDashboard CTA was `className="hidden ... aria-hidden"`),
  and **F7b** the deferred-control wirings (logo + doc-remove + deactivation actually severed,
  not just captioned) + the cascade-removal of `updateProfile` + `deactivateAccount` +
  `mapAuthError` (the 157-line any-typed Supabase-error-string map).

**The thin-adapter outcome (the phase's headline).** The centralize-on-the-keystone premise
held across **all seven** per-flow repoints — F1 (easy), F2 (the 1940-line wizard, the hardest
file), F4 (split into 4 saves + the read-bridge), F5 (multipart), F3 (cross-package), F6
(cross-page domain). Each per-flow commit was a localized data-flow change, not a consumer
rewrite. **Consequence:** the jsdom + Testing Library infra the keystone design ratified (D10)
was **provisioned but never needed** — the thin-adapter architecture structurally kept the
load-bearing logic in the service layer, which is node-testable without a DOM. The 57 new
`apps/web` tests are all node-level (api-client + apiErrorMessage + auth-store with mocked
fetch + the auth.service reference/profile/password/signup unit suites + utils). RTL would
have covered only form-binding (framework behavior), not project behavior. Render correctness
moved to the **phase-close human visual QA** as the gate the assistants can't simulate.

**The gate arcs (Phase 1f, `apps/web`-only except F3):**

- **Typecheck `51 → 36`** (-15) — account-layer Supabase types resolve as the repoint
  progresses; the F4a/b read-bridge alone resolves ~12, the F7b cascade resolves the rest. The
  remaining **36** are pre-existing later-slice errors (react-leaflet typings,
  AdminActivity/AdminProfile, dooh-location-affluence-engine, the `database.types` propagation
  through 59 later-slice importers) — they clear at the **last-slice ratchet** when
  `supabase.ts` + `database.types` finally go.
- **Lint `1 → 1`** (flat) — the single `import-x/no-unresolved` on `database.types` in
  `lib/supabase.ts` survives through Phase 1f exactly as survey §2.4 predicted. Clears with the
  last slice's removal of `supabase.ts`.
- **Test `160 → 217`** (+57) — all new tests are `apps/web` node-level. The keystone's RTL-raise
  ambition (D10) was deliberately not exercised (the thin-adapter outcome above made it
  unnecessary).
- **Build main `139.80 → 135.73 kB`** gzip (**-4.07 kB net — the repoint made the app SMALLER**).
  The dead Supabase chunk + the F7a/F7b removals (848-line MyAccount + the 157-line mapAuthError
  - updateProfile + deactivateAccount + the dead handlers/state) exceeded the new pages (verify-email +
    reset-landing) + the new api-client + apiErrorMessage. Notable per-chunk: OwnerSettings
    `44.08 → 39.63 kB` (-4.45 kB) post-F7b; the MyAccount lazy chunk gone post-F7a.
- **apps/api `146 → 146`** (untouched except F3) — F3 added `sendOnSignIn=true` to `auth.ts`
  - the absolute `callbackURL` to `signup.ts` + extended an existing test (Q8 in `signup.test`)
    rather than adding a new test file/case; the floor held flat. CI-verified across every commit.

**Closes 2026-05-26** (CI-green on `737b43f`). Phase 1f's **record** closes with this audit
refresh; the **phase itself** closes after the phase-close human visual QA (the three F7b-disabled
controls + the F1-F6 repointed flows end-to-end against `pnpm dev` running both apps).

### 17.1 — Phase-1f carry-forwards (consolidated)

Deferred features — each tracked to its real consumer (the **build-with-first-consumer**
discipline, §7.6 / require-auth precedent). Most are functional reductions vs the Supabase
legacy: the FE wire is built, the inputs render, persistence is the missing piece each
later-slice adds.

- **Account deactivation backend** — `POST /api/account/deactivate` + `current_password` re-auth
  (mirrors `/password/change`); on success: revoke all sessions + soft-delete (column to add).
  F7b's defensive disable + the `support@too-dooh.com` static message stays until this slice ships
  (D-F7-2). Closes the class-(b) UX honesty gap.
- **Logo storage** — column on `users` + `POST /api/profile/documents/logo` (or a dedicated
  `/api/profile/logo` endpoint) + the logo-display read-path in `/api/me` + re-enable the
  F7b-disabled Changer + Supprimer controls in UserProfile + OwnerSettings (D-F4-4).
- **Owner-extras persistence** — `number_of_screens`, `number_of_rooms`, `company_size` columns
  (or a side table for company_size with the reference endpoint) + un-`.strip()` the signup
  acceptedFields + un-`.strip()` the profile PATCH + re-enable the read-path for the
  owner-settings entreprise sub-form inputs (currently collect-and-ignore — the named
  functional reduction, §7.6). The owner slice is the natural consumer.
- **Document DELETE endpoint** — `DELETE /api/profile/documents/:type` + re-enable the F7b-disabled
  remove control (currently disabled for uploaded docs; replace-by-re-upload is the only path)
  (D-F5-3).
- **`company_size_options` reference table + endpoint** — the slice that persists `company_size`
  (likely the owner slice — see above) also stores the option set somewhere; whether a dedicated
  `company_size_options` reference table or an enum on `users` is open. The advertiser FE
  hardcoded inline (D8) until then.
- **WiFi-at-signup** — wizard already collects WiFi SSID + password (the screenhost establishment
  fields); the columns + the provisioning consumer (the Android TV APK / `apps/player-api`)
  ship together as part of the screenhost-onboarding slice. Per Phase 1e Part A's "intentionally
  plaintext non-sensitive" decision, the WiFi password stays cleartext (public-venue shared
  credential, needed by the device-provisioning flow).
- **Money-slice `assertOrigin ∈ [WEB_ORIGIN]` CSRF gate** — defense-in-depth beyond `SameSite=Lax`
  for the wallet/recharge/payment mutating routes (§7.6 / Phase-1e CSRF model). Built with the
  first money-route consumer per the build-with-first-consumer discipline.
- **`support_objectives` + later-slice Supabase callers** — `getAppointmentObjectives` stays on
  Supabase (D8 leave-on-Supabase, has 2 callers); `performance.service.ts:449` (the second
  `owner_business_sectors` site flagged since F1) is later-slice and inherits with the
  performances/dashboards repoint (D-F7-7 OUT). Each cleans at its slice.
- **The inline-`#76E6AB` styling pass** — ~13 legacy files still carry the inline hex (the
  Algae-Green new-brand colour, mid-Step-12 rebrand artifact); net-new code uses the
  `brand-primary` Tailwind token. A small dedicated commit converts them when their feature
  slices next get touched — tracked but not blocking any user flow.
- **The `database.types` lint-1 floor** — clears at the LAST Supabase removal (when the 59
  later-slice importers are repointed and `supabase.ts` itself goes); a future-slice cleanup,
  Phase-1f close was always going to leave this at 1 (survey §2.4 prediction held).
- **`autoRefreshToken: false` on `supabase.ts`** — deferred to the #15 last-slice Supabase
  removal. The phase-1f-tail dashboard-render fix (`b5d3454`) wanted to flip this off to kill the
  ~10s `ERR_NAME_NOT_RESOLVED` auto-refresh loop, but staging `supabase.ts` trips the husky
  lint-staged raw `eslint` on the pre-existing `database.types` baseline error (CI tolerates it
  via the baseline gate; lint-staged does not — see the lint-staged-baseline blocker). Splitting
  off this single knob landed the rest of the fix cleanly (the auth-store `sb-*-auth-token`
  localStorage sweep, which clears the token that **drives** the loop, covers the symptom for
  migrated users meanwhile). The knob is a durable belt-and-suspenders guard; it lands naturally
  when `supabase.ts` can be staged clean — i.e. alongside the #15 `database.types`/supabase
  removal above.
- **Strict tax_number matricule validation** — current backend zod is lenient (any
  non-empty string); the strict matricule format (Tunisian tax-number pattern) waits for the
  validation slice.
- **2FA** — a planned post-launch security addition; not Phase 1f scope.

Done in Phase 1f (resolved, not carry-forwards):

- **MyAccount consolidation** — the 848-line hidden duplicate page deleted (F7a). The page was
  invisibly orphaned (no nav link; URL-only) and fully covered by OwnerSettings. Negative LOC;
  no user-visible change.
- **The caption-vs-wire defers** — the D-F4-4 (logo) and D-F5-3 (doc-remove) defers, captioned-
  but-not-wired through F4/F5, were **severed at the source** in F7b. The disabled controls now
  match the captions; the dead handlers + state + Supabase chains are gone.

### 17.2 — What's next

**Phase 1f closes the repoint arc (K → F7b), but it does NOT close all frontend work.** A
frontend design/landing phase precedes admin (1g):

- **Landing page** — a net-new public entry: the unauthenticated visitor's first screen + CTA
  into signup/login. The asset currently lives as a **standalone local folder** (not a repo);
  the lean is to **integrate it INTO `apps/web`** as the public root route (`/`), keeping **one
  origin** — the same-origin-cookie + one-deploy model Phase 1h depends on, not a separate
  app/deploy. An **adaptation** (reconcile its deps/styling onto `apps/web`'s stack + design
  tokens), not a transplant.
- **Figma design-alignment** — recheck design/colours/tokens against the Figma source of truth
  via the Figma connector; **no functional changes** (gates flat, visual is the check); likely
  clears the inline-`#76E6AB` styling debt (§17.1) as the design-system alignment. Overlaps
  the landing integration (integrate + align + tokenize = one effort for the landing page).

The naming of this phase is **not pre-committed** — settle "1f-postscript" vs "1g (landing)"
vs renumbering admin→1h etc. when the phase opens. Recorded here so the trail shows the
deliberate design/landing phase between the repoint close and the admin slice, not a jump
straight to admin.

**Then Phase 1g (admin) opens** after the phase-close human visual QA + the landing/Figma
phase. The admin slice is the remaining gated surface: admin login, the admin dashboards
(users + screens + recharges + campaign monitoring + platform stats + events), the admin
destructive ops (#16 observability), and the deactivation backend tracked above. Admin
currently still imports `@/lib/supabase` directly (per survey §2.3, deliberately out-of-scope
through Phases 1a-1f); Phase 1g repoints those callers to apps/api admin endpoints (yet to
design).

**Phase 1h (deployment)** follows admin — the VPS-gated production rollout. The keystone's
same-origin proxy mirrors the planned nginx single-origin production layout (see
`pnpm via corepack` memory + the OVH hosting snapshot memory), so the Phase 1f infrastructure
choices transfer; Phase 1h adds the nginx config, the systemd units, the production env block,
and the DNS/TLS termination. The OVH→Gmail domain-reputation warm-up (Phase 1b carry-forward)
joins this phase.

The cleanup phase's two contracts (no UI/UX change + no gate regression) **do not** transfer to
Phase 1g/1h — Phase 1g rebuilds the admin surface (UI changes by definition), and Phase 1h is
infrastructure that may move floors. The phase-1 working pattern transfers: inventory-first
plans, halt-on-finding, CF-9 pause summaries, per-commit gate verification, CI-green on every
push, the two-assistant architect/executor/human role separation.
