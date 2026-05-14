# Step 7 — Discovery: Dashboard.tsx and NewCampaign.tsx decomposition

_Discovery date: 2026-05-14. Anchor commit: `62d936a` (post-Step-6 close-out)._

This is Commit 0 of Step 7. No code changes — discovery, route inventory,
audit-question resolution, shared-extraction inventory, decomposition shape
proposal, routing changes, risk assessment, and effort estimate.

The target files:

| File | Current lines | Audit-doc figure | Drift |
|---|---:|---:|---|
| `apps/web/src/pages/Dashboard.tsx` | **2507** | 2635 | −128 (Step 5/6 trims) |
| `apps/web/src/pages/NewCampaign.tsx` | **4039** | 4359 | −320 (Step 5/6 trims) |

Both files combined: ~6,546 lines. The audit doc's "Step 7 — Decompose
Dashboard.tsx / NewCampaign.tsx" entry says "each route renders its own
page; largest chunk materially smaller; no regressions" (`#3`, audit doc
§5).

---

## Section 1 — Dashboard.tsx route inventory

`Dashboard.tsx` is the god-component element for **12 advertiser routes**
declared in `App.tsx:186-289`. It uses `useLocation().pathname` to switch
internally on a `renderContent()` function at `Dashboard.tsx:801-826` and
renders the matching child page (or the inline `/dashboard` view as
default).

Each "logical route" below is a distinct user-facing screen state that
Dashboard.tsx renders. The current URL is from `App.tsx`; the
render-trigger is the `case` in the `renderContent` switch.

### 1.1 `/dashboard` — Advertiser home (the inline default)

- **Lines in Dashboard.tsx**: ~827–1607 (inline JSX in the default `case`)
- **URL**: `/dashboard`
- **Render-trigger**: `renderContent()` default branch (`Dashboard.tsx:826`)
- **Data dependencies**:
  - `useAuthStore` — user, profileType, validationStatus, needsApproval, shouldOnboard, logout
  - `supabase` direct — `business_profiles` (onboarding_completed, registration_doc_url), `campaigns` (stats + last 5), `campaign_categories`, `predefined_zones`
  - `balanceService.getBalanceInfo` / `getUserBalance`
  - `authService.getBusinessProfile` / `getAppointmentObjectives`
  - `eventsService.getFeaturedEvents` (3 cards)
- **Side effects**:
  - localStorage reads: `onboardingCompleted` (line 260, 633), `user_profile_type` (365), `justOnboarded` (644)
  - localStorage writes: `onboardingCompleted` (281, 754, 782), `user_raison_social` (607)
  - localStorage removes: `onboardingCompleted` (322), `justOnboarded` (646)
  - `navigate('/owner-dashboard')` redirect if profile is owner (367)
  - Joyride tour state (303, 304)
- **Audit-question relevance**:
  - Auth-state cross-coupling (audit §3) — 5 of the 5 localStorage keys named in the audit live in this default branch.
  - Onboarding modal (`OnboardingModal`) is conditionally rendered here as a sibling of `renderContent()` at line 2162.
  - The hardcoded "Mes événements" mock at lines 1364–1429 ("Derby Tunis VS Sfax") is mock content that needs cleanup or data wiring.
  - The "Parcs / Enseignes" section at lines 1270–1346 is already `{false && (...)}`-gated (dead code, never renders).

### 1.2 `/profile` → renders `UserProfile.tsx`

- **Lines in Dashboard.tsx**: 804–805 (one-line case)
- **URL**: `/profile` (also accepts query params: `?tab=entreprise&sub=documents` per Dashboard.tsx:1483)
- **Render-trigger**: `case '/profile': return <UserProfile />`
- **Data dependencies**: delegated to `UserProfile.tsx` (1420 lines, its own state)
- **Side effects**: delegated
- **Audit-question relevance**: P0c hotfix already landed here (`a59cfb9`). The page itself is decomposable as a Step 7 sub-target (4 tabs: Responsable / Entreprise / Notifications / Confidentialité), but **out of scope** for the Step 7 brief as scoped — Dashboard.tsx and NewCampaign.tsx are the two named targets.

### 1.3 `/new-campaign` and `/new-event-campaign` → render `NewCampaign.tsx`

- **Lines in Dashboard.tsx**: 806–809 (two cases pointing to same component)
- **URLs**: `/new-campaign`, `/new-event-campaign`
- **Render-trigger**: `case '/new-campaign': return <NewCampaign />` and same for `/new-event-campaign`
- **Data dependencies / side effects**: delegated to `NewCampaign.tsx` (see Section 2). The `/new-event-campaign` route additionally requires `location.state.event` (a `SpecialEvent`) — if missing, `NewCampaign.tsx:1301-1305` redirects to `/evenements`.
- **Audit-question relevance**: this is the wizard entry point. Dashboard.tsx only routes to it.

### 1.4 `/my-campaigns` → renders `MyCampaigns.tsx`

- **Lines in Dashboard.tsx**: 810–811
- **URL**: `/my-campaigns` (also accepts `?status=draft` / `?status=completed` per Dashboard.tsx:1252, 1259)
- **Render-trigger**: `case '/my-campaigns': return <MyCampaigns />`
- **Data dependencies**: delegated to `MyCampaigns.tsx` (1657 lines)
- **Side effects**: delegated
- **Audit-question relevance**: Header bar styling on Dashboard.tsx changes when `location.pathname === '/my-campaigns'` (line 1903) — header reads location for visual variant. This coupling needs to migrate when the page extracts.

### 1.5 `/parcs` → renders `Parcs.tsx` (**DEAD** per audit-question resolution)

- **Lines in Dashboard.tsx**: 812–813
- **URL**: `/parcs`
- **Render-trigger**: `case '/parcs': return <Parcs />`
- **Data dependencies**: hardcoded Carrefour mock in `Parcs.tsx` (106 lines, see Section 3 Q2)
- **Side effects**: none of substance
- **Audit-question relevance**: **DELETE per Section 3 Q2 resolution.** The route, the import, the case, and `pages/Parcs.tsx` all delete in one commit. The Dashboard.tsx header bar's `/parcs` branch at line 1919 also deletes. ~30 lines net removed across the codebase.

### 1.6 `/evenements` → renders `Events.tsx`

- **Lines in Dashboard.tsx**: 814–815
- **URL**: `/evenements`
- **Render-trigger**: `case '/evenements': return <Events />`
- **Data dependencies**: delegated to `Events.tsx` (410 lines)
- **Side effects**: delegated
- **Audit-question relevance**: none surfaced. Clean delegation.

### 1.7 `/perfor` → renders `Perfor.tsx` (**DEAD** per audit-question resolution)

- **Lines in Dashboard.tsx**: 816–817
- **URL**: `/perfor`
- **Render-trigger**: `case '/perfor': return <Perfor />`
- **Data dependencies**: `performanceService.getDataset()` (advertiser-side, no owner filter)
- **Side effects**: state-only
- **Audit-question relevance**: **DELETE per Section 3 Q1 resolution.** Replaced by `OwnerPerformance` for owners; for advertisers, the analogous content lives in the `/dashboard` "Insights clés" + stats section. The route, the import, the case, and `pages/Perfor.tsx` (579 lines) all delete. The Dashboard.tsx header bar's `/perfor` branch at line 1951 also deletes. ~600 lines net removed.

### 1.8 `/my-recharges` → renders `MyRecharges.tsx`

- **Lines in Dashboard.tsx**: 818–819
- **URL**: `/my-recharges`
- **Render-trigger**: `case '/my-recharges': return <MyRecharges />`
- **Data dependencies**: delegated to `MyRecharges.tsx` (541 lines)
- **Side effects**: delegated; the page has a flagged silent-failure money-adjacent fetch at line 60 (issue #17)
- **Audit-question relevance**: clean delegation. Header bar variant at Dashboard.tsx:1967.

### 1.9 `/my-invoices` → renders `MyInvoices.tsx`

- **Lines in Dashboard.tsx**: 820–821
- **URL**: `/my-invoices`
- **Render-trigger**: `case '/my-invoices': return <MyInvoices />`
- **Data dependencies**: delegated to `MyInvoices.tsx` (304 lines)
- **Side effects**: delegated
- **Audit-question relevance**: Header bar variant at Dashboard.tsx:1983 shows breadcrumb `Mes Finances > Mes factures`.

### 1.10 `/my-clients` → renders `MyClients.tsx`

- **Lines in Dashboard.tsx**: 822–823
- **URL**: `/my-clients`
- **Render-trigger**: `case '/my-clients': return <MyClients />`
- **Sidebar gating**: only shown for `profileType === 'advertising_agency' || profileType === 'event_organizer'` (Dashboard.tsx:1793)
- **Data dependencies**: delegated to `MyClients.tsx` (633 lines)
- **Side effects**: delegated
- **Audit-question relevance**: profile-gated route. The gating logic embedded in Dashboard's sidebar (1793) needs to migrate when the page extracts.

### 1.11 `/my-cart` → renders `CartPage.tsx`

- **Lines in Dashboard.tsx**: 824–825
- **URL**: `/my-cart`
- **Render-trigger**: `case '/my-cart': return <CartPage />`
- **Data dependencies**: `CartPage.tsx` (569 lines) reads `localStorage.campaign_cart_items` directly (lines 47, 79, 84, 200)
- **Side effects**: cart-page is the third localStorage cart consumer alongside Dashboard.tsx and NewCampaign.tsx — divergent shape from `useCartStore` (see Section 4)
- **Audit-question relevance**: cart `localStorage` is one of the audit's "deferred to Step 7" items (audit §3 auth-state layering, parallel anti-pattern). All three cart-touching pages need to migrate to the existing-but-unused `stores/cart.store.ts` OR a refreshed cart store.

### 1.12 Modals rendered inside Dashboard.tsx layout (not separate routes)

These are not routes per se, but they're logical screen states triggered by Dashboard.tsx state and worth listing for the decomposition planning:

| Modal | State trigger | Lines in Dashboard.tsx | Decomposable to |
|---|---|---|---|
| `OnboardingModal` (5-step wizard, 1164 lines in its own file) | `showOnboarding` state, currently disabled by `DISABLE_ONBOARDING_POPUPS = true` (Dashboard.tsx:123) | 2161–2164 (modal mount) | `components/onboarding/` |
| Logout confirmation | `showLogoutConfirm` | 2167–2199 | `components/dashboard/LogoutConfirmModal.tsx` |
| Support contact (`Support` form) | `showSupportModal` | 2202–2312 | `components/dashboard/SupportModal.tsx` |
| Take-appointment (`Prendre rendez-vous`) — uses internal `appointmentObjectives` from `authService.getAppointmentObjectives()` | `showContactModal` | 2315–2504 | `components/dashboard/AppointmentModal.tsx` |

### Dashboard.tsx route summary

| # | URL | Renders | Status |
|---|---|---|---|
| 1 | `/dashboard` | Inline default JSX | KEEP; extract to `pages/AdvertiserDashboard.tsx` |
| 2 | `/profile` | `UserProfile.tsx` | KEEP; route stays |
| 3 | `/new-campaign` | `NewCampaign.tsx` | KEEP; route stays |
| 4 | `/new-event-campaign` | `NewCampaign.tsx` (event mode) | KEEP; route stays |
| 5 | `/my-campaigns` | `MyCampaigns.tsx` | KEEP; route stays |
| 6 | `/parcs` | `Parcs.tsx` | **DELETE** (Section 3 Q2) |
| 7 | `/evenements` | `Events.tsx` | KEEP; route stays |
| 8 | `/perfor` | `Perfor.tsx` | **DELETE** (Section 3 Q1) |
| 9 | `/my-recharges` | `MyRecharges.tsx` | KEEP; route stays |
| 10 | `/my-invoices` | `MyInvoices.tsx` | KEEP; route stays |
| 11 | `/my-clients` | `MyClients.tsx` | KEEP (profile-gated); route stays |
| 12 | `/my-cart` | `CartPage.tsx` | KEEP; route stays |

**10 routes survive decomposition. 2 routes delete.**

---

## Section 2 — NewCampaign.tsx route inventory

`NewCampaign.tsx` is a wizard with **6 steps** for standard campaigns and
**3 steps** for event campaigns (lines 1884–3398 contain the per-step JSX,
verified via `grep -n "currentStep === "` on the file). The wizard
operates inside a single React component — no internal routing. Step
transitions are driven by the local `currentStep` state.

Each step below maps to the matching grep result.

### 2.1 Step 1 (standard only) — Diffusion type + campaign name

- **Lines**: 1884–1962 (`currentStep === 1 && !isEventCampaign`)
- **Conditional**: standard campaigns only; event-campaigns start at the event-step-1 (zones)
- **Purpose**: choose diffusion type (`toodooh` global vs `parc_tv` specific owner-fleet) + enter campaign name
- **State touched**: `diffusionType`, `formData.campaignName`
- **Data dependencies**: none external at this step
- **Validation**: `validateStep1()` (line 884) — requires `campaignName` and `diffusionType`

### 2.2 Step 2 (standard, `parc_tv` path) — Select Parc TV

- **Lines**: 1964–2029 (`currentStep === 2 && diffusionType === 'parc_tv'`)
- **Conditional**: standard campaigns where user picked `parc_tv` diffusion in step 1
- **Purpose**: pick one or more parcs (owner fleets) to diffuse on
- **Data dependencies**: `loadAvailableParcs()` (line 1433) reads `screens` + `business_profiles`
- **State touched**: `availableParcs`, `selectedParcIds`

### 2.3 Step 2 (standard, non-`parc_tv`) — Categories + client

- **Lines**: 2031–2113 (`currentStep === 2 && diffusionType !== 'parc_tv'`)
- **Conditional**: standard campaigns where user picked `toodooh` diffusion
- **Purpose**: select campaign categories (multi-select), enter client name for agency/event-organizer profiles
- **Data dependencies**: `authService.getOwnerBusinessSectors()` for `campaignCategories` (line 565)
- **State touched**: `formData.categories`, `formData.client`

### 2.4 Step 3 (standard only) — Dates

- **Lines**: 2115–2202 (`currentStep === 3 && !isEventCampaign`)
- **Conditional**: standard campaigns only; event-campaign dates come from `eventFromState`
- **Purpose**: pick start/end dates via `react-datepicker`
- **State touched**: `startDate`, `endDate`
- **Validation**: `validateStep2()` + `validateDate()` (lines 1136, 1276)

### 2.5 Step 4 (standard) / Step 1 (event) — Geographic zones

- **Lines**: 2204–2480 (`(currentStep === 4 && !isEventCampaign) || (currentStep === 1 && isEventCampaign)`)
- **Always shown**, with renumbering for event-campaigns
- **Purpose**: define one or more geographic zones (circle on Leaflet map + filtered locations) — the most complex step
- **Data dependencies**:
  - `campaignScreensService.getAllLocationsForMap()` for `allMapLocations` (line 1591)
  - `campaignScreensService.getLocationsInArea(lat, lng, radiusKm)` for `tempZoneLocations`
  - `campaignScreensService.getLocationsByIds()` for `freshLocationsForEstimate`
  - `campaignScreensService.getScreenIdsByLocationIds()` for `screenIdsFromSelectedLocations`
  - `predefinedZonesService` for `predefinedZones`
- **State touched**: `geographicZones[]`, `editingZone`, `tempZoneLocation`, `tempZoneRadius`, `selectedLocation`, `radius`, modal states
- **Sub-components in-file**: `MapEvents` (line 105), modal for adding/editing zones, predefined-zone filter UI
- **Heavy memoization**: `allSelectedLocations`, `effectiveScreenIds`, `selectedLocationIdsKey`, `wizardLocationsAffluenceKey` (lines 291–382)

### 2.6 Step 5 (standard) / Step 2 (event) — Video

- **Lines**: 2482–2612 (`(currentStep === 5 && !isEventCampaign) || (currentStep === 2 && isEventCampaign)`)
- **Always shown**, with renumbering
- **Purpose**: upload a new video or pick an existing approved one (≤ 30 seconds)
- **Data dependencies**:
  - `videoUploadService.uploadVideo()`, `createVideoEntry()`, `updateVideoDurationSeconds()`
  - `readVideoDurationFromFile()`, `readVideoDurationFromUrl()`
  - `supabase.from('videos')` for `loadMyApprovedVideos()` (line 1398)
- **State touched**: `uploadedVideoUrl`, `uploadedVideoId`, `selectedExistingVideo`, `_videoTab`, `uploading`, `uploadProgress`

### 2.7 Step 6 (standard) / Step 3 (event) — Validation + budget + cart-add

- **Lines**: 2614–3140 (`(currentStep === 6 && !isEventCampaign) || (currentStep === 3 && isEventCampaign)`)
- **Always shown**, with renumbering
- **Purpose**: validation summary, budget slider (CPM × impressions), save-as-draft button, add-to-cart button
- **Data dependencies**:
  - `useAdvertiserGlobalConfig` for `dooh.standard_campaign_cpm_tnd` / `dooh.event_campaign_cpm_tnd`
  - `balanceService.checkCampaignBalance(campaignId)` for the balance check on cart-add
  - `campaignService.saveCampaignDraft()` (line 677)
  - `supabase.rpc('link_campaign_to_event', ...)` for event-link
  - `supabase.from('campaigns').update(...)` for status + content_validation_status
- **Side effects**: `pushCampaignToSidebarCart(campaignId)` writes to `localStorage.campaign_cart_items` (line 1228) and dispatches `toodooh:cart-updated` custom event
- **State touched**: `adjustedBudget`, `customMinBudget`, `customMaxBudget`, `doohMaxImpressions`, `addingToCart`, `showPostCartStep`
- **P0d hotfix landed here**: lines 3170–3324 contain the now-error-checked cart-add and save-draft flows

### 2.8 Wizard navigation + Ariane breadcrumb

- **Lines**: 1833–3398 (`isCurrentStep`, navigation buttons, `setCurrentStep` calls)
- **Visual**: Ariane breadcrumb at the top (icons from `ariane1.png`–`ariane6.png`)
- **Behavior**: clicking a step jumps to it if `canNavigateToStep(stepId)` allows (line 1096)
- **Step renumbering for events**: event-campaigns use steps 1/2/3 mapping to the geographic-zones/video/validation triplet only

### NewCampaign.tsx step summary

| Step (std / evt) | Lines | Title | Always shown? |
|---|---|---|---|
| 1 / — | 1884 | Diffusion type + campaign name | Standard only |
| 2 / — (parc_tv path) | 1964 | Select Parc TV | Standard, parc_tv path |
| 2 / — (toodooh path) | 2031 | Categories + client | Standard, toodooh path |
| 3 / — | 2115 | Dates | Standard only |
| 4 / 1 | 2204 | Geographic zones | Always |
| 5 / 2 | 2482 | Video | Always |
| 6 / 3 | 2614 | Validation + budget + cart-add | Always |

**7 distinct step-flows (4 unique steps + 2 step-2 branches + step-3 standard-only); event-campaign collapses to 3 steps by dropping steps 1/2/3 of the standard flow.**

---

## Section 3 — Open audit-question resolution

### Q1 — Is `pages/Perfor.tsx` a fork of `pages/OwnerPerformance.tsx`?

**Resolution: DELETE `Perfor.tsx`** (per Explore-agent comparison; 75–80%
structural overlap; `OwnerPerformance.tsx` is the live owner page; the
advertiser-side `Perfor` was a fork without owner filtering and is reached
only via Dashboard.tsx's `/perfor` route).

Evidence: both share `safeNumber`, `formatCurrency`, `formatDuration`,
`percentageDiff`, `toIsoDate`, `getPresetRange`, the `KpiCard` component,
and both fetch from `performanceService.getDataset()`. The differences are
that OwnerPerformance has `OwnerNavigation`, owner-specific filtering by
`user?.id`, and temporal/demographic segmentation that Perfor lacks. No
file other than `Dashboard.tsx:106` imports `Perfor`. Verified DEAD;
safe to delete entirely.

**Action**: in the decomposition commit chain, drop the `/perfor` route
from `App.tsx`, remove `case '/perfor':` from `Dashboard.tsx:816`, delete
the `import Perfor from './Perfor'` at `Dashboard.tsx:106`, delete the
header-variant block for `/perfor` at `Dashboard.tsx:1951`, delete the
sidebar "Mes performances" button at `Dashboard.tsx:1738` (or repoint it
to a Step-11/Step-10 successor), and delete `pages/Perfor.tsx` itself.

### Q2 — Is `pages/Parcs.tsx` dead demo code?

**Resolution: DELETE `Parcs.tsx`** (per Explore-agent comparison;
hardcoded Carrefour mock data with no live data flow; only 2 references
in the codebase — `Dashboard.tsx:105` import and `App.tsx:219-225` route).

Evidence: `Parcs.tsx` (106 lines) renders a static marketing page with 6
hardcoded enseigne cards all pointing to Carrefour mock metrics
(32 écrans / 12 établissements / 145,000 impressions). Zero functional
overlap with the live `OwnerLocations.tsx`. Not part of the owner section
of the app.

Note: `Dashboard.tsx:1270–1346` contains a similar Carrefour mock block
gated by `{false && (...)}`. That dead block also deletes (no semantic
change since it doesn't render).

**Action**: drop `/parcs` route from `App.tsx`, remove `case '/parcs':`
from `Dashboard.tsx:812`, delete the import at `Dashboard.tsx:105`,
delete the header-variant for `/parcs` at `Dashboard.tsx:1919`, delete
the sidebar "Parcs" button (if present — I don't see one in the
sidebar; the `/parcs` route was reachable only via the gated `{false &&
...}` block in the dashboard default, so removing it has no UX regression),
and delete the `{false && ...}` block at lines 1270–1346, and delete
`pages/Parcs.tsx` itself.

### Q3 — `/owner-campaigns` vs `/owner-campaign-approvals` overlap

**Resolution: KEEP BOTH DISTINCT** (per Explore-agent analysis; the two
pages serve complementary workflows that share a service layer but
diverge on UX).

Evidence: `OwnerCampaigns.tsx` (1251 lines) is the comprehensive
"all-campaigns-on-my-fleet" hub with embedded approval logic per card.
`OwnerCampaignApprovals.tsx` (340 lines) is a focused inbox showing only
`approval_status = 'pending'` campaigns for fast triage. Both call the
same `campaignOwnerApprovalService` for the underlying state changes.
The split is intentional — owners can pick the lens depending on their
flow (browse-all vs triage-pending).

**Action**: no consolidation. Both routes stay. Out of scope for Step 7
(neither file is one of the two Step 7 targets).

### Q4 — Dashboard / Onboarding / cart `localStorage` sites

Identified the following five distinct localStorage keys touched across
the three files:

| Key | Stored | Why | Where used | Should live in |
|---|---|---|---|---|
| `onboardingCompleted` | `'true'` (string) | Skip onboarding modal if already completed | Dashboard.tsx (260, 281, 322, 633, 644, 711, 754, 782); Onboarding.tsx (103, 127, 339) | `auth.store.ts` `persist` — already has `onboardingCompleted: boolean` in the partialize fields per audit §3 Step 3. The localStorage reads should switch to `useAuthStore.onboardingCompleted`. The localStorage writes should call `useAuthStore.setOnboardingCompleted()` (helper to add to the store). |
| `user_profile_type` | profile type string (`'individual_owner'`, etc.) | Redirect to owner dashboard if owner | Dashboard.tsx (365, 713) | `auth.store.ts` already has `profileType` per audit §3 Step 3. **No new write needed**; the read at 365 is redundant with `useAuthStore.profileType`. Delete. |
| `user_raison_social` | `profile.contact_name` string | Display name in header | Dashboard.tsx (607) | `auth.store.ts` already has `contactName` per audit §3 Step 3 partialize. Delete the localStorage write at 607. |
| `justOnboarded` | `'true'` (string) | Trigger Joyride tour after onboarding modal closes | Dashboard.tsx (644, 646, 712); Onboarding.tsx (writes `'true'`, location unknown without re-grep) | Component-local state via React Router `location.state` (set in `navigate(...)` after onboarding completes) or a one-shot session flag in `useAuthStore` (e.g., `tourPending: boolean`, set to true on completion, set to false after tour runs). Preferred: session flag in store. |
| `campaign_cart_items` | JSON array of `{ id, name, amount, periodLabel, zonesLabel }` | Cart state across pages | Dashboard.tsx (653, 680, 685); NewCampaign.tsx (1204, 1228); CartPage.tsx (47, 79, 84, 200) | `stores/cart.store.ts` — exists today but is unused. The existing shape uses `campaignId`/`budget` and the existing data uses `id`/`amount`. Step 7 decision required: (a) migrate cart writers to the existing store and keep store as canonical, or (b) rewrite the store to match the live shape, or (c) write a new store that supports both consumer needs. **Recommended: option (b)** — rewrite the store to use the live `{ id, name, amount, periodLabel, zonesLabel }` shape since that's what the actual data is. The current store's `CartItem` type is theoretical (never used); rewriting it costs less than migrating 3 writers' usage. |

The cart `localStorage` also uses a custom event `toodooh:cart-updated`
(Dashboard.tsx:670, NewCampaign.tsx:1229) to broadcast changes between
tabs/windows. With a Zustand store + `persist`, this event becomes
unnecessary (subscribers re-render naturally on `set()`).

### Q5 — Auth-state cross-coupling

Direct `localStorage` reads/writes to auth-cache keys outside `auth.store.ts`:

| Key | File | Lines | Operation |
|---|---|---|---|
| `user_profile_type` | Dashboard.tsx | 365 | Read for redirect-to-owner-dashboard guard |
| `user_profile_type` | Dashboard.tsx | 713 | Remove on logout |
| `user_raison_social` | Dashboard.tsx | 607 | Write contact_name |
| `onboardingCompleted` | Dashboard.tsx | 260, 281, 322, 633, 644, 711, 754, 782 | Read / write / remove |
| `onboardingCompleted` | Onboarding.tsx | 103, 127, 339 | Read / write |
| `justOnboarded` | Dashboard.tsx | 644, 646, 712 | Read / remove |

NewCampaign.tsx does **not** touch auth-cache keys (only `campaign_cart_items`).

**Post-decomposition pattern**: all auth-cache reads go through
`useAuthStore`. The single `user_profile_type` read at Dashboard.tsx:365
is the most surprising — it's reading a stale localStorage value when
the store already has `profileType`. That entire `useEffect` (lines
363–370) can delete: `App.tsx`'s `AdvertiserRoute` guard already does
this redirect via `profileType` from the store (App.tsx:65–67). It's
duplicate logic.

### Q6 — Duplicate-page questions from Step 2a marked "Dashboard-coupled"

Per audit §3 "Duplicate pages", the deferred questions were:

1. **`Perfor.tsx` vs `OwnerPerformance.tsx`** → Resolved as Q1: DELETE `Perfor.tsx`.
2. **`Parcs.tsx` vs `OwnerLocations.tsx`** → Resolved as Q2: DELETE `Parcs.tsx`.

The Dashboard-coupled page files (`CartPage`, `MyCampaigns`, `MyInvoices`,
`MyClients`, `MyRecharges`, `UserProfile`, `Events`, `Onboarding`, plus
`NewCampaign`) all stay. They were "Dashboard-coupled" only because
Dashboard.tsx renders them via the `renderContent` switch. After
decomposition, each gets its own route via the `AdvertiserRoute` wrapper
in `App.tsx` and no longer needs Dashboard.tsx as the middleman.

### Newly surfaced questions during code reading

1. **Hardcoded "Mes événements" mock at Dashboard.tsx:1364–1429** ("Derby Tunis VS Sfax" cards). These render alongside the real `featuredEvents` (line 919). Are these intentional placeholders waiting for backend, or stale mock content? Decision needed: keep as placeholders or delete and let the real `featuredEvents` from `eventsService.getFeaturedEvents(3)` be the only source.
2. **`OnboardingModal` is currently force-disabled** by `DISABLE_ONBOARDING_POPUPS = true` at Dashboard.tsx:123. The modal logic (5-step wizard, 1164 lines in `Onboarding.tsx`) is functional but never rendered. Is this a permanent kill or a temporary disable? Step 7 should either remove the dead code (and the modal file) or re-enable. Recommend: surface for user decision before commit fires.
3. **`stores/cart.store.ts` exists but is unused** (`useCartStore` has zero importers). Confirmed via `grep -rn "useCartStore"` returning only the definition. The store is dead code today. The decision in Q4 above resolves this; flagging here for visibility.
4. **`ContentErrorBoundary` (Dashboard.tsx:25-52) catches render errors and displays them inline.** It's a debug helper that probably shouldn't ship to production. Should it stay as a Dashboard-local convenience, get extracted to `components/`, or be removed in favor of a proper application-wide error boundary at the route level?
5. **The cart sidebar column in Dashboard.tsx (lines 2090–2159)** is a UI block rendered as the right column of the layout, distinct from `CartPage.tsx` which is rendered as the main content when on `/my-cart`. There are now THREE cart UIs in the codebase: sidebar (in Dashboard), full page (CartPage.tsx), and add-to-cart flow (NewCampaign.tsx). All three read/write the same `localStorage.campaign_cart_items`. The sidebar is the layout's right column — when Dashboard.tsx decomposes, where does this sidebar live? Two options: (a) extract to a `<CartSidebar />` component that the new layout always mounts (current behavior preserved), or (b) make `<CartSidebar />` part of `<AdvertiserLayout />`. Recommend (b): the cart sidebar is layout-level, not page-level.

---

## Section 4 — Shared-extraction inventory

Patterns identified as duplicated or analogous between Dashboard.tsx and
NewCampaign.tsx. Each is a candidate for extraction either before or as
part of the decomposition commits.

### 4.1 `localStorage.campaign_cart_items` + `toodooh:cart-updated` event

- **Occurrence**: Dashboard.tsx (653, 670, 678–691); NewCampaign.tsx (1201–1233); CartPage.tsx (47, 79, 84, 200)
- **Identical / near-identical?**: near-identical — same shape (`{ id, name, amount, periodLabel?, zonesLabel? }`), same key, same custom event. Different code paths for reading vs writing.
- **Recommended target**: rewrite `stores/cart.store.ts` to use this shape and migrate all three call sites. New shape:
  ```ts
  interface CartItem { id: string; name: string; amount: number; periodLabel?: string; zonesLabel?: string; }
  ```
- **Location**: `apps/web/src/stores/cart.store.ts` (existing file, rewrite its content)
- **Effort**: low — Zustand `persist` middleware already handles the cross-tab subscription that the custom event was simulating

### 4.2 Balance lookup with fallback

- **Occurrence**: Dashboard.tsx (449–462); NewCampaign.tsx (uses `balanceService.checkCampaignBalance` indirectly + receives balance display via `useAdvertiserGlobalConfig` for CPM)
- **Pattern**: `getBalanceInfo` → fallback to `getUserBalance` → fallback to 0
- **Identical?**: only Dashboard.tsx uses the fallback chain directly. NewCampaign.tsx uses a different balance API (`checkCampaignBalance` returns `has_sufficient_balance` + `available_balance` + `campaign_cost`). Different needs.
- **Recommended target**: keep as-is for now. The "common pattern" is one site; not worth extracting until a third consumer surfaces. **Skip from Step 7 shared extraction.**

### 4.3 `log.error` + toast.error helper pattern

- **Occurrence**: both files use the pattern `log.error({ error }, 'msg'); toast.error(getErrorMessage(error) || 'Erreur ...');` 15+ times each
- **Identical?**: identical pattern, varied messages
- **Recommended target**: `apps/web/src/lib/errors.ts` — add a `surfaceError(err, fallbackMessage, log)` helper that does both. Move adoption to Step 11 (the observability cleanup pass per issue #16) rather than Step 7. **Defer.**

### 4.4 Date helpers (`toLocalDateOnlyString`, `parseCampaignUiDate`, formatting)

- **Occurrence**: NewCampaign.tsx defines `toLocalDateOnlyString` (line 141), `parseCampaignUiDate` (line 148). Dashboard.tsx has its own `getCalendarDays` (133), `isDateUnavailable` (156), `isDatePast` (162). UserProfile.tsx, MyCampaigns.tsx, OwnerLocations.tsx etc. also have inline date formatting.
- **Identical?**: analogous, not identical
- **Recommended target**: `apps/web/src/lib/dates.ts` — exists already as part of `lib/dooh/dates.ts` from Step 4, but the calendar-day-cell and weekday-label helpers are UI-specific, not pricing-specific. Recommend: keep `lib/dooh/dates.ts` for the engine-side helpers, add a new `apps/web/src/lib/ui-dates.ts` for UI-side calendar/date formatting helpers.
- **Effort**: low to medium — the helpers are small but consumers are numerous

### 4.5 `MONTHS_FR` / `WEEKDAYS_FR` localized arrays

- **Occurrence**: Dashboard.tsx (170, 184); analogous arrays likely in MyCampaigns.tsx, OwnerSettings.tsx via `react-datepicker` locale config
- **Identical?**: identical strings
- **Recommended target**: `apps/web/src/lib/i18n.ts` or `apps/web/src/lib/locale.ts` — small constants module
- **Effort**: low

### 4.6 Onboarding-modal-open helper (`openOnboardingModal`, gating disabled features)

- **Occurrence**: Dashboard.tsx (316–326); NewCampaign.tsx (the "disabled-feature" toast pattern surfaces in step-1 button gates but doesn't call into onboarding modal)
- **Recommended target**: stay in `<AdvertiserLayout />` — this is a layout-level concern, not shared between page bodies. **Skip.**

### 4.7 Form-state-management patterns (`useState({form fields})` + `validate(name, value)` + `errors` + `touched`)

- **Occurrence**: NewCampaign.tsx (formData, errors, touched, validateField — lines 215, 227–229, 818); UserProfile.tsx (responsable / entreprise / etc. forms); SignUpForm.tsx (auth signup); Onboarding.tsx (5-step wizard with per-step forms)
- **Identical?**: analogous but each form is bespoke. The pattern is "controlled form fields with per-field validation on blur or change".
- **Recommended target**: this is a Step-10 (React Query / form library) concern, not a Step 7 concern. If a form library is added (react-hook-form, zod-validated, etc.), the pattern goes there. **Defer to Step 10.**

### 4.8 Wizard navigation pattern (`canNavigateToStep`, breadcrumb, prev/next buttons)

- **Occurrence**: NewCampaign.tsx (lines 1096–1133 + 3145–3398); Onboarding.tsx (line 290 `nextStep()`, 301 `prevStep()`, 307 `skipStep()`)
- **Identical?**: analogous structure (current step + canNavigateTo + breadcrumb + nav buttons)
- **Recommended target**: `apps/web/src/hooks/useWizard.ts` — a generic `useWizard(steps: Step[], options?: { allowBack?: boolean; allowSkip?: boolean; canNavigateTo?: (idx) => boolean })` hook returning `{ currentStep, goToStep, nextStep, prevStep, isFirst, isLast, ... }`. Each consumer (NewCampaign, Onboarding) provides its own step definitions + validation predicates.
- **Effort**: medium — the hook itself is small, but the integration into NewCampaign + Onboarding requires care to preserve the existing branch logic (event-campaign step renumbering, parc_tv branch, etc.)
- **Recommended**: **extract in Step 7** as Commit 1's main deliverable (shared-extraction phase)

### 4.9 Modal scaffolding (`fixed inset-0 bg-black/50 ...` overlay + close button + Form)

- **Occurrence**: Dashboard.tsx — 4 modals (logout, support, contact, onboarding-rendered); NewCampaign.tsx — multiple modals (zone-create/edit, events-detection, others)
- **Identical?**: structurally identical — same overlay div, same close pattern, same JSX skeleton
- **Recommended target**: `apps/web/src/components/Modal.tsx` — a `<Modal isOpen onClose title>` wrapper that takes children. Then each modal becomes `<Modal title="Support" isOpen={x} onClose={...}>...</Modal>`.
- **Effort**: low to medium — the wrapper is small but adopting it requires modifying ~10 modal sites. Most of the value comes from a consistent close behavior (Escape key, outside-click) which today is inconsistent across modals.
- **Recommended**: **extract in Step 7** Commit 1

### 4.10 Sidebar navigation pattern (sidebar button with active/inactive icons, disabled state, route navigation)

- **Occurrence**: Dashboard.tsx — 6+ sidebar buttons all with the same structural pattern (lines 1660–1820)
- **Identical?**: each call is a 30-40 line button with `onClick`, `disabled`, `title`, `className`, `<img src={active ? ... : ...}/>`, label
- **Recommended target**: `apps/web/src/components/dashboard/SidebarNavItem.tsx` — `<SidebarNavItem path icon activeIcon label isDisabled disabledMessage />` reducing each 35-line button to a 5-line component invocation
- **Effort**: low
- **Recommended**: **extract during Dashboard.tsx decomposition** (not the shared-extraction phase, since this is Dashboard-specific)

### 4.11 Header bar variant pattern (page title + icon + subtitle + right-actions)

- **Occurrence**: Dashboard.tsx (1892–2087) — 8+ branches in the header for different routes (my-campaigns, parcs, evenements, perfor, my-recharges, my-invoices, profile, default)
- **Identical?**: each branch has the same skeleton with different icon/title/subtitle
- **Recommended target**: `apps/web/src/components/layout/PageHeader.tsx` — `<PageHeader icon title subtitle breadcrumb? rightActions />`
- **Effort**: low to medium
- **Recommended**: **extract during Dashboard.tsx decomposition** (Dashboard-specific layout extraction)

### 4.12 Cart sidebar (right-column cart UI)

- **Occurrence**: Dashboard.tsx (2090–2159) — the right-column cart UI
- **Identical?**: single occurrence, but logically belongs to the layout and is used across all 12 Dashboard sub-routes
- **Recommended target**: `apps/web/src/components/layout/CartSidebar.tsx` — extracted as a layout child
- **Effort**: medium — touches the cart-store-vs-localStorage decision in Q4
- **Recommended**: **extract during Dashboard.tsx decomposition**

### Shared-extraction summary

| # | Pattern | Target | Phase |
|---|---|---|---|
| 4.1 | Cart shape + persistence | Rewrite `stores/cart.store.ts` | **Commit 1 (shared extraction)** |
| 4.4 | UI date helpers | `lib/ui-dates.ts` | **Commit 1** |
| 4.5 | Locale arrays (`MONTHS_FR` / `WEEKDAYS_FR`) | `lib/locale.ts` | **Commit 1** |
| 4.8 | Wizard navigation hook | `hooks/useWizard.ts` | **Commit 1** |
| 4.9 | Modal wrapper | `components/Modal.tsx` | **Commit 1** |
| 4.10 | Sidebar nav item | `components/dashboard/SidebarNavItem.tsx` | Dashboard decomposition |
| 4.11 | Page header | `components/layout/PageHeader.tsx` | Dashboard decomposition |
| 4.12 | Cart sidebar | `components/layout/CartSidebar.tsx` | Dashboard decomposition |
| 4.2 | Balance fallback | (not extracted; single site) | Skip |
| 4.3 | log+toast helper | `lib/errors.ts` extension | Defer to Step 11 |
| 4.6 | Onboarding-modal opener | layout-local | Skip |
| 4.7 | Form validation pattern | (consider form lib) | Defer to Step 10 |

**5 candidates for Commit 1 (shared extraction). 3 additional for the Dashboard decomposition commits. 4 deferred or skipped.**

---

## Section 5 — Decomposition shape recommendation

### 5.1 Dashboard.tsx → proposed structure

**Lead orchestration file**: `apps/web/src/pages/AdvertiserDashboard.tsx`
(~150–200 lines) — replaces the inline default-case JSX of Dashboard.tsx.
Renders the advertiser home (stats + last campaigns + featured events +
getting-started + insights). No layout wrapper, no routing — wrapped by
`<AdvertiserLayout />` at the route level.

**Layout file**: `apps/web/src/components/layout/AdvertiserLayout.tsx`
(~250–300 lines) — sidebar (nav items), header (per-route variant), main
content slot (children), right cart sidebar. Modals (logout/support/
contact) live as layout state, not as page state. Used in `App.tsx` to
wrap each advertiser route's component.

**Sub-pages**: each Dashboard sub-route becomes a direct route in
`App.tsx`, rendered inside `<AdvertiserLayout />`:

| New route component | Existing file or new | Estimated final lines |
|---|---|---:|
| `pages/AdvertiserDashboard.tsx` (new) | new (extracted from default case) | ~200 |
| `pages/UserProfile.tsx` | existing | unchanged (1420) |
| `pages/NewCampaign.tsx` | existing (decomposed separately, Section 5.2) | per Section 5.2 |
| `pages/MyCampaigns.tsx` | existing | unchanged (1657) |
| `pages/Events.tsx` | existing | unchanged (410) |
| `pages/MyRecharges.tsx` | existing | unchanged (541) |
| `pages/MyInvoices.tsx` | existing | unchanged (304) |
| `pages/MyClients.tsx` | existing | unchanged (633) |
| `pages/CartPage.tsx` | existing (with shape migration to cart store) | unchanged (~569, slight delta) |

**Deleted**: `pages/Perfor.tsx` (-579), `pages/Parcs.tsx` (-106). Net
~−685 lines from page deletes.

**Extracted hooks** (Dashboard-specific): `apps/web/src/hooks/dashboard/`:

| Hook | Source lines in Dashboard.tsx | Purpose |
|---|---|---|
| `useAdvertiserStats.ts` | 393–494 | Load campaigns + balance + aggregate stats |
| `useLastCampaigns.ts` | 497–596 | Load 5 most recent campaigns with categories + zones |
| `useFeaturedEvents.ts` | 694–704 | Load featured events for the home page |
| `useOnboardingState.ts` | 254–291, 624–648 | Read/write onboarding state (proxies into auth store) |

**Extracted components** (Dashboard-specific): `apps/web/src/components/dashboard/`:

| Component | Source lines in Dashboard.tsx | Purpose |
|---|---|---|
| `BalanceCard.tsx` | 849–913 | Solde disponible + Prêt à démarrer cards |
| `FeaturedEventsGrid.tsx` | 915–1016 | Featured events trio |
| `StatsGrid.tsx` | 1018–1072 | 4-stat widgets |
| `LastCampaignsGrid.tsx` | 1074–1268 | 5 campaign cards + "Gagnez du temps" |
| `RecommendedEventsCard.tsx` | 1348–1453 | Mes événements (real + mock-or-cleanup decision) |
| `GettingStartedSection.tsx` | 1455–1543 | "Pour bien commencer" 3-step |
| `InsightsCard.tsx` | 1545–1606 | "Insights clés" 3-card row |
| `SidebarNavItem.tsx` | 1660–1820 (templated) | Reusable sidebar button |
| `LogoutConfirmModal.tsx` | 2167–2199 | Logout confirmation |
| `SupportModal.tsx` | 2202–2312 | Support contact form |
| `AppointmentModal.tsx` | 2315–2504 | Take-appointment form |
| `CartSidebar.tsx` (in `components/layout/`) | 2090–2159 | Right-column cart sidebar |
| `PageHeader.tsx` (in `components/layout/`) | 1892–2087 | Per-route header variant |

**Estimated post-decomposition file sizes**:

| File | Lines |
|---|---:|
| `pages/AdvertiserDashboard.tsx` (new, was default-case JSX) | ~200 |
| `components/layout/AdvertiserLayout.tsx` (new) | ~250 |
| `components/dashboard/*` (sum of ~12 components) | ~1,400 (avg 115 each) |
| `hooks/dashboard/*` (sum of ~4 hooks) | ~200 (avg 50 each) |
| `components/layout/CartSidebar.tsx` | ~80 |
| `components/layout/PageHeader.tsx` | ~120 |
| **Total replacement** | **~2,250 lines across 18+ files** |
| **Dashboard.tsx delta** | **−2,507 (file deletes entirely)** |
| **Net code change** | **~−260 lines** (more files, but small per-file; modular) |

### 5.2 NewCampaign.tsx → proposed structure

The wizard structure suggests a shape where each step lives in its own
file, with a shared state container coordinating across steps.

**Lead orchestration file**: `apps/web/src/pages/NewCampaign.tsx`
(~250–350 lines) — wizard frame, breadcrumb, navigation buttons, the
shared state object and the per-step coordination. Renders the active
step component inside.

**State management**: a `useCampaignWizard()` hook in
`apps/web/src/hooks/useCampaignWizard.ts` (~250 lines) that owns all the
wizard state currently inline in NewCampaign.tsx — formData, geographic
zones, video state, budget state, balance, DOOH estimation, validation
predicates. Returns the state + handler functions to be passed to each
step component as props.

**Step components**: `apps/web/src/components/new-campaign/steps/`:

| Step component | Source lines in NewCampaign.tsx | Estimated lines |
|---|---|---:|
| `StepDiffusionAndName.tsx` (step 1 std) | 1884–1962 | ~80 |
| `StepCategoriesAndClient.tsx` (step 2 std non-parc_tv) | 2031–2113 | ~85 |
| `StepParcSelection.tsx` (step 2 std parc_tv) | 1964–2029 | ~70 |
| `StepDates.tsx` (step 3 std) | 2115–2202 | ~90 |
| `StepZones.tsx` (step 4 std / 1 evt) | 2204–2480 | ~280 |
| `StepVideo.tsx` (step 5 std / 2 evt) | 2482–2612 | ~135 |
| `StepValidation.tsx` (step 6 std / 3 evt) | 2614–3140 | ~530 (largest; includes budget slider + cart-add) |
| `WizardBreadcrumb.tsx` (ariane visual) | 1833–1880 | ~50 |
| `WizardNavigation.tsx` (prev/next buttons) | 3145–3398 | ~260 |

**Extracted modals**: `apps/web/src/components/new-campaign/modals/`:

| Modal | Source lines | Estimated |
|---|---|---:|
| `ZoneEditModal.tsx` (add/edit a geographic zone) | scattered in the 2204–2480 block | ~200 |
| `EventsDetectedModal.tsx` | scattered | ~100 |
| `PostCartStepModal.tsx` (showPostCartStep) | 2614–end of step 6 | ~150 |

**Extracted helpers**: `apps/web/src/lib/new-campaign/`:

| Helper | Purpose | Estimated |
|---|---|---:|
| `categoryMappings.ts` | `categoryMapping`, `categoryReverseMapping`, `categoryMultipliers` (lines 91–96, 547–560) | ~40 |
| `tunisiaCities.ts` | `TUNISIA_CITIES` list (lines 117–138) | ~30 |
| `leaflet-init.ts` | Leaflet icon init (lines 81–89) | ~20 |
| `geo.ts` | `distanceKm`, `getUsedLocationIds`, location filtering helpers | ~80 |

**Estimated post-decomposition file sizes**:

| File | Lines |
|---|---:|
| `pages/NewCampaign.tsx` (new lead) | ~300 |
| `hooks/useCampaignWizard.ts` | ~250 |
| `components/new-campaign/steps/*` (9 files) | ~1,580 (avg 175 each) |
| `components/new-campaign/modals/*` (3 files) | ~450 |
| `lib/new-campaign/*` (4 files) | ~170 |
| `components/MapEvents.tsx` (extracted Leaflet helper) | ~40 |
| **Total replacement** | **~2,790 lines across 19 files** |
| **NewCampaign.tsx delta** | **−4,039 (file deletes entirely)** |
| **Net code change** | **~−1,250 lines** (the file has dead state, unused memos, and inline JSX duplication that flattens out across modular files) |

### 5.3 Combined post-decomposition shape

```
apps/web/src/
├── pages/
│   ├── AdvertiserDashboard.tsx       (NEW — ~200 lines)
│   ├── NewCampaign.tsx               (REWRITE — ~300 lines, was 4039)
│   ├── UserProfile.tsx               (unchanged — 1420 lines)
│   ├── MyCampaigns.tsx               (unchanged — 1657 lines)
│   ├── Events.tsx                    (unchanged — 410 lines)
│   ├── MyRecharges.tsx               (unchanged — 541 lines)
│   ├── MyInvoices.tsx                (unchanged — 304 lines)
│   ├── MyClients.tsx                 (unchanged — 633 lines)
│   ├── CartPage.tsx                  (modified — shape migration to cart store)
│   ├── Onboarding.tsx                (unchanged or removed — see Q-newly-surfaced #2)
│   └── (Perfor.tsx and Parcs.tsx DELETED)
├── components/
│   ├── Modal.tsx                     (NEW — generic modal wrapper)
│   ├── layout/
│   │   ├── AdvertiserLayout.tsx      (NEW)
│   │   ├── PageHeader.tsx            (NEW)
│   │   └── CartSidebar.tsx           (NEW)
│   ├── dashboard/                    (NEW — ~12 components)
│   │   ├── BalanceCard.tsx
│   │   ├── FeaturedEventsGrid.tsx
│   │   ├── StatsGrid.tsx
│   │   ├── LastCampaignsGrid.tsx
│   │   ├── RecommendedEventsCard.tsx
│   │   ├── GettingStartedSection.tsx
│   │   ├── InsightsCard.tsx
│   │   ├── SidebarNavItem.tsx
│   │   ├── LogoutConfirmModal.tsx
│   │   ├── SupportModal.tsx
│   │   └── AppointmentModal.tsx
│   └── new-campaign/
│       ├── steps/                    (NEW — 7 step files + breadcrumb + navigation)
│       └── modals/                   (NEW — 3 wizard-internal modals)
├── hooks/
│   ├── useWizard.ts                  (NEW — generic)
│   ├── useCampaignWizard.ts          (NEW — NewCampaign state)
│   └── dashboard/
│       ├── useAdvertiserStats.ts
│       ├── useLastCampaigns.ts
│       ├── useFeaturedEvents.ts
│       └── useOnboardingState.ts
├── lib/
│   ├── ui-dates.ts                   (NEW)
│   ├── locale.ts                     (NEW)
│   └── new-campaign/                 (NEW — 4 helper files)
└── stores/
    └── cart.store.ts                 (REWRITE — shape migration)
```

---

## Section 6 — Routing changes

### 6.1 Routes in `App.tsx` currently pointing to Dashboard

12 routes currently render `<Dashboard />` via `AdvertiserRoute`:
`/dashboard`, `/profile`, `/new-campaign`, `/new-event-campaign`,
`/my-campaigns`, `/parcs`, `/evenements`, `/perfor`, `/my-recharges`,
`/my-invoices`, `/my-clients`, `/my-cart`.

### 6.2 Required changes

**Delete two routes entirely:**
- `/parcs` → delete (Q2 resolution)
- `/perfor` → delete (Q1 resolution)

**Repoint remaining 10 routes to dedicated pages:**

| URL | Current element | New element | Wrapper |
|---|---|---|---|
| `/dashboard` | `<Dashboard />` | `<AdvertiserLayout><AdvertiserDashboard /></AdvertiserLayout>` | `AdvertiserRoute` |
| `/profile` | `<Dashboard />` | `<AdvertiserLayout><UserProfile /></AdvertiserLayout>` | `AdvertiserRoute` |
| `/new-campaign` | `<Dashboard />` | `<AdvertiserLayout><NewCampaign /></AdvertiserLayout>` | `AdvertiserRoute` |
| `/new-event-campaign` | `<Dashboard />` | `<AdvertiserLayout><NewCampaign /></AdvertiserLayout>` | `AdvertiserRoute` |
| `/my-campaigns` | `<Dashboard />` | `<AdvertiserLayout><MyCampaigns /></AdvertiserLayout>` | `AdvertiserRoute` |
| `/evenements` | `<Dashboard />` | `<AdvertiserLayout><Events /></AdvertiserLayout>` | `AdvertiserRoute` |
| `/my-recharges` | `<Dashboard />` | `<AdvertiserLayout><MyRecharges /></AdvertiserLayout>` | `AdvertiserRoute` |
| `/my-invoices` | `<Dashboard />` | `<AdvertiserLayout><MyInvoices /></AdvertiserLayout>` | `AdvertiserRoute` |
| `/my-clients` | `<Dashboard />` | `<AdvertiserLayout><MyClients /></AdvertiserLayout>` | `AdvertiserRoute` (page itself profile-gates internally) |
| `/my-cart` | `<Dashboard />` | `<AdvertiserLayout><CartPage /></AdvertiserLayout>` | `AdvertiserRoute` |

The `AdvertiserLayout` wrapper is shared. Each route's `element` becomes a
direct page mount. Bundle-splitting via `React.lazy()` per page is
already in place at App.tsx (lines 10–43) and can stay; only
`<Dashboard />` becomes `<AdvertiserDashboard />` in the lazy load.

### 6.3 State-driven sub-routes in Dashboard.tsx that need URLs (or to stay state-driven)

None. All 12 current Dashboard "switch cases" map to URLs that already
exist in `App.tsx`. The decomposition doesn't introduce new logical
routes; it just resolves the renderContent indirection.

### 6.4 Onboarding modal

The `OnboardingModal` does not have its own URL — it's a modal triggered
by `showOnboarding` state inside Dashboard.tsx. Per Q-newly-surfaced #2,
the modal is currently force-disabled (`DISABLE_ONBOARDING_POPUPS = true`).
Two options:

1. **Keep as modal**: move the `OnboardingModal` mount to
   `AdvertiserLayout` so any advertiser route can trigger it. Modal state
   lives in the layout. **Recommend if the modal stays enabled.**
2. **Convert to a route**: `/onboarding` becomes its own page, rendered
   outside `AdvertiserLayout` (full-screen wizard). **Recommend if the
   `DISABLE_ONBOARDING_POPUPS = true` is permanent and the modal needs to
   come back as a one-time first-login flow.**

Decision required from user before Step 7 ships the layout. **Pause point.**

### 6.5 ContactPage

There's a separate `/contact` route at `App.tsx:412-418` that points to
`ContactPage.tsx` (a different file). This is NOT the take-appointment
modal in Dashboard.tsx. The two have different scopes; the route stays
as is, no change needed.

---

## Section 7 — Risk assessment

### 7.1 Routing regression risk — Score: 2/5 (low-medium)

The current routing is straightforward: 12 routes → one component → switch
on `location.pathname`. The post-decomposition routing routes 10 paths to
10 dedicated components inside a shared layout. The risk is that:
- Existing query params (e.g., `?status=draft` on `/my-campaigns`, `?tab=...&sub=...` on `/profile`) must still reach the destination pages — but they already do (pages read `useSearchParams()` themselves; Dashboard.tsx wasn't intercepting them).
- Existing state-passing via `navigate('/new-event-campaign', { state: { event } })` must reach NewCampaign.tsx — but `navigate.state` is delivered to whichever component the route renders, regardless of layout wrapping. Should work transparently.
- The route guard `AdvertiserRoute` continues to wrap each route — no semantic change.

**Mitigation**: in the routing commit, change one route at a time and run the app manually for each. Don't bundle all 12 route-flips into one commit.

### 7.2 State-management regression risk — Score: 3/5 (medium)

Several places where state currently lives in Dashboard.tsx and is consumed by inline JSX need to migrate to either props, hooks, or the cart/auth stores:

- `cartItems` state in Dashboard.tsx → cart store
- `onboardingCompleted` state in Dashboard.tsx → auth store (already partly there per audit §3 Step 3; Step 7 closes the gap)
- `profile` state in Dashboard.tsx → likely a new `useBusinessProfile()` hook that wraps `authService.getBusinessProfile()` (a thin React Query layer would be ideal, but that's Step 10)
- `lastCampaigns` / `stats` / `featuredEvents` → extracted hooks per Section 5.1

**Mitigation**: extract one state slice per commit. After each, verify the dashboard renders identically and the affected pages behave identically. **Risk concentration**: the cart state migration (3 consumers + custom event + Zustand persist) is the biggest single shift; do it as its own commit early in the chain.

### 7.3 Style / visual regression risk — Score: 4/5 (medium-high)

The Dashboard.tsx layout uses lots of inline Tailwind classes that
inherit from the surrounding container (`max-w-7xl`, padding, gap
spacing). Extracted components must preserve these or the layout shifts
visually. Specific known risk surfaces:

- The right cart sidebar is part of a `flex flex-row` parent in Dashboard.tsx — extracting it as a standalone component must preserve flexbox parent context.
- The header sticky positioning (`sticky top-0 z-40`) relies on the `flex` parent height — must verify after extraction.
- Inline `style={{ background: '#76E6AB' }}` and `style={{ boxShadow: ... }}` in several places — the audit doc's Step 12 brand token work has not landed yet, so these stay as inline-style for now. Don't accidentally remove them.

**Mitigation**: 
1. Screenshot each route before extraction.
2. After each commit, manually compare in browser (the Step 7 work must include a dev-server check per route).
3. Use a CSS regression tool only if hand-comparison surfaces something.

### 7.4 Auth / permission regression risk — Score: 3/5 (medium)

`isDisabled = needsApproval && validationStatus === 'pending'` is a
state-derivation in Dashboard.tsx (line 246) that gates 5+ sidebar
buttons and 2 header buttons. After decomposition, this needs to live
somewhere that all routes can access:

- **Option A**: a new `useAdvertiserGating()` hook returning `{ isDisabled, canRechargeAccount, canLaunchCampaign, hasRegistrationDocument }`. Used by `AdvertiserLayout` for sidebar gating + by each page for in-page gating.
- **Option B**: derive in `AdvertiserLayout` and pass as React Context.

**Recommend Option A**. Simpler, no Context overhead, easier to test.

**Mitigation**: extract `useAdvertiserGating()` early in the chain (before any sidebar extraction). Verify each gated route still gates correctly.

### 7.5 Bundle-size impact — Score: 2/5 (low; likely neutral-to-positive)

The current Dashboard chunk is ~617 kB (gzip 162.81 kB per Step 6 build).
It bundles Dashboard.tsx + NewCampaign.tsx + 9 sub-page imports + many
component dependencies.

After decomposition with per-route `React.lazy()`:
- Each route's chunk should shrink (the `/dashboard` chunk no longer needs NewCampaign, MyCampaigns, etc.)
- The `/new-campaign` chunk gets the wizard step components — likely similar size to before
- Shared chunks (Modal, layout, hooks) get hoisted to a vendor chunk
- Main `index-*.js` may grow slightly (more import statements, more lazy() calls)

**Likely outcome**: smaller per-route chunks, similar total bundle, faster initial load (smaller Dashboard chunk). The audit doc's done-when criterion ("largest chunk materially smaller") should be met.

**Risk**: lazy() boundaries can cause hydration flashes if a shared layout is in a different chunk than its content. **Mitigation**: keep `AdvertiserLayout` in the same chunk as the most common route (the dashboard home).

---

## Section 8 — Estimated effort and commit chain

The audit doc allotted "1-2 weeks" for Step 7. My discovery surfaces a
larger surface than the audit doc anticipated — both because the
shared-extraction layer is bigger than the audit suggested, and because
the layout-extraction is a separate concern from the page-extraction.
That said, much of it is mechanical.

### 8.1 Proposed commit chain

| # | Commit | Description | Effort (h) |
|---|---|---|---:|
| 0 | This discovery report | docs only | 4 (done) |
| 1 | shared-extraction: cart store rewrite + Modal + ui-dates + locale + useWizard | 5 candidates from §4 + tests for useWizard + tests for cart store | 8–12 |
| 2 | shared-extraction: layout components (AdvertiserLayout, PageHeader, CartSidebar, SidebarNavItem) | extract layout shells from Dashboard.tsx; not yet wired | 6–8 |
| 3 | delete Perfor.tsx and Parcs.tsx + drop their routes from App.tsx + clean Dashboard.tsx integration | dead-code cleanup (Q1 + Q2) | 2–3 |
| 4 | Dashboard: extract data-loading hooks (useAdvertiserStats, useLastCampaigns, useFeaturedEvents, useOnboardingState) | hook extraction | 3–5 |
| 5 | Dashboard: extract dashboard-home components (BalanceCard, StatsGrid, FeaturedEventsGrid, LastCampaignsGrid, GettingStartedSection, InsightsCard, RecommendedEventsCard) | component extraction | 6–8 |
| 6 | Dashboard: extract modal components (LogoutConfirm, Support, Appointment) | modal extraction + Modal-wrapper adoption | 3–4 |
| 7 | Dashboard: split into AdvertiserDashboard + AdvertiserLayout; wire all routes to direct page mounts via App.tsx | the main routing flip + Dashboard.tsx delete | 8–12 |
| 8 | NewCampaign: extract `useCampaignWizard()` hook | state hoist | 6–8 |
| 9 | NewCampaign: extract steps 1–4 components (StepDiffusionAndName, StepCategoriesAndClient, StepParcSelection, StepDates) | step component extraction (smaller steps) | 4–6 |
| 10 | NewCampaign: extract step 5 + 6 components (StepZones, StepVideo) | medium-complex steps | 6–8 |
| 11 | NewCampaign: extract step 7 component (StepValidation) | most complex step (budget slider, cart-add) | 6–8 |
| 12 | NewCampaign: extract wizard chrome (WizardBreadcrumb, WizardNavigation) + modals (ZoneEditModal, etc.) | finishing extraction | 4–6 |
| 13 | NewCampaign: rewrite NewCampaign.tsx to orchestrator-only | final cleanup | 3–5 |
| 14 | audit doc refresh + close #3 + commit-6-style methodology learnings | docs | 4–6 |

**Total: 14 substantive commits + 1 docs commit. Estimated effort: 69–99
hours (~9–12 working days, assuming 8-hour days), or ~2 calendar weeks at
a sustainable pace.**

This matches the audit doc's "1–2 weeks" estimate at the high end. The
expansion vs the audit doc comes from:
- Step 7 also doing the cart-store + auth-store cleanup (audit doc deferred these to "Step 7 with the rest" but didn't size them)
- Step 7 also addressing 2 page deletions (Q1, Q2) that the audit doc said would happen in Step 7
- The wizard-state extraction (`useCampaignWizard`) being more substantial than the audit doc anticipated

**Pause points**:
- After Commit 0 (this report) — user reviews discovery
- After Commit 1 — shared-extraction quality review
- After Commit 7 — Dashboard fully extracted; manual UI smoke test before NewCampaign work begins
- After Commit 13 — both files extracted; manual UI smoke test before audit refresh
- After Commit 14 — Step 7 closed

**Hard halts** (each commit):
- typecheck above 66
- lint above 395 (post-Step-6 baseline)
- any test fails
- bundle gzip moves more than +5 kB (decreases are OK; increases require investigation)
- visual regression on the affected route (manual smoke test)

### 8.2 Risks to the effort estimate

- **Visual regression hunt** (mitigation in §7.3) could double the time
  spent on Commits 5, 6, 7, 9, 10, 11, 12 if many small style fixes are
  needed.
- **The wizard's heavy memoization** (NewCampaign.tsx lines 291–382) is
  hard to refactor without breaking memo dependencies. If
  `useCampaignWizard()` ends up duplicating these memos rather than
  hoisting them, that's a refactor failure.
- **Cart-store shape migration** (Commit 1) might surface usage I haven't
  spotted (e.g., a third-party consumer in NewCampaign's add-to-cart
  flow that has a slightly different shape expectation). Could add 2-4
  hours.
- **The 5 outstanding questions in §3** (newly surfaced) need user
  decisions before some commits can fire. Total bandwidth-loss risk:
  half a day to a day of back-and-forth.

### 8.3 Estimate vs audit doc's 1–2 weeks

The audit doc's 1–2 weeks was on the optimistic side. My realistic
estimate is **2–2.5 weeks at sustainable pace** assuming the user is
available for the pause-point reviews and the 5 outstanding questions.
Aggressive pace (skipping some smoke tests, using subagents in parallel)
could compress to 1.5 weeks but at higher regression risk.

---

## Discovery summary

- **Total routes identified per file**: Dashboard.tsx has 12 logical routes (10 survive, 2 delete); NewCampaign.tsx has 6 standard / 3 event steps in a single component.
- **Number of audit questions resolved**: 6 of 6 from the brief, plus 5 newly surfaced for user decision before code-touching commits fire.
- **Number of shared-extraction candidates**: 12 patterns identified, 5 recommended for Commit 1 (cart store + Modal + ui-dates + locale + useWizard), 3 additional for Dashboard decomposition commits, 4 deferred or skipped.
- **Highest-risk areas flagged**: visual regression (4/5), state-management regression (3/5), auth gating migration (3/5).
- **Top-line effort estimate**: 2–2.5 weeks at sustainable pace; 14 substantive commits + 1 docs commit; audit doc's 1–2 weeks was on the optimistic side.

**Pause for user review.** Outstanding decisions needed before Commit 1 fires:

1. **Cart-store shape migration direction**: rewrite the store to match the live shape (recommended), or migrate writers to the existing store?
2. **Hardcoded "Derby Tunis VS Sfax" mock at Dashboard.tsx:1364–1429**: keep as placeholders, or delete?
3. **`OnboardingModal` enable/disable**: permanent kill (delete the modal file too), temporary disable (keep file, wire modal mount in `AdvertiserLayout`), or convert to a `/onboarding` route?
4. **`ContentErrorBoundary` (Dashboard.tsx:25-52)**: extract to a layout-level error boundary, or remove in favor of a route-level boundary, or keep page-local?
5. **Cart sidebar location**: extract as `<CartSidebar />` (option a in §3 Q-newly-surfaced #5) or as part of `<AdvertiserLayout />` (option b)?

The discovery report is comprehensive; the answers to these five
questions shape Commit 1's content but do not require code changes to
this discovery doc itself.
