# Step 8 — `src/features/<domain>/` restructure — discovery

_Discovery output for audit Step 8 (Issue #4)._
_Baseline commit: `6c48d30` (post-Step-7)._
_Authoritative roadmap: `docs/audit.md` §3 "Flat folder structure" + §5 row 8._

This is the **discovery commit** for Step 8. It freezes the baseline gate numbers, inventories every
file under `apps/web/src/`, surfaces the seams in the eight-feature shape proposed in the kickoff,
and lists the decisions the user must lock before plan-writing.

**No files move in this commit.** This is read-only inventory + a structured decision request.

---

## Section 0 — Baseline (verification numbers)

All four gates run from `apps/web/` with Node 20.20.2 (engines pin), pnpm 9.15.4.

| Gate          | Result                                                                                         | Matches §2 |
| ------------- | ---------------------------------------------------------------------------------------------- | ---------- |
| `pnpm typecheck` | **58 errors** (Cat-A untyped-root cascades; tracked in #15 for Phase 1)                     | ✓          |
| `pnpm lint`      | **370 problems (352 errors, 18 warnings)** — 230 `jsx-a11y/label-has-associated-control`, 71 `no-useless-catch`, 26 `click-events-have-key-events`, 23 `no-static-element-interactions`, 18 `react-hooks/exhaustive-deps`, 7 `import-x/order`, 6 `media-has-caption`. **0 console / 0 explicit-any / 0 unused-vars / 0 empty**. | ✓          |
| `pnpm test`      | 8 suites, **98 tests**, 0 failures (2.33s)                                                  | ✓          |
| `pnpm build`     | passes. main `index-*.js` **447.67 kB / gzip 131.42 kB**; NewCampaign chunk gzip **25.77 kB** | ✓          |

**File count:** **164** `.ts`/`.tsx` files under `apps/web/src/` (78 `.ts` + 86 `.tsx`). Plus 101 `.png` assets, 1 `.md`, 1 `.css`. The §2 "~245 files" figure includes the 101 PNG assets — **the actual code surface is 164 files**, not ~245. Audit refresh at end of Step 8 should restate the numerator (PNGs are not code).

**Node version pin:** `>=20 <21` in `apps/web/package.json` engines. Project root has no `.nvmrc` for the workspace (root `.nvmrc` was checked — see memory `pnpm-via-corepack`). Discovery shell used `~/.nvm/versions/node/v20.20.2/bin`. Pre-existing v20.20.2 → no action required during Step 8.

---

## Section 1 — File inventory by current location

164 files across 13 top-level directories. Tabled by current location with size and one-sentence role.

### 1.1 `pages/` (49 files)

#### Advertiser-side pages (mounted under `AdvertiserLayout`)

| File                                       | Lines | Route(s)                              | Role |
| ------------------------------------------ | ----- | ------------------------------------- | ---- |
| `pages/AdvertiserDashboard.tsx`            | 55    | `/dashboard`                          | Advertiser home (composition shell over hooks/dashboard) |
| `pages/UserProfile.tsx`                    | 1420  | `/profile`                            | Advertiser business profile CRUD |
| `pages/NewCampaign.tsx`                    | 1624  | `/new-campaign`, `/new-event-campaign` | Wizard orchestrator (post-Step-7 cleanup) |
| `pages/MyCampaigns.tsx`                    | 1657  | `/my-campaigns`                       | Advertiser campaign list + filters |
| `pages/CampaignDetails.tsx`                | 429   | `/campaign-details/:id`               | Single-campaign detail view |
| `pages/Events.tsx`                         | 410   | `/evenements`                         | Advertiser event browsing |
| `pages/MyRecharges.tsx`                    | 541   | `/my-recharges`                       | Wallet — recharge history + form |
| `pages/MyInvoices.tsx`                     | 304   | `/my-invoices`                        | Wallet — invoice list + PDF |
| `pages/MyClients.tsx`                      | 633   | `/my-clients`                         | Advertiser "my clients" CRUD |
| `pages/AdvertiserPerformancePlaceholder.tsx` | 18  | `/perfor`                             | #19 placeholder until rebuild |
| `pages/CartPage.tsx`                       | 527   | `/my-cart`                            | Campaign cart confirmation |

#### Wizard sub-pages (campaign domain)

| File                                       | Lines |
| ------------------------------------------ | ----- |
| `pages/new-campaign/Step1NameType.tsx`     | 147   |
| `pages/new-campaign/Step2.tsx`             | 282   |
| `pages/new-campaign/Step3.tsx`             | 236   |
| `pages/new-campaign/Step4.tsx`             | 506   |
| `pages/new-campaign/Step5.tsx`             | 351   |
| `pages/new-campaign/Step6.tsx`             | 452   |
| `pages/new-campaign/PostCartStep.tsx`      | 187   |

#### Auth pages (5 files; lightweight wrappers around `components/auth/*Form`)

| File                                       | Lines | Route                  |
| ------------------------------------------ | ----- | ---------------------- |
| `pages/auth/Login.tsx`                     | 16    | `/login`               |
| `pages/auth/SignUp.tsx`                    | 116   | `/signup`              |
| `pages/auth/ResetPassword.tsx`             | 17    | `/reset-password`      |
| `pages/auth/UpdatePassword.tsx`            | 12    | `/update-password`     |
| `pages/admin/AdminLogin.tsx`               | 151   | `/admin-login` (admin-namespaced) |

#### Owner-side pages — verified by `OwnerNavigation` import (16 files; SEAM — see §3.1)

| File                                       | Lines | Route                              |
| ------------------------------------------ | ----- | ---------------------------------- |
| `pages/OwnerDashboard.tsx`                 | 1129  | `/owner-dashboard`                 |
| `pages/OwnerScreens.tsx`                   | 1050  | `/owner-screens`                   |
| `pages/OwnerLocations.tsx`                 | 452   | `/owner-locations`                 |
| `pages/OwnerCalendarDevices.tsx`           | 539   | `/owner-calendar-devices`          |
| `pages/OwnerRevenue.tsx`                   | 722   | `/owner-revenue`                   |
| `pages/OwnerStatementsPage.tsx`            | 202   | `/owner-statements`                |
| `pages/OwnerStatementDetailPage.tsx`       | 249   | `/owner-statements/:statementId`   |
| `pages/OwnerPerformance.tsx`               | 932   | `/owner-performance`               |
| `pages/OwnerCampaigns.tsx`                 | 1251  | `/owner-campaigns`                 |
| `pages/OwnerCampaignApprovals.tsx`         | 339   | `/owner-campaign-approvals`        |
| `pages/OwnerActivity.tsx`                  | 14    | `/owner-activity`                  |
| `pages/OwnerMaintenance.tsx`               | 16    | `/owner-maintenance`               |
| `pages/OwnerSettings.tsx`                  | 1845  | `/owner-settings`                  |
| `pages/MyAccount.tsx`                      | 917   | `/my-account`                      |
| `pages/GiftCatalogPage.tsx`                | 360   | `/gift-catalog`                    |
| `pages/ContactPage.tsx`                    | 415   | `/contact`                         |

> **Surprise.** `MyAccount` / `GiftCatalogPage` / `ContactPage` are owner-side despite their non-`owner-*` URL slugs. Confirmed by `grep -l "OwnerNavigation"` — all three import the owner chrome. Route-slug does not reliably indicate ownership; chrome-import does.

#### Admin pages (12 files)

| File                                              | Lines | Route                    |
| ------------------------------------------------- | ----- | ------------------------ |
| `pages/admin/AdminDashboard.tsx`                  | 596   | `/admin-dashboard`       |
| `pages/admin/UserManagement.tsx`                  | 1466  | `/admin-users`           |
| `pages/admin/VideoManagement.tsx`                 | 549   | `/admin-videos`          |
| `pages/admin/EventManagement.tsx`                 | 1237  | `/admin-events`          |
| `pages/admin/CampaignMonitoring.tsx`              | 1008  | `/admin-campaigns`       |
| `pages/admin/CreateAdmin.tsx`                     | 355   | `/admin-create`          |
| `pages/admin/AdminManagement.tsx`                 | 576   | `/admin-management`      |
| `pages/admin/ScreenManagement.tsx`                | 460   | `/admin-screens`         |
| `pages/admin/RechargeManagement.tsx`              | 955   | `/admin-recharges`       |
| `pages/admin/GeographicZonesManagement.tsx`       | 668   | `/admin-zones`           |
| `pages/admin/AdminGlobalConfiguration.tsx`        | 145   | `/admin-global-config`   |
| `pages/admin/AdminLogin.tsx`                      | 151   | `/admin-login` (already listed above) |

### 1.2 `components/` (33 files across 5 sub-dirs + root)

| Sub-dir / file                              | Files | Notes |
| ------------------------------------------- | ----- | ----- |
| `components/admin/*`                        | 4     | `AdminLayout`, `AdminNavigation`, `AdminRoute`, `AffluenceModal` |
| `components/auth/*`                         | 5     | `AuthLayout`, `LoginForm`, `SignUpForm` (1940 lines), `ResetPasswordForm`, `UpdatePasswordForm` |
| `components/dashboard/*`                    | 6     | `BalanceCard`, `FeaturedEventsGrid`, `GettingStartedSection`, `InsightsCard`, `LastCampaignsGrid`, `StatsGrid` — all consumed by `AdvertiserDashboard` |
| `components/layout/*`                       | 3     | `AdvertiserLayout`, `PageHeader`, `SidebarNavItem` |
| `components/` (root, owner-side and shared) | 15    | `OwnerNavigation` (618), `OwnerNotificationsBell` (486), `AddScreen` (529), `GiftCatalog` (279), `ScreenCalendar` (733), `UnavailabilityCalendar` (239), `LocationsMap` (281), `RevenueCharts` (315), `DetailedRevenue` (307), `CartSidebar` (87), `AdvertiserNotificationsBell` (397), `ContentErrorBoundary` (43), `AnimatedLogo` (72), `PageLoadingFallback` (small), `Modal` (76) |

### 1.3 `services/` (29 `.ts` files + 3 `.test.ts`)

| File                                                  | Lines | Importers (rough) |
| ----------------------------------------------------- | ----- | ----- |
| `services/auth.service.ts`                            | 949   | broadly used |
| `services/campaign.service.ts`                        | 1066  | `NewCampaign`, `MyCampaigns`, `CartPage`, `OwnerCampaigns`, `OwnerCampaignApprovals` |
| `services/campaign-screens.service.ts`                | 678   | campaign-creation cluster |
| `services/campaign-owner-approval.service.ts`         | 283   | `OwnerCampaignApprovals`, `OwnerDashboard` |
| `services/campaign-hourly-location-plan.service.ts`   | 131   | campaign-creation |
| `services/dooh-new-campaign-estimate.service.ts`      | 378   | wizard estimate |
| `services/dooh-calculation.service.ts` + test         | 140+117 | legacy DOOH math (still live) |
| `services/dooh-hourly-grid.ts` + test                 | 144+155 | legacy DOOH math |
| `services/dooh-location-affluence-engine.ts`          | 544   | legacy DOOH math |
| `services/events.service.ts`                          | 86    | advertiser event browsing |
| `services/screens.service.ts`                         | 547   | owner screens CRUD |
| `services/locations.service.ts`                       | 153   | owner locations |
| `services/predefined-zones.service.ts`                | 178   | wizard zones (geographic) |
| `services/performance.service.ts`                     | 718   | `OwnerPerformance` |
| `services/revenue.service.ts`                         | 362   | `OwnerRevenue`, `OwnerStatements`, `OwnerDashboard` |
| `services/balance.service.ts`                         | 179   | cross-feature (see §2) |
| `services/invoice-pdf.service.ts`                     | 275   | `MyInvoices` |
| `services/export.service.ts`                          | 521   | PDF/CSV exports |
| `services/clients.service.ts`                         | 62    | `MyClients` |
| `services/platform-stats.service.ts`                  | 297   | admin dashboard |
| `services/video-upload.service.ts`                    | 252   | wizard video step |
| `services/global-configuration.service.ts` + test     | 321+48 | admin global config + advertiser reads |
| `services/admin.service.ts`                           | 313   | admin auth + admin CRUD |
| `services/admin-campaign-monitoring.service.ts`       | 451   | admin campaigns |
| `services/admin-events.service.ts`                    | 231   | admin events CRUD |
| `services/admin-recharges.service.ts`                 | 257   | admin recharges |
| `services/admin-screens.service.ts`                   | 762   | admin screens |
| `services/admin-user.service.ts`                      | 475   | admin users |
| `services/admin-video.service.ts`                     | 565   | admin videos |

### 1.4 `stores/` (3 files)

| File                                  | Lines | Importer count |
| ------------------------------------- | ----- | -------------- |
| `stores/auth.store.ts`                | 585   | **27** files — broadly used |
| `stores/admin.store.ts`               | 77    | **12** files — admin-only |
| `stores/cart.store.ts`                | 81    | **5** files — campaigns/cart vertical |

**Confirmed.** No fourth store. Q5 ordering assumption holds.

### 1.5 `hooks/` (10 files)

| File                                                  | Lines | Domain |
| ----------------------------------------------------- | ----- | ------ |
| `hooks/useWizard.ts`                                  | 69    | generic — wizard step machine |
| `hooks/useAdvertiserGlobalConfig.ts`                  | 65    | advertiser config bootstrap |
| `hooks/dashboard/useDashboardStats.ts`                | 162   | advertiser dashboard |
| `hooks/dashboard/useFeaturedEvents.ts`                | 46    | advertiser dashboard |
| `hooks/dashboard/useLastCampaigns.ts`                 | 153   | advertiser dashboard |
| `hooks/dashboard/useUserProfile.ts`                   | 61    | advertiser dashboard |
| `hooks/new-campaign/useCampaignWizard.ts` + test      | 123+311 | campaigns (wizard state machine) |
| `hooks/new-campaign/wizard-init.ts`                   | 63    | campaigns (wizard initial state) |
| `hooks/new-campaign/wizard-serialize.ts`              | 198   | campaigns (state ↔ DB) |
| `hooks/new-campaign/wizard-steps.ts`                  | 100   | campaigns (step definitions) |
| `hooks/new-campaign/wizard-types.ts`                  | 92    | campaigns (types) |

### 1.6 `lib/` (12 `.ts` files + 3 `.test.ts`)

| File                                  | Lines | Role |
| ------------------------------------- | ----- | ---- |
| `lib/supabase.ts`                     | small | Supabase client singleton |
| `lib/logger.ts` + test                | 42+36 | pino logger |
| `lib/errors.ts` + test                | 76+54 | error helpers |
| `lib/app-url.ts`                      | small | `VITE_PUBLIC_APP_URL` resolver |
| `lib/locale.ts`                       | small | locale helpers |
| `lib/ui-dates.ts`                     | 46    | date display helpers |
| `lib/wizard-dates.ts`                 | small | wizard-specific date helpers |
| `lib/wizard-zones.ts`                 | small | wizard zone area math (Step-7 Commit-11 extract) |
| `lib/dooh/config.ts`                  | small | DOOH config |
| `lib/dooh/dates.ts`                   | 72    | DOOH calendar helpers |
| `lib/dooh/hourly-plan.ts` + test      | 188+96 | DOOH allocator |
| `lib/dooh/v3-model.ts` + test         | 524+444 | v3 pricing model (unwired) |

### 1.7 `types/` (9 `.ts` files)

| File                                  | Domain |
| ------------------------------------- | ------ |
| `types/auth.ts` (116)                 | auth (`BusinessSector`, `Governorate`, `BusinessProfile`) |
| `types/admin.ts` (72)                 | admin |
| `types/campaign-monitoring.ts` (93)   | admin → admin-campaigns |
| `types/event.ts` (104)                | events |
| `types/location.ts`                   | screens/locations |
| `types/ownerStatement.ts`             | owner-side wallet (statements) |
| `types/performance.ts` (77)           | performances |
| `types/platform-stats.ts` (80)        | admin |
| `types/video.ts` (55)                 | wizard/video |

### 1.8 `constants/`, `data/`, `utils/`, `contexts/`, `scripts/`, `assets/`, root

| Path                                          | Files | Disposition |
| --------------------------------------------- | ----- | ----------- |
| `constants/advertiserBusinessSectors.ts`      | 1     | Advertiser onboarding |
| `constants/ownerStatement.ts`                 | 1     | Owner statements emitter block |
| `data/ownerStatementDetails.ts`               | 1     | Owner statements mock data (placeholder until API) |
| `utils/statementRecipient.ts`                 | 1     | Owner statements helper |
| `contexts/ModalContext.tsx`                   | 1     | Shared modal provider (Step-7 Commit-4 extract; used by `AdvertiserLayout`) |
| `scripts/checkTableStructure.ts`              | 1     | Maintenance script (out-of-scope per CLAUDE.md `**/scripts/**` console exception) |
| `assets/*.png`                                | 101   | Out-of-scope (assets stay put) |
| `App.tsx`                                     | 1     | Top-level routing (stays at `src/App.tsx`) |
| `main.tsx`                                    | 1     | Vite entry (stays at `src/main.tsx`) |
| `vite-env.d.ts`                               | 1     | Vite types (stays) |

---

## Section 2 — Cross-feature dependency map

What imports what across the proposed feature boundaries. Surfaces the load-bearing seams and the safe-to-move-first nodes.

### 2.1 `stores/auth.store.ts` — broadest fan-in (27 importers)

Imported by 27 files spanning every page family: `AdvertiserDashboard`, `UserProfile`, `NewCampaign`, `MyCampaigns`, `CartPage`, `MyClients`, `MyAccount`, `Events`, `MyInvoices`, `MyRecharges`, `ContactPage`, all `Owner*.tsx`, all admin pages via `AdminRoute`, plus `components/auth/LoginForm`, `components/OwnerNavigation`, `components/layout/AdvertiserLayout`, `contexts/ModalContext`.

→ Reinforces Q5 ordering: **auth must move first.** Subsequent commits import paths update against a stable target.

### 2.2 `services/balance.service.ts` — cross-feature

Importers (8): `hooks/dashboard/useDashboardStats.ts` (advertiser dashboard), `pages/CartPage.tsx`, `pages/NewCampaign.tsx`, `hooks/new-campaign/useCampaignWizard.ts` (campaigns), `pages/MyRecharges.tsx` (wallet), `pages/MyCampaigns.tsx` (campaigns), `services/admin-video.service.ts` (admin), plus self-reference.

→ Spans campaigns + wallet + advertiser dashboard + admin. Two placement options:
- (i) `features/wallet/services/balance.service.ts` (owner-of-concept), other features import down-the-tree;
- (ii) keep at `src/services/balance.service.ts` (root-level shared service).

Per Q2's rule "anything imported by multiple features without importing from any feature can [stay at root]" and the fact that `balance.service.ts` itself only imports `lib/supabase` (no feature deps) — **option (ii) is the cleaner answer.** Wallet still semantically owns the concept; placement at root reflects fan-in, not ownership. **Decision needed** (§9).

### 2.3 `services/global-configuration.service.ts` — cross-feature

Used by admin (write) and by `hooks/useAdvertiserGlobalConfig.ts` (read). Same shape as balance — single source, two consumers. Cleanest at root-level service, **or** in `features/admin/services/` with advertiser hook reading across the boundary (smell).

→ Place at root-level `src/services/`. **Decision needed** (§9).

### 2.4 `components/Modal.tsx` and `contexts/ModalContext.tsx`

Modal primitive + modal provider. Used by `AdvertiserLayout` (the provider mounts under it) and by feature pages. Both stay in `apps/web/src/components/` and `apps/web/src/contexts/` per Q2.

→ **Question:** `contexts/` becomes a one-file directory after Step 8 (only `ModalContext.tsx`). Collapse `contexts/ModalContext.tsx` → `components/ModalProvider/{ModalContext.tsx,index.ts}` or leave `contexts/` at top-level for any future cross-feature React contexts? Recommend collapsing — `contexts/` as a category has no growth path; the modal provider lives with the modal component. **Decision needed** (§9).

### 2.5 `lib/wizard-zones.ts` and `lib/wizard-dates.ts`

Wizard-domain pure utilities, but currently in top-level `lib/` (Step-7 Commit-11 extract). They have only one consumer (campaigns) by name. Two placements:
- Keep in `lib/` — application-level lib stays at root, only feature imports down;
- Move to `features/campaigns/lib/` — single-consumer = feature-owned.

Per CLAUDE.md's "truly shared bits stay in `lib/`" framing, **single-consumer code is not truly shared**; move to `features/campaigns/lib/`. (Parallel logic to why `hooks/new-campaign/useCampaignWizard.ts` moves into the feature, per Q2.)

→ **Decision needed** (§9). _Recommend move._

### 2.6 `components/dashboard/*` (6 files)

All consumed by `AdvertiserDashboard.tsx`. Single-consumer, advertiser-only. Belongs with `AdvertiserDashboard.tsx` wherever that lands (§3.1 seam resolution).

### 2.7 Layout components

| Component                                   | Used by |
| ------------------------------------------- | ------- |
| `components/layout/AdvertiserLayout.tsx`    | `App.tsx` (router wrap for all advertiser routes); imports `AdvertiserNotificationsBell`, `CartSidebar`, `PageHeader`, `SidebarNavItem`, `ModalContext` |
| `components/layout/PageHeader.tsx`          | Used by advertiser pages and at least owner-side pages — needs verification |
| `components/layout/SidebarNavItem.tsx`      | Used by `AdvertiserLayout` and likely `OwnerNavigation` |
| `components/OwnerNavigation.tsx`            | Wraps every owner-side page (the 16 listed in §1.1) |
| `components/admin/AdminLayout.tsx`          | Wraps admin pages |

→ Layouts are role-aligned: advertiser → `AdvertiserLayout`; owner → `OwnerNavigation`; admin → `AdminLayout`. Each goes with its role's feature folder (or stays under `components/layout/` shared if Resolution A wins on §3.1).

---

## Section 3 — Seams in the proposed structure (decisions needed)

The kickoff proposed 8 features: `auth`, `campaigns`, `events`, `screens`, `wallet`, `performances`, `profile`, `admin`. Two seams surface from §1–§2 that need explicit resolution before plan-writing.

### 3.1 SEAM #1 — Screenhost / Owner-side vertical (16 pages)

**The problem.** Q1 described `features/screens/` as "Parcs TV (thin; may collapse...)" — i.e. the deleted advertiser-side `pages/Parcs.tsx`. The 16 owner-side pages (12 explicit `Owner*` + `MyAccount` + `GiftCatalogPage` + `ContactPage` + `OwnerStatementDetailPage`) plus `OwnerNavigation`, `OwnerNotificationsBell`, `AddScreen`, `GiftCatalog`, `ScreenCalendar`, `UnavailabilityCalendar` have no home in the proposed 8-folder shape.

**Inventory of orphans under the kickoff structure:**

| Owner-side artifact                              | Lines | Natural domain    |
| ------------------------------------------------ | ----- | ----------------- |
| `pages/OwnerDashboard.tsx`                       | 1129  | home (cross-cutting) |
| `pages/OwnerSettings.tsx`                        | 1845  | profile/settings  |
| `pages/OwnerScreens.tsx`                         | 1050  | screens           |
| `pages/OwnerLocations.tsx`                       | 452   | screens           |
| `pages/OwnerCalendarDevices.tsx`                 | 539   | screens           |
| `pages/OwnerCampaigns.tsx`                       | 1251  | campaigns         |
| `pages/OwnerCampaignApprovals.tsx`               | 339   | campaigns         |
| `pages/OwnerPerformance.tsx`                     | 932   | performances      |
| `pages/OwnerRevenue.tsx`                         | 722   | wallet            |
| `pages/OwnerStatementsPage.tsx`                  | 202   | wallet            |
| `pages/OwnerStatementDetailPage.tsx`             | 249   | wallet            |
| `pages/OwnerActivity.tsx`                        | 14    | misc (~stub)      |
| `pages/OwnerMaintenance.tsx`                     | 16    | misc (~stub)      |
| `pages/MyAccount.tsx`                            | 917   | profile           |
| `pages/GiftCatalogPage.tsx`                      | 360   | misc (rewards)    |
| `pages/ContactPage.tsx`                          | 415   | misc              |
| `components/OwnerNavigation.tsx`                 | 618   | owner chrome      |
| `components/OwnerNotificationsBell.tsx`          | 486   | owner chrome      |
| `components/AddScreen.tsx`                       | 529   | screens (owner-action) |
| `components/GiftCatalog.tsx`                     | 279   | misc (rewards)    |
| `components/ScreenCalendar.tsx`                  | 733   | screens (owner)   |
| `components/UnavailabilityCalendar.tsx`          | 239   | screens (owner)   |
| `components/RevenueCharts.tsx`                   | 315   | wallet (owner)    |
| `components/DetailedRevenue.tsx`                 | 307   | wallet (owner)    |
| `components/LocationsMap.tsx`                    | 281   | screens (owner; also admin-affluence-modal?) |
| `constants/ownerStatement.ts`                    | small | wallet (owner)    |
| `data/ownerStatementDetails.ts`                  | 62    | wallet (owner)    |
| `utils/statementRecipient.ts`                    | small | wallet (owner)    |
| `types/ownerStatement.ts`                        | small | wallet (owner)    |

**Two resolutions:**

#### Resolution A — Domain-absorption (pure Q1 domain-first)

Each owner page goes to its domain feature. `OwnerCampaigns` lands next to `MyCampaigns` in `features/campaigns/pages/`; `OwnerRevenue` next to `MyRecharges` in `features/wallet/pages/`; `OwnerScreens` lands in `features/screens/`; etc. `OwnerDashboard` and the misc cluster need ad-hoc placement.

| Pro                                                    | Con                                                |
| ------------------------------------------------------ | -------------------------------------------------- |
| Maximally domain-coherent — campaigns is "all things campaigns regardless of role"; wallet is "all things finance" | Owner pages currently share `OwnerNavigation` chrome — distributing them across domains splits a tightly-coupled chrome cluster |
| One source of truth per domain (advertiser + owner views co-located) | `OwnerDashboard` (1129 lines, reads from 4 domains) and the misc/owner-chrome pages (`MyAccount`, `GiftCatalog`, `ContactPage`, `OwnerActivity`, `OwnerMaintenance`) still need a home — likely `features/profile/` becomes a junk drawer |
| Matches Q1's stated principle ("Domain-first, flat") literally | A change to owner-side chrome touches every owner-page-owning feature (cross-feature ripple) |
| `services/screens.service.ts` already owns owner+admin views (legit split confirmed in audit §3) — symmetric handling for pages | Future "redesign the owner side" requires touching N features instead of 1 |

#### Resolution B — Add `features/screenhost/` as a role-feature (sister to `features/admin/`)

A ninth feature `features/screenhost/` owns every owner-side page, the `Owner*` chrome, and owner-specific data/constants/types. Domain features (`campaigns`, `wallet`, `screens`, `performances`) own pure cross-role services + advertiser-facing pages.

| Pro                                                    | Con                                                |
| ------------------------------------------------------ | -------------------------------------------------- |
| Matches the existing chrome reality: `OwnerNavigation` and friends are a vertical, not a domain | Adds a ninth feature; arguably hybrid (domain-first + 2 role-features: `admin` + `screenhost`) |
| Symmetric with `features/admin/` — same pragmatism, same shape | Some owner pages (e.g. `OwnerCampaigns` rendering campaign data) feel "domain-ish" but live in role-feature |
| Future owner-side rebuild is a single-feature edit | Cross-references between `features/campaigns/services/campaign.service.ts` and `features/screenhost/pages/OwnerCampaigns.tsx` make campaigns→screenhost dependency explicit (not necessarily bad — services-as-API pattern) |
| Single-edit scope when chrome changes (OwnerNavigation, OwnerNotificationsBell) | Adds a role-coupled folder that the kickoff explicitly preferred to avoid (Q1 reasoning: "role-first duplicates the campaign data layer three ways") |
| Owner-only types (`types/ownerStatement.ts`), constants (`constants/ownerStatement.ts`), data (`data/ownerStatementDetails.ts`), utils (`utils/statementRecipient.ts`) get a coherent home | None of these owner-side files currently has a campaign-data-layer duplication problem — the Q1 reasoning doesn't apply once admin is already accepted as a role-feature |

**My recommendation: Resolution B.** The Q1 reasoning ("role-first duplicates the campaign data layer three ways") applies if and only if the **services** also duplicate. They don't — `campaign.service.ts` is single-source and both `MyCampaigns` and `OwnerCampaigns` import it. Pages duplicating across role boundaries is not the same problem as services duplicating. Admin is already accepted as a role-feature; screenhost mirrors admin's pragmatism. The chrome (`OwnerNavigation`, `OwnerNotificationsBell`, `OwnerLayout`-equivalent) wants a single home, and that home is `features/screenhost/`.

**If Resolution B wins,** the final shape becomes 9 features:

```
features/
  auth/
  campaigns/      ← advertiser-facing: MyCampaigns, NewCampaign+wizard, CartPage, CampaignDetails, all campaign services, cart.store, clients.service
  events/         ← advertiser-facing: Events page, events.service
  screens/        ← cross-role services: screens.service, locations.service, predefined-zones.service, types/location
  wallet/         ← cross-role services: balance(?), invoice-pdf, revenue.service; advertiser pages: MyRecharges, MyInvoices
  performances/   ← AdvertiserPerformancePlaceholder; performance.service is technically owner-only currently
  profile/        ← advertiser-only: UserProfile, MyClients
  admin/          ← all admin pages, admin services cluster, admin.store
  screenhost/     ← all 16 owner-side pages, OwnerNavigation/NotificationsBell, AddScreen, GiftCatalog, ScreenCalendar, UnavailabilityCalendar, RevenueCharts, DetailedRevenue, LocationsMap, owner statement types/constants/data/utils, hooks/dashboard/ owner subset (none currently)
  advertiser/     ← OPTIONAL: AdvertiserDashboard, hooks/dashboard/*, AdvertiserLayout, AdvertiserNotificationsBell, components/dashboard/* — see §3.2
```

### 3.2 SEAM #2 — Advertiser cross-cutting home + chrome

Whether or not Resolution B wins on §3.1, `AdvertiserDashboard.tsx` (55 lines, composition shell), `hooks/dashboard/*` (4 hooks reading from many domains), `components/dashboard/*` (6 widget components), `components/layout/AdvertiserLayout.tsx`, `components/AdvertiserNotificationsBell.tsx`, `components/CartSidebar.tsx` are a cohesive advertiser-shell cluster.

**Two resolutions:**

#### Resolution X — Spread across domains

`AdvertiserDashboard` → `features/profile/` (the catch-all "advertiser persona" feature). `hooks/dashboard/useDashboardStats` → wherever stats originate (campaigns? wallet?). Widget components in `components/dashboard/` → `features/profile/components/` co-located with dashboard.

Drawback: distorts `features/profile/` into "advertiser shell + business profile + my clients" — three concerns. Also: each hook reads from a different domain, so spreading creates artificial coupling.

#### Resolution Y — Add `features/advertiser/` as a role-feature

`features/advertiser/` owns: `AdvertiserDashboard.tsx`, `hooks/dashboard/*`, `components/dashboard/*`, `components/layout/AdvertiserLayout.tsx`, `components/AdvertiserNotificationsBell.tsx`, `components/CartSidebar.tsx` (used in AdvertiserLayout). Plus advertiser-only pages that don't fit another domain (`MyClients`, `ContactPage`-advertiser-version-if-any).

Drawback: brings the count to **10 features** (if combined with Resolution B). Two role-features per side + 6 domain-features.

**My recommendation: Resolution Y combined with B.** Symmetric: `features/advertiser/` (shell + home) + `features/screenhost/` (shell + home) + `features/admin/` (shell + home), with cross-role domain features for the data layer. This is the structure the code's existing chrome separation already implements.

**Final proposed shape (B + Y) — 10 features:**

```
apps/web/src/
  App.tsx
  main.tsx
  vite-env.d.ts
  features/
    auth/
    campaigns/
    events/
    screens/
    wallet/
    performances/
    admin/         ← role-feature (existing)
    advertiser/    ← role-feature (new)
    screenhost/    ← role-feature (new)
    profile/       ← OPTIONAL — collapse into advertiser/? See §9
  components/      ← truly shared (Modal, AnimatedLogo, PageLoadingFallback, ContentErrorBoundary, layout/PageHeader, layout/SidebarNavItem)
  hooks/           ← truly shared (useWizard generic only)
  lib/             ← logger, errors, supabase, app-url, locale, ui-dates, dooh/*
  scripts/         ← maintenance (stays)
  assets/          ← stays
```

→ See §9 for the explicit decision needed.

---

## Section 4 — Legacy-shadow scan

Per the singular-vs-plural / legacy-shadow methodology rule (audit §3 Step-7 methodology #1):

| Pattern                          | Result                                  |
| -------------------------------- | --------------------------------------- |
| `*.api.ts`                       | **0 files** (clean — Step 2b cleared)   |
| `*s.service.ts` plural twins     | **0 files** (clean — Step 2b cleared)   |
| `*.legacy.ts` / `*.deprecated.ts` | **0 files**                            |
| `*.bak`, `*.old`                 | **0 files**                            |
| `legacy`/`deprecated`/`TODO.*remove`/`TODO.*move` mentions in comments | **11 files** — manually scanned: all are comments referring to legacy data structures, in-progress migrations, or notes about Phase-1 rewrites; **none are dead-code shadows**. (Files: `constants/advertiserBusinessSectors.ts`, `lib/dooh/dates.ts`, `lib/dooh/config.ts`, `stores/cart.store.ts`, `services/campaign.service.ts`, `services/dooh-location-affluence-engine.ts`, `services/campaign-owner-approval.service.ts`, `pages/OwnerSettings.tsx`, `services/admin-campaign-monitoring.service.ts`, `pages/NewCampaign.tsx`, `services/dooh-new-campaign-estimate.service.ts`.) |

**No legacy shadows found.** Step 2b's deletion sweep + Step 7's dead-modal/sidebar cascades cleared the codebase. Step 8 is a pure folder restructure with no embedded dedup work.

---

## Section 5 — Proposed move table (seam-dependent entries marked TBD)

Once §9 decisions are locked, the move table is mechanical. Entries that depend on §3.1/§3.2 resolution are marked **TBD-seam** and resolved in the plan, not here.

### 5.1 Auth (Commit 1 of move chain — Q5 ordering)

| Current path                                  | Proposed path                                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `stores/auth.store.ts`                        | `features/auth/stores/auth.store.ts`                      |
| `services/auth.service.ts`                    | `features/auth/services/auth.service.ts`                  |
| `types/auth.ts`                               | `features/auth/types/auth.ts`                             |
| `pages/auth/Login.tsx`                        | `features/auth/pages/Login.tsx`                           |
| `pages/auth/SignUp.tsx`                       | `features/auth/pages/SignUp.tsx`                          |
| `pages/auth/ResetPassword.tsx`                | `features/auth/pages/ResetPassword.tsx`                   |
| `pages/auth/UpdatePassword.tsx`               | `features/auth/pages/UpdatePassword.tsx`                  |
| `components/auth/AuthLayout.tsx`              | `features/auth/components/AuthLayout.tsx`                 |
| `components/auth/LoginForm.tsx`               | `features/auth/components/LoginForm.tsx`                  |
| `components/auth/SignUpForm.tsx`              | `features/auth/components/SignUpForm.tsx`                 |
| `components/auth/ResetPasswordForm.tsx`       | `features/auth/components/ResetPasswordForm.tsx`          |
| `components/auth/UpdatePasswordForm.tsx`      | `features/auth/components/UpdatePasswordForm.tsx`         |

**11 files. App.tsx imports update for 4 auth routes + 1 type re-import (`constants/advertiserBusinessSectors.ts` imports `BusinessSector` type).**

### 5.2 Wallet (Commit 2)

| Current path                                  | Proposed path (seam-resolved)                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `services/balance.service.ts`                 | TBD-seam (root `src/services/` if Q2(ii); `features/wallet/services/` if owned) |
| `services/invoice-pdf.service.ts`             | `features/wallet/services/invoice-pdf.service.ts`         |
| `services/revenue.service.ts`                 | `features/wallet/services/revenue.service.ts`             |
| `pages/MyRecharges.tsx`                       | `features/wallet/pages/MyRecharges.tsx`                   |
| `pages/MyInvoices.tsx`                        | `features/wallet/pages/MyInvoices.tsx`                    |
| `pages/OwnerRevenue.tsx`                      | TBD-seam (Resolution A: `features/wallet/pages/`; Resolution B: `features/screenhost/pages/`) |
| `pages/OwnerStatementsPage.tsx`               | TBD-seam (same) |
| `pages/OwnerStatementDetailPage.tsx`          | TBD-seam (same) |
| `constants/ownerStatement.ts`                 | TBD-seam |
| `data/ownerStatementDetails.ts`               | TBD-seam |
| `utils/statementRecipient.ts`                 | TBD-seam |
| `types/ownerStatement.ts`                     | TBD-seam |
| `components/RevenueCharts.tsx`                | TBD-seam (owner-only chart cluster) |
| `components/DetailedRevenue.tsx`              | TBD-seam (owner-only) |

### 5.3 Events (Commit 3)

| Current path                                  | Proposed path                                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `services/events.service.ts`                  | `features/events/services/events.service.ts`              |
| `types/event.ts`                              | `features/events/types/event.ts`                          |
| `pages/Events.tsx`                            | `features/events/pages/Events.tsx`                        |

### 5.4 Performances (Commit 4)

| Current path                                  | Proposed path                                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `pages/AdvertiserPerformancePlaceholder.tsx`  | `features/performances/pages/AdvertiserPerformancePlaceholder.tsx` |
| `services/performance.service.ts`             | `features/performances/services/performance.service.ts` (currently owner-only) |
| `types/performance.ts`                        | `features/performances/types/performance.ts`              |
| `pages/OwnerPerformance.tsx`                  | TBD-seam (Resolution A: here; Resolution B: `features/screenhost/pages/`) |

### 5.5 Profile (Commit 5 — only if `features/profile/` survives §3.2)

| Current path                                  | Proposed path                                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `pages/UserProfile.tsx`                       | `features/profile/pages/UserProfile.tsx`                  |
| `pages/MyClients.tsx`                         | `features/profile/pages/MyClients.tsx` OR `features/advertiser/pages/` |
| `services/clients.service.ts`                 | `features/profile/services/clients.service.ts` OR `features/advertiser/services/` |
| `constants/advertiserBusinessSectors.ts`      | `features/profile/constants/` OR `features/advertiser/constants/` |

If §3.2 chooses Resolution Y (`features/advertiser/`), `features/profile/` may collapse entirely into `features/advertiser/` — see §9.

### 5.6 Screens (Commit 6)

| Current path                                  | Proposed path                                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `services/screens.service.ts`                 | `features/screens/services/screens.service.ts`            |
| `services/locations.service.ts`               | `features/screens/services/locations.service.ts`          |
| `services/predefined-zones.service.ts`        | `features/screens/services/predefined-zones.service.ts`   |
| `types/location.ts`                           | `features/screens/types/location.ts`                      |
| `pages/OwnerScreens.tsx`                      | TBD-seam |
| `pages/OwnerLocations.tsx`                    | TBD-seam |
| `pages/OwnerCalendarDevices.tsx`              | TBD-seam |
| `components/AddScreen.tsx`                    | TBD-seam |
| `components/ScreenCalendar.tsx`               | TBD-seam |
| `components/UnavailabilityCalendar.tsx`       | TBD-seam |
| `components/LocationsMap.tsx`                 | TBD-seam (also used by `components/admin/AffluenceModal.tsx`?) |

### 5.7 Admin (Commit 7)

| Current path                                  | Proposed path                                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `stores/admin.store.ts`                       | `features/admin/stores/admin.store.ts`                    |
| `services/admin.service.ts`                   | `features/admin/services/admin.service.ts`                |
| `services/admin-campaign-monitoring.service.ts` | `features/admin/services/admin-campaign-monitoring.service.ts` |
| `services/admin-events.service.ts`            | `features/admin/services/admin-events.service.ts`         |
| `services/admin-recharges.service.ts`         | `features/admin/services/admin-recharges.service.ts`      |
| `services/admin-screens.service.ts`           | `features/admin/services/admin-screens.service.ts`        |
| `services/admin-user.service.ts`              | `features/admin/services/admin-user.service.ts`           |
| `services/admin-video.service.ts`             | `features/admin/services/admin-video.service.ts`          |
| `services/platform-stats.service.ts`          | `features/admin/services/platform-stats.service.ts`       |
| `types/admin.ts`                              | `features/admin/types/admin.ts`                           |
| `types/campaign-monitoring.ts`                | `features/admin/types/campaign-monitoring.ts`             |
| `types/platform-stats.ts`                     | `features/admin/types/platform-stats.ts`                  |
| `types/video.ts`                              | `features/admin/types/video.ts` (admin-only video mgmt)   |
| `pages/admin/*.tsx` (12 files)                | `features/admin/pages/*.tsx`                              |
| `components/admin/*.tsx` (4 files)            | `features/admin/components/*.tsx`                         |

**31 files.**

### 5.8 Campaigns (Commit 8 — largest)

| Current path                                  | Proposed path                                             |
| --------------------------------------------- | --------------------------------------------------------- |
| `stores/cart.store.ts`                        | `features/campaigns/stores/cart.store.ts`                 |
| `services/campaign.service.ts`                | `features/campaigns/services/campaign.service.ts`         |
| `services/campaign-screens.service.ts`        | `features/campaigns/services/campaign-screens.service.ts` |
| `services/campaign-owner-approval.service.ts` | `features/campaigns/services/campaign-owner-approval.service.ts` |
| `services/campaign-hourly-location-plan.service.ts` | `features/campaigns/services/campaign-hourly-location-plan.service.ts` |
| `services/dooh-new-campaign-estimate.service.ts` | `features/campaigns/services/dooh-new-campaign-estimate.service.ts` |
| `services/video-upload.service.ts`            | `features/campaigns/services/video-upload.service.ts`     |
| `services/dooh-calculation.service.ts` + test | TBD — see §9 (legacy DOOH math, used by wizard; lib/ or feature?) |
| `services/dooh-hourly-grid.ts` + test         | TBD — see §9 (legacy DOOH math) |
| `services/dooh-location-affluence-engine.ts`  | TBD — see §9 |
| `pages/MyCampaigns.tsx`                       | `features/campaigns/pages/MyCampaigns.tsx`                |
| `pages/NewCampaign.tsx`                       | `features/campaigns/pages/NewCampaign.tsx`                |
| `pages/CartPage.tsx`                          | `features/campaigns/pages/CartPage.tsx`                   |
| `pages/CampaignDetails.tsx`                   | `features/campaigns/pages/CampaignDetails.tsx`            |
| `pages/new-campaign/*.tsx` (7 step files)     | `features/campaigns/pages/new-campaign/*.tsx`             |
| `hooks/new-campaign/*` (5 files + test)       | `features/campaigns/hooks/new-campaign/*`                 |
| `lib/wizard-zones.ts`                         | `features/campaigns/lib/wizard-zones.ts` (recommended; §2.5) |
| `lib/wizard-dates.ts`                         | `features/campaigns/lib/wizard-dates.ts` (recommended; §2.5) |
| `components/CartSidebar.tsx`                  | `features/campaigns/components/CartSidebar.tsx` (or `features/advertiser/` if shell-aligned) |
| `pages/OwnerCampaigns.tsx`                    | TBD-seam |
| `pages/OwnerCampaignApprovals.tsx`            | TBD-seam |

### 5.9 Screenhost — only if Resolution B (§3.1) wins

If Resolution B wins, all TBD-seam owner-side entries from §5.2–§5.8 collect here. ~16 pages + 4 owner-chrome components + owner-only widgets (RevenueCharts, DetailedRevenue, AddScreen, GiftCatalog, ScreenCalendar, UnavailabilityCalendar, LocationsMap) + owner-statement constants/data/types/utils.

### 5.10 Advertiser — only if Resolution Y (§3.2) wins

If Resolution Y wins, the advertiser-shell cluster lands here:
- `pages/AdvertiserDashboard.tsx`
- `hooks/dashboard/*` (4 files)
- `hooks/useAdvertiserGlobalConfig.ts`
- `components/dashboard/*` (6 files)
- `components/layout/AdvertiserLayout.tsx`
- `components/AdvertiserNotificationsBell.tsx`
- `components/CartSidebar.tsx` (or stays in campaigns/?)
- Possibly `pages/MyClients.tsx` + `services/clients.service.ts` (advertiser-only)
- Possibly `pages/ContactPage.tsx` (BUT verified to be owner-side per §1.1 — would stay in screenhost)

### 5.11 Stays at root (truly shared)

| Path                                          | Decision           |
| --------------------------------------------- | ------------------ |
| `App.tsx`, `main.tsx`, `vite-env.d.ts`        | Stays (entry)      |
| `lib/supabase.ts`                             | Stays              |
| `lib/logger.ts` + test                        | Stays              |
| `lib/errors.ts` + test                        | Stays              |
| `lib/app-url.ts`                              | Stays              |
| `lib/locale.ts`                               | Stays              |
| `lib/ui-dates.ts`                             | Stays              |
| `lib/dooh/*` (5 files + tests)                | Stays — audit Step 4 IP |
| `hooks/useWizard.ts` (generic)                | Stays              |
| `components/Modal.tsx`                        | Stays              |
| `components/AnimatedLogo.tsx`                 | Stays              |
| `components/PageLoadingFallback.tsx`          | Stays              |
| `components/ContentErrorBoundary.tsx`         | Stays              |
| `components/layout/PageHeader.tsx`            | Stays (used by both advertiser + owner sides — verify) |
| `components/layout/SidebarNavItem.tsx`        | Stays (same)       |
| `contexts/ModalContext.tsx`                   | Stays OR collapse into `components/ModalProvider/` — see §9 |
| `scripts/checkTableStructure.ts`              | Stays              |
| `assets/*.png`                                | Stays              |
| `services/balance.service.ts`                 | Stays (recommendation; see §2.2) |
| `services/global-configuration.service.ts`    | Stays (recommendation; see §2.3) |
| `services/export.service.ts`                  | TBD — see §9       |

---

## Section 6 — Commit-ordering refinement

The kickoff Q5 specified order: auth → wallet → events → performances → profile → screens → admin → campaigns. Discovery findings:

1. **Auth first holds** — `auth.store` has 27 importers; everything else is downstream. ✓
2. **Wallet second** introduces a problem if Resolution B wins: owner-side wallet pages (OwnerRevenue/Statements) move to `features/screenhost/`, not `features/wallet/`. So Commit 2 would be advertiser-wallet only (`MyRecharges`, `MyInvoices`, `invoice-pdf`, `revenue.service` shared), and owner-wallet pages move with screenhost in a later commit.
3. **Screenhost size.** If Resolution B wins, `features/screenhost/` is **~16 pages + 10 components + various data/types/constants/utils** — likely the second-largest commit after campaigns. Should land late in the chain (before campaigns) so smaller commits stabilize the cross-feature import edges first.
4. **Domain features without an owner-side page can land any time** — `events` (no Owner-events page; admin-events stays with admin), `performances` (advertiser placeholder + OwnerPerformance — TBD-seam), `screens` (services shared; pages mostly owner-side → screenhost).
5. **Campaigns last** — confirmed; biggest, riskiest, most cross-cutting.

**Proposed refinement (assuming Resolution B + Y win):**

| # | Commit                                            | File count (rough) | Risk |
| - | ------------------------------------------------- | ------------------ | ---- |
| 0 | Discovery (this commit)                           | 1 (doc only)       | —    |
| 1 | `features/auth/`                                  | 12                 | low (broadly imported but mechanical) |
| 2 | `features/events/`                                | 3                  | very low |
| 3 | `features/performances/` (placeholder + service + type only; OwnerPerformance defers to screenhost) | 3 | very low |
| 4 | `features/wallet/` (advertiser-side only: MyRecharges, MyInvoices, invoice-pdf, revenue.service; owner-side defers to screenhost) | 4 | low |
| 5 | `features/screens/` (services + types only; owner-side pages defer to screenhost) | 4 | low |
| 6 | `features/advertiser/` (AdvertiserDashboard, hooks/dashboard, components/dashboard, AdvertiserLayout, MyClients, clients.service, business sectors constant) | 14 | medium (touches `App.tsx` routes + shared layout) |
| 7 | `features/admin/`                                 | 31                 | medium (large rename but self-contained) |
| 8 | `features/screenhost/`                            | ~30                | medium-high (large rename + chrome cluster) |
| 9 | `features/campaigns/`                             | ~30                | high (biggest, most cross-feature deps, OwnerCampaigns + OwnerCampaignApprovals lift over from screenhost if grouped here, or stay in screenhost — TBD) |
| 10 | audit refresh + close #4                         | 1 (doc only)       | —    |

**Note on order swap.** I'm proposing Commit 6 = advertiser (was Commit 5 profile). Reason: advertiser-shell contains `AdvertiserLayout.tsx`, which `App.tsx` wraps every advertiser route in. Moving the layout updates `App.tsx` once; subsequent advertiser-side feature moves only update their own page imports, not the layout wrapper. Profile (if it survives §3.2) collapses into advertiser.

**Note on order between screenhost and campaigns.** If `OwnerCampaigns` + `OwnerCampaignApprovals` go to `screenhost/` (Resolution B literal), screenhost moves first and campaigns moves last. If they go to `campaigns/` (Resolution A mixed-in), the order can flip. **Decision needed** — see §9.

---

## Section 7 — Out-of-scope confirmation

Per kickoff §4. Step 8 touches **`apps/web/src/` only**.

| Path                                  | Status |
| ------------------------------------- | ------ |
| `apps/web/public/`                    | Stays  |
| `apps/web/vite.config.ts`             | Stays  |
| `apps/web/tsconfig*.json`             | Stays  |
| `apps/web/index.html`                 | Stays  |
| `apps/web/eslint.config.js` (root)    | Stays  |
| `apps/web/scripts/` (workspace-level, if any) | None present at workspace level (only `apps/web/src/scripts/` which stays in-place) |
| `packages/shared/`                    | Not Step 8 |
| `apps/api/`, `apps/player-api/`       | Don't exist yet |
| `infra/`                              | Don't exist yet |
| `docs/`                               | Refreshed in final commit (audit §2/§3/§5 + close #4) |

Vite + tsconfig paths: I need to verify whether `tsconfig.app.json` or `vite.config.ts` has any path alias (`@/*`) that needs updating. Spot-check during plan-writing — if no alias, every `from '../components/Foo'` updates literally to `from '../../components/Foo'` or `from '../../../components/Foo'` depending on depth. If alias exists, import rewriting may simplify or complicate things.

---

## Section 8 — Carry-forward methodology rules

Per kickoff §3, all seven Step-7 learnings apply. Concrete commitments for Step 8:

1. **Four gates between every commit:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Non-negotiable per pause-vs-diff blind spot. Each pause reports all four numbers + spot-check.
2. **`wc -l` instead of eyeball** for any line-count claim in commit summaries.
3. **`--no-verify` authorized** for the whole Step-8 commit chain (kickoff §3); workspace `pnpm lint` is the authoritative gate.
4. **Eager-imports stability:** `App.tsx` `React.lazy()` routes only update **paths** (`'./pages/Foo'` → `'./features/x/pages/Foo'`); no `React.lazy` boundary changes.
5. **Singular-vs-plural shadow grep** — already run in §4; **0 shadows**. Re-grep before each feature commit in case earlier moves expose hidden shadows.
6. **Inventory-phase scope-expansion** — if discovery surfaces a file that touches #19/#20/#21, flag, don't silently fold in. (`pages/AdvertiserPerformancePlaceholder.tsx` is the only file touching #19; its move is in-scope as a file-rename only, per kickoff.)
7. **Dead-UI detection** not directly applicable (no deletions in Step 8), but: if any rename surfaces a file with zero imports, **flag and ask** before moving or deleting.

Additional commitments specific to Step 8:

8. **Per-commit verification of `App.tsx` imports.** Every feature commit must end with `App.tsx`'s lazy-import paths verified-correct against the new locations. Spot-check by typing one of the moved routes' URLs in dev preview if feasible; otherwise rely on build + typecheck.
9. **`pnpm build` is load-bearing.** Vite/Rollup catches dynamic-import resolution issues that `tsc --noEmit` misses (e.g., a `React.lazy(() => import('./pages/X'))` with a wrong path still typechecks because `lazy` is `any`-ish). Build must pass before commit fires.
10. **`tsconfig` path aliases.** Before plan-writing, verify whether `tsconfig.app.json` has `paths: { '@/*': ['./src/*'] }` or similar. If yes, prefer alias-form imports in moved files (single-pass cleanup of relative-path depth changes); if no, accept relative-path updates as the move noise.

---

## Section 9 — Decisions needed before plan

The plan cannot be written until these are locked. Four blocking decisions + three recommendations.

### Blocking

**D1 — Screenhost vertical (§3.1).** A or B?
- **A** Distribute owner-side pages into domain features (campaigns/wallet/screens/performances + ad-hoc home for OwnerDashboard).
- **B** Add `features/screenhost/` as a role-feature sister to `features/admin/`. _(My recommendation.)_

**D2 — Advertiser shell (§3.2).** X or Y?
- **X** Distribute `AdvertiserDashboard` + chrome + dashboard hooks/components across domain features (profile becomes a junk drawer).
- **Y** Add `features/advertiser/` as a role-feature, collapsing `features/profile/` into it. _(My recommendation.)_

If D1 = A and D2 = X, the final shape is 7 domain features + admin = 8 (matches the kickoff). If D1 = B and D2 = Y, the final shape is 6 domain features + 3 role features = 9 (or 10 if profile survives).

**D3 — `OwnerCampaigns` / `OwnerCampaignApprovals` placement** (only if D1 = B).
- **B1:** Live in `features/screenhost/pages/` (literal role placement).
- **B2:** Live in `features/campaigns/pages/owner/` (campaigns-domain, owner subdirectory).

Same question for `OwnerScreens` / `OwnerLocations` / `OwnerCalendarDevices`, `OwnerRevenue` / `OwnerStatements*`, `OwnerPerformance`. Recommendation: **B1 across the board** — keep `features/screenhost/` cohesive as the owner-side vertical, accept that domain features own only data layer + advertiser-facing pages.

**D4 — `contexts/` collapse.** After Step 8, `contexts/` is one file (`ModalContext.tsx`). Collapse into `components/Modal/`? Recommendation: **yes, collapse**.

### Recommendations to confirm

**R1 — `services/balance.service.ts` placement** (§2.2). Recommend root-level `src/services/balance.service.ts` (or `src/lib/services/balance.ts`). Cross-feature, no feature dependencies.

**R2 — `services/global-configuration.service.ts` placement** (§2.3). Same as R1: root-level shared.

**R3 — `services/export.service.ts` placement.** Used by admin + likely owner-side; recommend root-level shared.

**R4 — `lib/wizard-zones.ts` + `lib/wizard-dates.ts`** (§2.5). Single-consumer (campaigns). Recommend move into `features/campaigns/lib/`.

**R5 — Legacy DOOH services** (`dooh-calculation.service.ts` + test, `dooh-hourly-grid.ts` + test, `dooh-location-affluence-engine.ts`). These are the still-live legacy math layer (audit Step 4c is Phase-1). They are imported by campaign-creation cluster + by `lib/dooh/` (?). Recommend either:
- Move with campaigns under `features/campaigns/services/`, **OR**
- Move into `lib/dooh/legacy/` to consolidate all DOOH math under `lib/dooh/`. _(My preference: lib/dooh/legacy — symmetric with `lib/dooh/v3-model.ts` + the audit's framing that this is "isolated IP".)_

**R6 — Component placement when used by multiple roles.**
- `components/layout/PageHeader.tsx`, `components/layout/SidebarNavItem.tsx`: verify if used by both advertiser and owner sides. If yes, stay at `components/layout/`; if advertiser-only, move with advertiser.
- `components/LocationsMap.tsx`: used by owner-side (locations) and `admin/AffluenceModal`. Cross-role → stay at `components/`, or move to wherever feels right with a noted cross-feature import.

**R7 — `tsconfig` path alias check.** Verify `apps/web/tsconfig.app.json` `paths` field before plan-writing. If alias present, prefer alias-form imports; if not, accept relative-path updates as move noise.

---

## Section 10 — Open questions captured (not blocking)

These are observations from inventory worth tracking but not blocking the plan:

- `pages/OwnerActivity.tsx` (14 lines) and `pages/OwnerMaintenance.tsx` (16 lines) are stubs — unimplemented owner pages. Confirm Figma intent (per Figma-consultation rule) before moving: are these stubs scheduled for build-out or unintended? Likely move-as-is.
- `pages/AdvertiserDashboard.tsx` is **55 lines** (composition shell post-Step-7). Smaller than expected.
- `pages/MyClients.tsx` (633 lines) bypasses `clientsService` and calls Supabase directly via `lib/supabase`. Pre-Step-10 concern (React Query layer); flag for Step 10 but don't touch in Step 8.
- `components/auth/SignUpForm.tsx` (1940 lines) is the single biggest non-deprecated file in the codebase. Way over the 400-line "presumed broken" line in CLAUDE.md. Out of scope for Step 8 (folder move only); track for future decomposition.
- `services/auth.service.ts` is still 949 lines and contains the ~165-line `mapAuthError` function plus `business_profiles` CRUD. Audit §3 ("Auth-state layering") flagged a future `auth.service.ts` / `business-profile.service.ts` split as a Step 8 concern. **Decision needed** — am I splitting this during the auth move, or moving as-is? Recommend **move as-is** in Step 8 (folder restructure only; service-internal splits are a different kind of work).
- Verify before any move: is there a `tsconfig` path alias? Is there any `vite.config.ts` resolve-alias? Is `import-x/order` config sensitive to feature-folder paths? (ESLint's `import-x/order` group order is typically `builtin/external/internal/parent/sibling/index` — feature-folder moves shouldn't trip it, but a quick check is cheap.)

---

## End-state of discovery commit

- This doc committed at HEAD.
- Workspace untouched (no file moves).
- Decision pause for user. Once D1–D4 are answered (and R1–R7 confirmed or amended), I write the plan against the locked structure and execute the move chain in the order in §6.

Audit.md will be refreshed only in the final commit of Step 8 (per kickoff). No audit edits in this discovery commit.
