# TOODOOH User Flows

Reference document describing how each user type currently flows through the application. Source: the
codebase as of commit `02baeb1`. Treat this as a map of **current behavior**, not a product spec.

When this doc disagrees with the actual code, the code wins — but update this doc to match.

All paths below are relative to `apps/web/src/`. This doc complements `docs/audit.md` (technical debt /
cleanup roadmap) — it does not duplicate it; technical details live there, user-visible behavior lives
here.

---

## 1. Common building blocks

### Authentication & sessions

- **Login** — `components/auth/LoginForm.tsx` (`handleSubmit`, line 19). Calls the auth store's
  `login` action; on success it reads `useAuthStore.getState().profileType` and navigates to
  `/owner-dashboard` (screenhosts) or `/dashboard` (advertisers) (`LoginForm.tsx:25-30`). The
  `/login` route renders `pages/auth/Login.tsx` → `LoginForm`, wrapped in `App.tsx`'s `PublicRoute`
  guard (`App.tsx:99-128`) — a logged-in user hitting `/login` is bounced to their dashboard.
- **Password reset** — `/reset-password` → `pages/auth/ResetPassword.tsx` → `components/auth/ResetPasswordForm.tsx`
  (`handleSubmit` line 13 → `authService.resetPassword(email)` → navigates `/login`). The reset email's
  link targets `/update-password` (built via `lib/app-url.ts` `getAppUrl('/update-password')` —
  env-driven, see `docs/audit.md` §3/§4).
- **Password change (from the reset link)** — `/update-password` → `components/auth/UpdatePasswordForm.tsx`
  (`handleSubmit` line 23 → `authService.updatePassword(password)` → navigates `/login`).
- **Password change (while logged in)** — inside the profile editors: `OwnerSettings.tsx` /
  `UserProfile.tsx` have a "Modifier le mot de passe" sub-tab; the underlying call is
  `authService.updatePasswordWithOld(currentPassword, newPassword)` (re-auths via
  `supabase.auth.signInWithPassword` then `updateUser`). Note `pages/OwnerSettings.tsx` and
  `pages/UserProfile.tsx` also issue `supabase.auth.signInWithPassword` inline for the re-auth rather
  than going through `authService` — minor inconsistency.
- **Session management** — owned by `stores/auth.store.ts` (`initialize`, the `onAuthStateChange`
  listener, `fetchProfileType`); see `docs/audit.md` §3 "Auth-state layering" for the technical
  picture. User-visibly: the app shows a full-screen loading spinner until the store is `initialized`,
  then routes you based on `profileType`.
- **Logout** — `authService.logout()` (→ `supabase.auth.signOut()`), wrapped by the store's `logout`
  action which also resets the persisted profile cache. Triggered from the side navigation
  (`Dashboard.tsx` sidebar; `components/OwnerNavigation.tsx`).

### Account validation states

A `business_profiles` row has `verification_status`. New signups get `'pending'` (`auth.service.ts:512`,
`onboarding_completed: false` on 513). An admin moves it to `'approved'` or `'rejected'` (see §4.3).
`'verified'` is treated as equivalent to `'approved'` throughout (`fetchProfileType` in `auth.store.ts`,
the route guards). A `'pending'` user **can log in and navigate** but the app sets `isDisabled =
needsApproval && validationStatus === 'pending'`, which greys out action buttons and most nav items
(e.g. `Dashboard.tsx`'s sidebar uses `opacity-50 cursor-not-allowed`; `pages/MyAccount.tsx:35`;
`pages/OwnerCampaigns.tsx`). There is no email-verification gate in the app code beyond Supabase's own
`emailRedirectTo` on signup — admin approval is the gate that matters.

### Who sees which routes (`App.tsx` guards)

- `PublicRoute` (login/signup/reset/update): logged-in → redirect to dashboard.
- `AdvertiserRoute` (`App.tsx:45`): `!user` → `/login`; screenhost (`profileType` is `individual_owner`
  or `fleet_owner`) → `/owner-dashboard`; otherwise (advertiser, or a pending user with no `profileType`
  yet) → render. Wraps `/dashboard`, `/profile`, `/new-campaign`, `/my-campaigns`, `/parcs`,
  `/evenements`, `/perfor`, `/new-event-campaign`, `/campaign-details/:id`, `/my-recharges`,
  `/my-invoices`, `/my-clients`, `/my-cart`.
- `OwnerRoute` (`App.tsx:72`): `!user` → `/login`; not a screenhost → `/dashboard`; otherwise render.
  Wraps `/owner-dashboard`, `/owner-screens`, `/owner-campaigns`, `/owner-locations`, `/owner-revenue`,
  `/owner-performance`, `/owner-calendar-devices`, `/owner-statements`, `/owner-statements/:id`,
  `/owner-activity`, `/owner-maintenance`, `/owner-campaign-approvals`, `/owner-settings`,
  `/gift-catalog`, `/my-account`, `/contact`. **Note:** `/contact` and `/my-account` are owner-only by
  this guard, even though `pages/ContactPage.tsx` carries a "BYPASS: Accès autorisé pour tous les types
  de profil" comment (see §5).
- `AdminRoute` (`components/admin/AdminRoute.tsx`): on mount calls `useAdminStore.initialize()`; while
  loading shows a spinner; `!admin` → `/admin-login`. **The `requiredRoles` prop is accepted but the
  role check is commented out** (`AdminRoute.tsx`, "pour l'instant, on skip cette vérification") — so
  `requiredRoles={['superadmin']}` on `/admin-events`, `/admin-create`, `/admin-management` currently
  has no effect; any authenticated admin reaches every `/admin-*` route.
- `/` and `*` → `<Navigate to="/login">`.

---

## 2. Advertiser flows

> The advertiser app is the 2635-line `pages/Dashboard.tsx`: it's the element for ~12 routes and
> switches on `useLocation()` in `renderContent()` (`Dashboard.tsx:927-952`) to show a sub-page. So
> "the advertiser dashboard" and "the advertiser campaigns page" etc. are URL states of one god-component.
> See `docs/audit.md` §3 "God-component `Dashboard.tsx`" — its decomposition is Step 5 (#3).

### 2.1 Registration and onboarding

`/signup` → `pages/auth/SignUp.tsx` → `components/auth/SignUpForm.tsx` (1954 lines). `SignUp.tsx`
defines step sets per profile type (`SignUp.tsx:17-38`): advertiser steps = `Type → Responsable →
Entreprise → Adresse → Documents` (`stepsDefault`). The form collects ~12 required fields (validated in
`authService.signUp`, ~`auth.service.ts:360-375`: `profile_type`, `business_type`, `business_name`,
`contact_name`, `contact_phone`, `street_address`, `city`, `postal_code`, `governorate_id`,
`terms_accepted`, `agent_toodooh`). On submit → `authService.signUp(data)`: `supabase.auth.signUp`
(with `emailRedirectTo: getAppUrl('/login')`) → inserts a `business_profiles` row with
`verification_status: 'pending'`, `onboarding_completed: false` (`auth.service.ts:512-513`).

After login, if `onboarding_completed === false`, `Dashboard.tsx` shows the `pages/Onboarding.tsx`
modal (imported there as `OnboardingModal`, line 107). Onboarding is a multi-step modal that lets the
user upload legal documents (registre de commerce, CIN — uploaded to Supabase storage,
`Onboarding.tsx` ~line 210/261) — **all documents are optional** ("Tous les documents sont maintenant
facultatifs", `Onboarding.tsx:67`); closing it calls `handleSubmit` which sets `onboarding_completed =
true`. So onboarding doesn't gate anything functionally; the gate is the admin approval of
`verification_status`. A new advertiser reaches a usable state once an admin approves them (§4.3).

### 2.2 Day-to-day use

`/dashboard` (the `default` case in `renderContent`, `Dashboard.tsx:952+`): the landing view — KPI
cards, a `react-joyride` guided tour, "diffusez votre spot sur une même enseigne" widgets, balance,
quick links. The sidebar (`Dashboard.tsx` ~line 1790+) navigates to: `/my-campaigns`, `/evenements`,
`/perfor`, `/my-recharges`, `/my-clients`, `/profile` — each greyed out if `isDisabled`. Main tasks:

- **My campaigns** — `/my-campaigns` → `pages/MyCampaigns.tsx` (lists the advertiser's campaigns by
  status; falls back to `MOCK_CAMPAIGNS` demo data — Carrefour Tunisie, Festival de Carthage, Ramadan
  2024, etc. — if the `campaigns` table is missing, `MyCampaigns.tsx:39+`).
- **Campaign detail** — `/campaign-details/:id` → `pages/CampaignDetails.tsx` (status badge:
  draft/pending/active/completed/rejected, `CampaignDetails.tsx:55-59`; shows the campaign's video
  `validation_status`).
- **My invoices** — `/my-invoices` → `pages/MyInvoices.tsx` (lists invoices; `handleDownloadPDF` →
  `generateInvoicePDF`; has a fallback query for a missing `invoices` table).
- **My recharges / wallet** — `/my-recharges` → `pages/MyRecharges.tsx` (see §2.7).
- **My clients** — `/my-clients` → `pages/MyClients.tsx` (an agency-style feature: the advertiser
  CRUDs their own "clients" — `handleAddClient`/`handleEditClient`/`handleDeleteClient`).
- **Parcs** — `/parcs` → `pages/Parcs.tsx` (a 106-line widget with **hardcoded Carrefour mock data**;
  see §5/§6).

### 2.3 Creating a campaign

`/new-campaign` (and `/new-event-campaign`) → `pages/NewCampaign.tsx` (4359 lines — the largest file in
the codebase; see `docs/audit.md` §3 / Step 5). It's a multi-step wizard. The services it pulls in
indicate the steps: campaign category (`CATEGORY_*` multipliers, `NewCampaign.tsx:86+`) → geographic
zones / screen targeting (`predefinedZonesService`, `campaign-screens.service`, `screensService`) →
video upload (`video-upload.service`) → period → **pricing simulation** via
`dooh-new-campaign-estimate.service` (the DOOH calculation engine fires here — this is the step that
shows the price). `campaignService.saveCampaignDraft` persists progress; `campaignService.submitCampaign`
submits. Submitting a campaign and "launching" it are split: the wizard creates the campaign as a
**draft** and the campaign goes into the cart (§2.4); the actual launch happens on the cart page.

Status flow (assembled from `CartPage.tsx`, `CampaignDetails.tsx`, `OwnerCampaigns.tsx`): `draft`
→ (confirmed on the cart) `pending` (awaiting video validation and/or screenhost acceptance) →
`active` → `completed`; `rejected` and `paused` are also reachable. `content_validation_status` on the
campaign is `'pending'` → `'approved'`/`'rejected'` (set by admin video validation, §4.8). Cross-ref
§4.5 (admin can emergency-stop a campaign) and §3.6 (screenhost accepts/refuses campaigns on their
screens). Note the DOOH math here implements an **older pricing model** — Step 4 (#12) migrates it to
the v3.0 model (`docs/handoff/pricing-model-v3.md` + `docs/handoff/Toodooh_Simulateur_Pricing_v3.html`).

### 2.4 Cart and checkout

`/my-cart` → `pages/CartPage.tsx`. The cart is stored in `localStorage` under `campaign_cart_items`
(written by `Dashboard.tsx` / `NewCampaign.tsx` — see `docs/audit.md` §3 "Auth-state layering",
parallel-anti-pattern note about `cart.store.ts`). On the cart page, `handleConfirmAndLaunch`
(`CartPage.tsx:98`): it reads each campaign, checks whether its video is validated
(`content_validation_status === 'approved'`), then updates the campaign — `status: 'active'` if the
video is validated, else `'pending'` (`CartPage.tsx:152-182`) — and debits the advertiser's balance
(`balanceService`). If the balance is insufficient it redirects to `/my-recharges`
(`CartPage.tsx:223`). So **the cart is the checkout/launch step**, separate from the creation wizard:
NewCampaign builds the draft, the cart confirms + pays + launches.

### 2.5 Events

`/evenements` → `pages/Events.tsx` (rendered via `Dashboard.renderContent`). Lists events from
`eventsService.getAllEvents()` / `getFeaturedEvents()`, categorised (ramadan / culture / concert /
festival / conférence / exposition — `Events.tsx:40-58`). "Booster" on an event
(`handleBoosterClick`, `Events.tsx:83`) navigates to `/new-campaign` with `state: { editMode: true,
campaign }` (or to `/my-campaigns`). So an advertiser picks an event and is taken into the campaign
wizard in an event-attached mode; the event-specific pricing (event CPM coefficient, fixed
before+during+after window) is part of the v3.0 model in `docs/handoff/pricing-model-v3.md`. (The
category labels in the current `Events.tsx` are cultural/seasonal; the v3.0 simulator's example events
are sports finales — the v3.0 model is the target, not what's wired today.)

### 2.6 Account management

`/profile` → `pages/UserProfile.tsx` (rendered via `Dashboard.renderContent`, `Dashboard.tsx:930`).
A tabbed editor — `Responsable` / `Entreprise` / `Notifications` / `Confidentialité et sécurité`, with
sub-items `Documents légaux`, `Préférences`, `Modifier le mot de passe`, `Supprimer le compte`
(`UserProfile.tsx:32-63`). `handleSaveResponsable` → `authService.updateProfile(...)`;
`handleSaveEntreprise` → `authService.updateBusinessProfile(...)`; password change as in §1; account
deletion is offered as a sub-tab. **`UserProfile.tsx` has the same tab/sub-item structure as the
screenhost's `OwnerSettings.tsx`** — they look like duplicates of one component (see §5).

`pages/ContactPage.tsx` (`/contact`) is a contact form (pre-fills the name from `useAuthStore`'s
`contactName`) — but the route is `<OwnerRoute>`, so in practice only screenhosts can reach it (see §5).

### 2.7 Wallet / recharges

`/my-recharges` → `pages/MyRecharges.tsx`. Quick-recharge buttons (1 000 / 2 500 / 5 000 / 10 000 TND,
`MyRecharges.tsx:33-36`); `balanceService` loads the balance + recharge history + campaign expenses;
payment methods labelled Carte bancaire / Virement / Espèces; the recharge designation is "Rechargement
wallet". A recharge request is reviewed and approved by an admin (§4.6) before it credits the balance.

---

## 3. Screenhost flows

`individual_owner` and `fleet_owner` go through the same routes and pages; the differences are at signup
(step labels and the fleet-establishment insertion) and in how many establishments/screens they have —
the day-to-day UI is identical. The screenhost app uses `pages/OwnerDashboard.tsx` and the family of
`Owner*` pages (real lazy routes — not Dashboard-coupled), plus `components/OwnerNavigation.tsx` for the
side nav.

### 3.1 Registration and onboarding

`/signup` → `SignUpForm`, with screenhost-specific step sets in `SignUp.tsx`: `stepsOwner` (fleet =
`Type → Responsable → Entreprise → Etablissement → Coordonnées bancaires`, `SignUp.tsx:25-30`) and
`stepsIndividualOwner` (`Type → Responsable → Etablissement → Adresse → Coordonnées bancaires`,
`SignUp.tsx:33-38`). So screenhosts also give bank details at signup. On submit → `authService.signUp`:
same `business_profiles` insert with `verification_status: 'pending'`. For fleet owners,
`authService.insertFleetEstablishmentsAfterSignup` (a private helper in `auth.service.ts`, ~line 179)
creates the establishment rows. After login, the same `Onboarding.tsx` modal applies (optional
documents → sets `onboarding_completed = true`). Transition: `pending` → admin approves (§4.3) →
`approved`; the screenhost only becomes visible to advertisers / their screens become targetable once
approved (and once an admin has the screens in the system — see §3.3).

### 3.2 Day-to-day use

`/owner-dashboard` → `pages/OwnerDashboard.tsx`: loads `screensService.getScreens()` +
`revenueService.getRevenueStats()` and shows alert/summary cards — screens in maintenance / inactive /
unavailable, revenue generated, "Points fidélité disponibles" — plus pending campaign approvals
(`campaignOwnerApprovalService`). Has an "add a screen" entry (`handleAddScreen`, `OwnerDashboard.tsx:331`,
opens the `AddScreen` modal). The side nav (`OwnerNavigation.tsx`) links to screens, locations, the
calendar, performance, revenue, statements, settings, the gift catalog, etc.

### 3.3 Screen management

- **Viewing screens** — `/owner-screens` → `pages/OwnerScreens.tsx`: `screensService.getScreens()` +
  `getUnavailabilityPeriods()`; lists each screen with a status (Actif / Inactif / Maintenance /
  Indisponible). Per-screen actions: `handleToggleAutoAccept` (turn on/off "auto-accept campaigns" for
  a screen — writes via `screensService.updateScreen`/`createUnavailabilityPeriod`,
  `OwnerScreens.tsx:196`), `handleStatusChange` (change a screen's status, `OwnerScreens.tsx:265`).
- **Adding screens** — **yes, screenhosts can add their own screens.** `components/AddScreen.tsx`
  (`screensService.createScreen`, line 108) is rendered as a modal from `OwnerScreens.tsx` (line 1090,
  triggered by a button at line 529) and from `OwnerDashboard.tsx`. (The admin side has a richer
  `admin-screens.service.ts` with `createScreen`/`updateScreen`/`deleteScreen`/affluence-data CRUD, but
  `adminScreensService.createScreen` has no UI caller in `pages/admin/` — see §5; `pages/admin/ScreenManagement.tsx`
  appears to be read-only over `getLocationsWithScreens`/`getOwners` in what's wired.)
- **Locations** — `/owner-locations` → `pages/OwnerLocations.tsx` ("Mes Emplacements"): a Leaflet map of
  the screenhost's screens; clicking a marker navigates to `/owner-screens`. In this code "locations"
  and "screens" are largely the same data — `OwnerLocations` just renders `screensService.getScreens()`
  on a map; there's no separate location entity the screenhost edits. (Admin-side, `admin-screens.service.ts`
  does treat `AdminLocation` as distinct — a location can be `no_screens` — but the owner side doesn't
  surface that.)
- **Availability** — `/owner-calendar-devices` → `pages/OwnerCalendarDevices.tsx`: a per-establishment
  calendar where the screenhost marks date ranges unavailable —
  `screensService.createUnavailabilityPeriod` + `updateScreen({ status: 'unavailable' })` ("Mettre
  indisponible") and the inverse ("Mettre disponible" → `deleteUnavailabilityPeriod` +
  `updateScreen({ status: 'active' })`) (`OwnerCalendarDevices.tsx:212-265`).

### 3.4 Campaign acceptance

A screenhost reviews campaigns that want to run on their screens and accepts/rejects them:

- `/owner-campaign-approvals` → `pages/OwnerCampaignApprovals.tsx`: tabs `En attente / Approuvées /
Rejetées / Toutes`; `handleApprove` / `handleReject` (rejection reason via `prompt()`,
  `OwnerCampaignApprovals.tsx:72`) → `campaignOwnerApprovalService.approveCampaign`/`rejectCampaign`.
- `/owner-campaigns` → `pages/OwnerCampaigns.tsx`: a richer list of the campaigns touching this
  screenhost (statuses A venir / Active / En attente / Terminée / Refusée / En pause / Brouillon), with
  `handleApproveSelectedCampaign` / `handleRejectSelectedCampaign` — also `campaignOwnerApprovalService`.
- Per-screen "auto-accept" (§3.3) short-circuits this for that screen.

`OwnerCampaigns` and `OwnerCampaignApprovals` overlap (both do accept/reject) — see §5.

### 3.5 Revenue and payouts

- `/owner-revenue` → `pages/OwnerRevenue.tsx` ("Mes Revenus"): `revenueService.getRevenueStats()` +
  `getRevenueByPeriod('monthly')`; "Dernières transactions" with `recharges` / `dépenses` tabs; a "RIB"
  bank-details form (`handleSaveBankDetails`, `OwnerRevenue.tsx:127` — name + RIB + a document upload to
  Supabase storage with a signed URL); a "Versement mensuel" / "Virement" section; link to
  `/owner-statements`. (Note the `recharges`/`dépenses`/`Dépenses ce mois` labels read advertiser-ish on
  a screenhost page — see §5.)
- `/owner-statements` → `pages/OwnerStatementsPage.tsx` ("Tous les relevés"): lists statements;
  `handleDownload` → `exportService` generates a PDF (`OwnerStatementsPage.tsx:49`).
- `/owner-statements/:statementId` → `pages/OwnerStatementDetailPage.tsx` ("Relevé"): the statement
  detail with an "Émetteur" block; `handlePrint`, `handleDownloadPdf`. It uses
  `utils/statementRecipient.ts`, which contains a `DEMO_RECIPIENT` (e.g. `contactName: 'Ahmed Hamouda'`)
  fallback — so statement recipient data may be demo data (see §6).
- **Payout mechanism:** I see _reporting_ (statements as PDFs, "versement mensuel" labels, a bank-details
  form) but **no payout-execution code** — no service call that issues a transfer. Treat payouts as
  "reported, not executed in the app" until proven otherwise (§5).

### 3.6 Loyalty / gifts

`/gift-catalog` → `pages/GiftCatalogPage.tsx` (owner-only): a catalog of **hardcoded** gift items
(Carrefour gift card, Bluetooth earbuds, smartwatch, restaurant card, power bank, spa experience —
`GiftCatalogPage.tsx:43-98`) with categories. `handleRedeem` (`GiftCatalogPage.tsx:158`) is purely
client-side — it decrements a local `userPoints` state and shows a toast; **no backend call**. So the
loyalty-points / redemption is a UI mockup (see §6). "Points fidélité disponibles" also appears as a
card on `OwnerDashboard`.

### 3.7 Settings / profile

`/owner-settings` → `pages/OwnerSettings.tsx` (1845 lines): a tabbed editor — `Responsable` /
`Entreprise` / `Notifications` / `Confidentialité et sécurité`; sub-items `Documents légaux`, `Mes
coordonnées bancaires`, `Préférences`, `Modifier le mot de passe`, `Supprimer le compte`
(`OwnerSettings.tsx:35-71`). `handleSaveResponsable` → `authService.updateProfile`; `handleSaveEntreprise`
→ `authService.updateBusinessProfile`; `handleSaveAdresse`; password change; account deletion.

`/my-account` → `pages/MyAccount.tsx` (owner-only): a **different** profile UI — a 4-step wizard
`Responsable → Entreprise → Adresse → Validation` (`MyAccount.tsx:25-29`), with `isDisabled =
needsApproval && validationStatus === 'pending'` (`MyAccount.tsx:35`). So screenhosts have **two**
profile pages (`OwnerSettings` tabbed editor + `MyAccount` 4-step wizard); advertisers have one
(`UserProfile`, which mirrors `OwnerSettings`). See §5.

---

## 4. Admin flows

### 4.1 Admin login

Admin auth is separate from user auth: a different store (`stores/admin.store.ts`, persisted under the
`admin-storage` key, with `persist` middleware), a different route prefix (`/admin-*`), and `AdminRoute`
guards it. `/admin-login` → `pages/admin/AdminLogin.tsx`: `useAdminStore().login` → `adminService.login`
→ `supabase.auth.signInWithPassword` (the _same_ Supabase auth backend as regular users — there's no
separate identity provider), then `adminService.getCurrentAdmin()` resolves the admin profile/role. On
success → `/admin-dashboard`. The page has a "← Retour" link to `/login`. The user-side
`onAuthStateChange` listener in `auth.store.ts` deliberately skips when the URL is under `/admin*`.

### 4.2 Admin dashboard

`/admin-dashboard` → `pages/admin/AdminDashboard.tsx`: loads `platformStatsService` —
`getGlobalStats`, `getRevenueStats`, `getOccupancyStats`, `getCampaignsPerformance`, `getTopScreens(5)`
(`AdminDashboard.tsx:49-53`). It's a stats overview with quick-link cards into the review queues:
`/admin-users`, `/admin-users?status=pending`, `/admin-campaigns`, `/admin-campaigns?status=active`,
`/admin-videos`, `/admin-videos?status=pending` (`AdminDashboard.tsx:179-358`).

### 4.3 User & admin management

- **Creating admins** — `/admin-create` → `pages/admin/CreateAdmin.tsx`: `adminService.createAdmin(...)`
  (email, password, role — `admin` or `moderator`; `CreateAdmin.tsx:76,89`).
- **Managing admins** — `/admin-management` → `pages/admin/AdminManagement.tsx`: `adminService.getAdmins()`,
  `deleteAdmin` (= deactivate, `AdminManagement.tsx:76`), `reactivateAdmin` (line 108). Roles shown:
  Super Admin / Administrateur / Modérateur (`AdminManagement.tsx:134-138`).
- **Reviewing users (advertisers & screenhosts)** — `/admin-users` → `pages/admin/UserManagement.tsx`:
  `adminUserService.getUsers()`, with a `pending / approved / rejected / all` filter (driven by a
  `?status=` query param too). `handleApproveUser` → `adminUserService.approveUser` (sets
  `verification_status: 'approved'`, `UserManagement.tsx:142,305`); `handleRejectUser` → `rejectUser`
  (`'rejected'`, line 179/330); `deleteUser`; batch approve/reject/delete. **This is the gate** that
  moves a new signup from `pending` to a usable state.

### 4.4 Screen management (admin)

`/admin-screens` → `pages/admin/ScreenManagement.tsx`: `adminScreensService.getOwners()`,
`getLocationsWithScreens(page, perPage, filters)` (`ScreenManagement.tsx:35,47`); statuses active /
maintenance / inactive / unavailable / `no_screens`. `admin-screens.service.ts` also exposes
`createScreen` / `updateScreen` / `deleteScreen` and affluence-data CRUD
(`createAffluenceData`/`updateAffluenceData`/`deleteAffluenceData`/`getScreenAffluenceData`) — affluence
data feeds the DOOH pricing math (`affluence`, `amax` in `docs/handoff/pricing-model-v3.md`) — but I
don't see UI callers in `pages/admin/` for the screen-create/affluence-edit methods (see §5). The
`AdminLocation` entity is distinct from a screen here (a location can have `no_screens`), unlike the
owner side. There's an `AffluenceModal` (`components/admin/AffluenceModal.tsx`) typed against
`admin-screens.service.ts`'s `AdminLocation` — likely the affluence-editing UI; its wiring isn't
confirmed here.

### 4.5 Campaign monitoring

`/admin-campaigns` → `pages/admin/CampaignMonitoring.tsx`: `adminCampaignMonitoringService` —
`getCampaignsWithScreens`, `getGlobalStats`, `getCampaignsByCategory`, and per-campaign
`getCampaignLocations` / `getCampaignImpressionProgress`; status filter pending/active/etc. An admin can
**emergency-stop** a campaign: `handleStopCampaign` updates the campaign to `status: 'paused'` with a
`validation_notes` of "⚠️ ARRÊT D'URGENCE par <admin> …" (`CampaignMonitoring.tsx` ~line 194+, with a
`PGRST204` fallback if the `validation_notes` column is absent). (This page also carried the
hook-ordering bug fixed in `docs/audit.md` §4 — historical note only.)

### 4.6 Recharge approval

`/admin-recharges` → `pages/admin/RechargeManagement.tsx`: `adminRechargesService.getRecharges(filters,
page, perPage)`, `getRechargeStats`, `approveRecharge` (= validate, `RechargeManagement.tsx:146`),
`rejectRecharge` (line 165), plus `cancelRecharge`, `getUserBalance`, and a "create a recharge manually"
form (`newRecharge` with an `auto_validate` flag). Confirmed: this is the queue where advertiser
balance-top-up requests are reviewed and validated/rejected (and admins can credit balances directly).
It guards against the `recharges` table being absent (`PGRST204`/`PGRST205`).

### 4.7 Event management

`/admin-events` → `pages/admin/EventManagement.tsx`: `adminEventsService` — `getEvents`, `getStats`,
`createEvent` (`EventManagement.tsx:161`), `updateEvent` (line 187), `deleteEvent` (line 206), plus
`toggleEventStatus` / `toggleFeatured` (events advertisers can attach campaigns to in §2.5; "featured"
events surface first in `Events.tsx`).

### 4.8 Video / media validation

`/admin-videos` → `pages/admin/VideoManagement.tsx`: `adminVideoService.getVideos(statusFilter)`,
`getValidationStats`, `approveVideo` (`VideoManagement.tsx:96`), `rejectVideo` (line 120); status filter
pending/approved/rejected. **This is the gate that flips a campaign's `content_validation_status`** —
which in turn decides whether the cart launch sets the campaign `active` vs `pending` (§2.4).

### 4.9 Other admin pages

- `/admin-zones` → `pages/admin/GeographicZonesManagement.tsx`: `predefinedZonesService` — CRUD over the
  predefined geographic zones (name, country = "Tunisie", image) that advertisers pick from in the
  NewCampaign wizard.
- `/admin-global-config` → `pages/admin/AdminGlobalConfiguration.tsx`: a generic key/value config editor
  (`globalConfigurationService.updateValue(key, valueText)`). Some DOOH numbers are already read through
  `getDoohConfigNumbers()` / `globalConfigurationService` (used by `pages/OwnerCampaigns.tsx`,
  `pages/NewCampaign.tsx`); when Step 4 migrates the engine to v3.0, the v3.0 parameters
  (`docs/handoff/pricing-model-v3.md`) belong here.

---

## 5. Open questions

- **`/contact` and `/my-account` are owner-only routes** (`<OwnerRoute>` in `App.tsx`), yet
  `pages/ContactPage.tsx` has a "BYPASS: Accès autorisé pour tous les types de profil" comment, and the
  document skeleton this doc was written from placed both under advertiser flows. Which is intended — a
  global contact/account page, or screenhost-only?
- **Three overlapping profile pages.** `pages/UserProfile.tsx` (advertiser, `/profile`) and
  `pages/OwnerSettings.tsx` (screenhost, `/owner-settings`) have an essentially identical tab/sub-item
  structure — they look like one component duplicated. `pages/MyAccount.tsx` (screenhost, `/my-account`)
  is a _third_ profile UI — a 4-step wizard with a "Validation" step. Why three? (`docs/audit.md` §3
  "Duplicate pages" doesn't list the `UserProfile`/`OwnerSettings` pair — it should; resolution belongs
  with Step 5.)
- **`OwnerCampaigns` vs `OwnerCampaignApprovals`** — both let a screenhost approve/reject campaigns via
  `campaignOwnerApprovalService`. Is one meant to supersede the other, or do they serve different views?
- **`AdminRoute` role-gating is dead code** — `requiredRoles` is accepted but the check is commented
  out. Is per-role admin access (superadmin vs admin vs moderator) supposed to be enforced?
- **Advertiser-flavoured labels on screenhost pages** — `pages/OwnerPerformance.tsx` ("Dépenses ce
  mois") and `pages/OwnerRevenue.tsx` ("Recharges" / "Dépenses" transaction tabs) read like advertiser
  content on a screenhost page. Related to the `Perfor.tsx` (advertiser, `/perfor`) vs
  `OwnerPerformance.tsx` (screenhost, `/owner-performance`) and `Parcs.tsx` (advertiser, `/parcs`) vs
  `OwnerLocations.tsx` (screenhost) pairs — forks of one page, or legitimately separate? (Already a
  Step-5 open question in `docs/audit.md` §3 "Duplicate pages".)
- **Admin screen creation / affluence editing** — `admin-screens.service.ts` has `createScreen` /
  `updateScreen` / `deleteScreen` / affluence-data CRUD, but no `pages/admin/` UI caller is visible for
  the create/affluence-edit methods (only `AffluenceModal` references the types). Is admin screen
  management UI incomplete, or wired somewhere not found? (Screenhosts _can_ add screens via
  `components/AddScreen.tsx` → `screensService.createScreen`.)
- **Payout execution** — is there an actual payout/transfer mechanism for screenhost revenue, or only
  reporting (statements + bank-details capture)? No execution path was found.
- **Loyalty points** — where do screenhost "points fidélité" come from? `GiftCatalogPage` and
  `OwnerDashboard` display points and a redemption UI, but the catalog is hardcoded and `handleRedeem`
  is client-only — is any of this backed?

## 6. Known gaps in current flows

- **`pages/OwnerActivity.tsx`** (`/owner-activity`) — a 14-line stub: just `<h1>Activité</h1>`. No content.
- **`pages/OwnerMaintenance.tsx`** (`/owner-maintenance`) — a 16-line stub: just `<h1>Maintenance</h1>`. No content.
- **`pages/GiftCatalogPage.tsx`** — gift items are hardcoded; `handleRedeem` only mutates local state +
  toasts. The loyalty/redemption flow isn't wired to a backend.
- **`pages/Parcs.tsx`** (`/parcs`, advertiser) — 106 lines of hardcoded Carrefour mock widgets; not a
  real feature.
- **Statement recipient data** — `utils/statementRecipient.ts` has a `DEMO_RECIPIENT` fallback; statement
  PDFs may render demo recipient data.
- **`pages/MyCampaigns.tsx`** — falls back to `MOCK_CAMPAIGNS` (Carrefour Tunisie, Festival de Carthage,
  Ramadan 2024, Rentrée Scolaire, Black Friday) when the `campaigns` table / `campaign_categories` table
  is missing — i.e. the page shows demo data rather than failing.
- **DB-schema fragility** — several pages have `PGRST116` / `PGRST204` / `PGRST205` fallback branches
  (`MyInvoices`, `MyCampaigns`, `CampaignDetails`, `RechargeManagement`, `CampaignMonitoring`,
  `auth.store.ts`'s `fetchProfileType`) — the app is defensively coded against tables/columns that may
  not exist in the connected Supabase project.
- **Pricing engine is the old model** — the live DOOH math (`services/dooh-*.ts`,
  `dooh-new-campaign-estimate.service.ts`) implements an older pricing model; Step 4 (#12) migrates it to
  v3.0 (`docs/handoff/pricing-model-v3.md`).
