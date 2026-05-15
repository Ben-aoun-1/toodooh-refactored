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

_As of commit `6c48d30` (post-Step-7 Dashboard + NewCampaign decomposition + orchestrator cleanup)._

| Metric                             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files under `apps/web/src/`        | ~245 (Step 7 added 9 new files: `hooks/useWizard.ts`, `hooks/new-campaign/{useCampaignWizard,wizard-types,wizard-steps,wizard-serialize,wizard-init}.ts`, `pages/new-campaign/{Step1NameType,Step2,Step3,Step4,Step5,Step6,PostCartStep}.tsx`, `lib/wizard-zones.ts`, plus AdvertiserDashboard split + 4 hooks + 6 components from Commit 4). Dashboard.tsx retired in Commit 7.                                                                |
| Lines of `.ts`/`.tsx`              | similar net to pre-Step-7 (Step 7 is decomposition, not deletion: ~7000 lines moved from 2 mega-files into ~25 new files + orchestrator)                                                                                                                                                                                                                                                                                                       |
| Files > 1000 lines                 | 13 (`NewCampaign.tsx` 1624 — was 4359; `Dashboard.tsx` retired; `auth/SignUpForm.tsx` 1954, `OwnerSettings.tsx` 1845, `MyCampaigns.tsx` 1748, `admin/UserManagement.tsx` 1485, `UserProfile.tsx` 1394, `admin/EventManagement.tsx` 1247, `OwnerCampaigns.tsx` 1235, `Onboarding.tsx` 1228, `OwnerDashboard.tsx` 1209, `services/campaign.service.ts` 1127, `OwnerScreens.tsx` 1100, `services/auth.service.ts` 1055, `admin/CampaignMonitoring.tsx` 1006) |
| Files > 500 lines                  | ~38                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm typecheck`                   | **58 errors** (66 → 58, -8 net across Step 7's `any`-elimination cleanups on extracted files; remaining 58 are unchanged Cat-A pre-existing untyped-root cascades tracked in #15 for Phase 1)                                                                                                                                                                                                                                                  |
| `pnpm lint`                        | **370 problems (352 errors, 18 warnings)** — top rules: `jsx-a11y/label-has-associated-control` 230, `no-useless-catch` 71, `jsx-a11y/click-events-have-key-events` 26, `jsx-a11y/no-static-element-interactions` 23, `react-hooks/exhaustive-deps` ~18 (warn), `import-x/order` ~7, `jsx-a11y/media-has-caption` 6. **`no-console`: 0** ✓ · **`@typescript-eslint/no-explicit-any`: 0** ✓ · **`@typescript-eslint/no-unused-vars`: 0** ✓ · **`no-empty`: 0** ✓ |
| `pnpm test`                        | 8 suites pass (above 7 + `hooks/new-campaign/useCampaignWizard.test`); **98 tests**; 0 failures                                                                                                                                                                                                                                                                                                                                                |
| `pnpm --filter @toodooh/web build` | passes — main `index-*.js` 447 kB / gzip **131.42 kB** (vs post-Step-6 130.71 kB; +0.71 kB net = wizard hook + step-component machinery). Dashboard chunk retired; new NewCampaign chunk: gzip **25.77 kB** (was 27.71 kB pre-Commit-12; the orchestrator-cleanup commit shed 1.94 kB).                                                                                                                                                         |
| CI (`main`)                        | **red** — expected; goes green at Step 13                                                                                                                                                                                                                                                                                                                                                                                                      |

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
  …) — pre-existing, unchanged. → **Step 11 · #9**
- **`no-useless-catch`: 71** — pre-existing, unchanged. Try/catch wrappers that immediately re-throw
  the caught error. Most are legitimately removable; some carry the binding into a
  `throw new Error(mapAuthError(e))` pattern that should be preserved. → **Step 11 · #9** or
  bundled with the observability-pass that addresses #16.
- **`react-hooks/exhaustive-deps`: 22** (warnings) — pre-existing latent stale-closure risks.
  → **Step 11 · #9**
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
→ **Step 9 · #5**

### Hardcoded `#00B3A6`

449 occurrences of the brand hex; should be a Tailwind `brand` theme token. → **Step 12 · #10**

### `jsx-a11y` / `react-hooks/exhaustive-deps`

~287 `jsx-a11y/*` errors (`label-has-associated-control` ~230, `click-events-have-key-events` ~26,
`no-static-element-interactions` ~23, plus `media-has-caption`, etc.); 27
`react-hooks/exhaustive-deps` warnings (latent stale-closure risks). → **Step 11 · #9**

### Flat folder structure

`src/` is flat `pages/` + `components/` + `services/` + `stores/`, not the feature-based
`src/features/<domain>/` the architecture conventions call for. → **Step 8 · #4**

### No server-state layer

TanStack Query is not used; data fetching is hand-rolled (call a service in a component, `setState`).
Conventions want React Query for server state and Zustand for client state, no mixing. → **Step 10 · #6**

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

`apps/web/package.json` carries devDeps that duplicate root-level ones (`eslint`, `@eslint/js`,
`eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, `typescript-eslint`,
`typescript`); `eslint-plugin-react-refresh` is unused (root ESLint config doesn't load it).
→ **Step 14 · #13**

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
the 1100-1200 line-count target / 1624 actual gap in the orchestrator cleanup. *(Originally
captured as two separate items during Step 7; merged into one entry as they refer to the same
methodology of verifying inventory predictions before publishing.)*

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

---

## 4. Already resolved

- **`react-hooks/rules-of-hooks`** — 0 (was 20, all in `admin/CampaignMonitoring.tsx`; commit `bc63fb1`).
- **`itstrategix.tn` redirect** — removed; auth email redirects are now env-driven via `lib/app-url.ts` / `VITE_PUBLIC_APP_URL` (commit `854f112`).
- **Eager bundle / no code-splitting** — every route is `React.lazy()`; main bundle 3.25 MB → ~434 kB (commits `95df8a1`, `d80ef19`, `290024a`).
- **Formatting & import hygiene** — one-time Prettier + ESLint `import-x/order`/`prefer-const` autofix + unused-import removal (`eslint-plugin-unused-imports`) (commits `82e8f66`, `c8b5f17`, `39536c1`; recorded in `.git-blame-ignore-revs`).
- **Step 5 — Frontend logger + `console.*` purge** — Pino logger module landed at `apps/web/src/lib/logger.ts` with dev/prod/test config (silent in vitest, debug in dev, info in prod). 901 `console.*` calls (446 .log + 421 .error + 33 .warn + 1 .info + 1 .table) removed or promoted across 46 files. 222 `console.error` promoted to `log.error` and 33 `console.warn` to `log.warn` via pino child loggers scoped per-module; the rest were deleted (Cat-1 debug detritus, Cat-2a console.error+throw, Cat-2b console.error+toast — all signalled elsewhere). `no-console: 'error'` ESLint rule enforced project-wide. Bundle gzip 128.61 → 130.50 kB (+1.89 kB net pino-browser cost). Side effect: typecheck rose 179 → 197 (19 TS6133 unused-variable unmasks surfaced by removing console.log consumers; deferred to Step 6). → Issue #7. Commits `20d5034`, `f65bd16`, `c61934d`, `f0ebb37`, `22f26cc` (this audit refresh + Step-5 close-out).
- **Step 6 — Typing pass + regression remediation** — 265 `@typescript-eslint/no-explicit-any` → 0 (134 fixed via Cat-D narrowing + Cat-C strips + Cat-B refactors; 131 marked `TODO(phase-1)` and tracked in #15); 161 `@typescript-eslint/no-unused-vars` → 0 via `_`-prefix + delete + restructure; TS6133 typecheck subset 197 → 66 as mirror drop (66 residue all Cat-A untyped-root cascades → #15); 26 `no-empty` → 0 via else-deletion + per-site catch-fallback comments + 1 orphan-binding cleanup. Five P0 hotfixes shipped during the regression remediation cycle triggered by Commit 4 unmasking incomplete error-handling: P0a (`830c7b9` recharge destructure), P0b (`277c68f` deleteUser cascade), P0c (`a59cfb9` document upload), P0d (`b3f50cb` cart-add + save-draft). Three tracking issues opened: #15 (Phase-1 typing prerequisites), #16 (admin destructive ops observability), #17 (Tier-3 read-only fetch observability). Full methodology + 15 learnings in `docs/audits/2026-05-14-step-6-regression-audit.md`. Bundle gzip 130.50 → 130.71 kB (+0.21 kB net). → Issue #8. Commits `6d212fb` (Commit 0), `c007783`, `9c4839b`, `ed7c261`, `abe594c`, `62e8813`, `0af5cc3`, `00d464e`, plus this audit refresh + #8 close-out.
- **Step 7 — Dashboard + NewCampaign decomposition** — `Dashboard.tsx` (2635 lines) retired entirely, replaced by `AdvertiserDashboard` page + 4 hooks + 6 components + ModalProvider (Commits 1-4) + App.tsx route flip pointing all 12 advertiser routes at their real page components instead of `<Dashboard />` (Commit 7). The "Mes performances" sidebar entry restored per Figma `Performances.png` (tracked in #19 for the page-body rebuild). `NewCampaign.tsx` 4030 lines → **1624 lines** (-2406 net, ~60% shrink) via extraction of the campaign wizard's 6 steps into `pages/new-campaign/{Step1NameType,Step2,Step3,Step4,Step5,Step6,PostCartStep}.tsx`, the wizard state machine into `hooks/new-campaign/useCampaignWizard.ts` (composed over a generic `hooks/useWizard.ts`), pure functions into `wizard-{steps,serialize,init}.ts` + `lib/wizard-zones.ts`, and the dead-modal + dead-sidebar cascades surfaced by the setter-to-true and CSS-gated dead-UI detection patterns (Commits 9, 12). Path B chosen for the Save/AddToCart flow (extract verbatim) when the parent's inline handlers were found to have diverged from the Commit 5 `useCampaignWizard` wrappers across 5 production behaviors — tracked in #20 for future reconciliation. Figma consultation rule formalized in Commits 9-11 after the retroactive Performances.png finding; first proactive product-gap finding produced (#21 post-cart placement on /panier vs wizard). 19 methodology carry-forwards captured for the methodology learnings refresh in 13b. Typecheck 66 → 58, lint 395 → 370, tests 77 → 98 (21 new pure-function tests on the wizard's serialize/perform layer). Bundle gzip 130.71 → 131.42 kB (+0.71 kB net = wizard machinery); Dashboard chunk retired entirely; new NewCampaign chunk gzip 25.77 kB. Three follow-up tracking issues opened: #19 (Mes performances page rebuild per Figma), #20 (hook-wrapper adoption: reconcile useCampaignWizard with inline cart-add behavior), #21 (post-cart recommendations placement: wizard vs cart page per Figma). → Issue #3. Commits `46ae53d` (discovery), `dd9a066`, `2ba80bf`, `843498d`, `6022672`, `53bea06`, `5511110`, `6e47c6a`, `2a25ad8`, `329f576`, `ceec832`, `2bc7ebf`, `fade44f`, `6ed1103`, `6c48d30`, plus this audit refresh + #3 close-out.

---

## 5. Roadmap

Ordering principle: **decisions & deletions first** (shrink the surface) → **isolate the real IP**
(the DOOH engine) → **bulk mechanical sweeps next** (console-purge, typing pass — done before
decomposition so they run once on the current shape, not twice on the decomposed shape) →
**structural decomposition + restructure** (Dashboard/NewCampaign decomp, then features/<domain>/
folder layout) → **remaining mechanical passes** (jsx-a11y, brand token, tsconfig re-tighten) →
**tidy-up at the end** (CI green, devDeps hoist). Each step gets its own brainstorm → spec →
plan → execute cycle.

| #   | Step                                                                                                                                                           | Touches (roughly)                                                                                                                                                                               | Done when                                                                                                                                                                                                                                                                                                                                                                                    | Issue | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| 1   | Cleanup audit & roadmap (this doc)                                                                                                                             | `docs/audit.md`, GitHub issues/milestone                                                                                                                                                        | doc committed; issues created                                                                                                                                                                                                                                                                                                                                                                | —     | ☑      |
| 2a  | Resolve duplicate pages and delete orphans                                                                                                                     | `pages/MyCart.tsx`, `pages/admin/AdminDashboardSimple.tsx` (deletions)                                                                                                                          | the two genuinely-dead files deleted (zero refs); typecheck/lint/test/build not regressed; the rest of §3's duplicate-page list is Dashboard-coupled → resolved in Step 7                                                                                                                                                                                                                    | #1    | ☑      |
| 2b  | Resolve duplicate services                                                                                                                                     | `services/campaigns.service.ts`, `services/api/screens.api.ts`, `services/api/` (deletions)                                                                                                     | the two dead service files deleted (zero refs); `services/api/` dir removed; typecheck/lint/test/build not regressed; admin-cluster consolidation moved to Step 8 notes                                                                                                                                                                                                                      | #14   | ☑      |
| 3   | Consolidate the auth-state layer                                                                                                                               | `stores/auth.store.ts` (persist + de-localStorage), `services/auth.service.ts` (stateless), `App.tsx` (drop `clearAuthCache` import), `pages/ContactPage.tsx`, delete `utils/clearAuthCache.ts` | `auth.store.ts` uses `persist`; no `localStorage` in `auth.store.ts`/`auth.service.ts`; `clearAuthCache.ts` deleted; `onAuthStateChange` subscription captured; `ContactPage` on the store; `Dashboard`+`Onboarding`+cart `localStorage` deferred to Step 7; typecheck/lint/test/build not regressed                                                                                         | #2    | ☑      |
| 4   | Decouple DOOH engine's pure math from Supabase (4a) + write the v3.0 pricing model as a tested, unwired pure module (4b). Wiring + schema + UI = Phase 1 (4c). | `apps/web/src/lib/dooh/{config,dates,hourly-plan,v3-model}.ts` + `README.md`; `docs/handoff/pricing-model-v3.md`, `Toodooh_Simulateur_Pricing_v3.html`, `v3-data-requirements.md`               | `pnpm test` exits 0 (previously-failing `campaign-hourly-location-plan` test passes from `lib/dooh/hourly-plan.test.ts`); `lib/dooh/v3-model.ts` implements the v3.0 model and its tests match the simulator's numeric examples; `lib/dooh/README.md` documents the model + function↔simulator mapping; v3.0 is unwired (build output unchanged); 4c (wiring/schema/UI) tracked for Phase 1. | #12   | ☑      |
| 5   | Frontend logger + `console.*` purge                                                                                                                            | new logger; ~917 call sites; ESLint config                                                                                                                                                      | 0 `no-console` errors                                                                                                                                                                                                                                                                                                                                                                        | #7    | ☑      |
| 6   | Typing pass: fix `as any`, reduce tsc baseline, re-tighten tsconfig                                                                                            | many files; `tsconfig.app.json`                                                                                                                                                                 | 265 no-any → 0 (134 fixed directly, 131 marked TODO(phase-1) → #15); 161 no-unused-vars → 0; 26 no-empty → 0; typecheck 197 → 66 (66 residue = Cat-A untyped-root cascades, → #15); tsconfig un-softening deferred to Phase 1 with #15; regression cycle P0a-P0d shipped                                                                                                                     | #8    | ☑      |
| 7   | Decompose `Dashboard.tsx` / `NewCampaign.tsx`                                                                                                                  | `pages/Dashboard.tsx` (retired), `pages/NewCampaign.tsx` (4030 → 1624), `App.tsx` routes, `pages/new-campaign/*` (7 step components), `hooks/new-campaign/*` (5 hook+pure-fn files), `lib/wizard-zones.ts` | Dashboard retired, replaced by AdvertiserDashboard + 4 hooks + 6 components; NewCampaign decomposed into wizard-hook + 6 step components + PostCartStep; bundle Dashboard chunk eliminated; new NewCampaign chunk gzip 25.77 kB; 21 new pure-function tests on the wizard serialize/perform layer; 3 follow-up issues (#19/#20/#21). 15 commits over the work session. | #3    | ☑      |
| 8   | Restructure `src/` into `src/features/<domain>/`                                                                                                               | almost all of `src/`                                                                                                                                                                            | feature-based layout per conventions; imports updated; build OK                                                                                                                                                                                                                                                                                                                              | #4    | ☐      |
| 9   | Replace `window.location.reload()` in `MyAccount.tsx`                                                                                                          | `pages/MyAccount.tsx`                                                                                                                                                                           | 0 `window.location.reload()` calls                                                                                                                                                                                                                                                                                                                                                           | #5    | ☐      |
| 10  | Introduce React Query for server state                                                                                                                         | new query layer; (post-decomposition) pages                                                                                                                                                     | server data via React Query; Zustand limited to client state                                                                                                                                                                                                                                                                                                                                 | #6    | ☐      |
| 11  | `jsx-a11y` + `exhaustive-deps` cleanup                                                                                                                         | many `.tsx` files                                                                                                                                                                               | 0 `jsx-a11y/*` errors; 0 `exhaustive-deps` warnings                                                                                                                                                                                                                                                                                                                                          | #9    | ☐      |
| 12  | Tailwind `brand` token: replace hardcoded `#00B3A6`                                                                                                            | `tailwind.config.js`; 449 call sites                                                                                                                                                            | 0 hardcoded `#00B3A6`; `brand` token in use                                                                                                                                                                                                                                                                                                                                                  | #10   | ☐      |
| 13  | Get CI green                                                                                                                                                   | `.github/workflows/ci.yml`                                                                                                                                                                      | CI green on `main`; no `--no-verify` needed for normal commits                                                                                                                                                                                                                                                                                                                               | #11   | ☐      |
| 14  | Hoist duplicate devDependencies to root                                                                                                                        | `apps/web/package.json`, root `package.json`                                                                                                                                                    | `pnpm install` resolves cleanly; no duplicate devDeps across workspaces (`eslint-plugin-react-refresh` removed if unused)                                                                                                                                                                                                                                                                    | #13   | ☐      |

---

## 6. Maintenance

When a roadmap step lands:

1. Tick its box in the Roadmap table (`☐` → `☑`) and add the merge commit.
2. Close its GitHub issue (link the commit / PR).
3. Move its anti-pattern subsection's findings into **§4 Already resolved** (or trim them).
4. Refresh the **§2 Snapshot** numbers.

The milestone is **Frontend cleanup phase**; all step issues carry the `cleanup` label plus an
`area:*` label.
