# Slice 2 — Discovery Read

**Status:** HELD (not committed). Read-only, source-internal. Awaiting architect ratification (CF-9
may land in chunks).
**Date generated:** 2026-05-31. HEAD `94c7ce3` on `main`, working tree clean.
**Audience:** architect + executor. Internal only — no exec summary, technical depth throughout.
**Method:** triangulation of `docs/figma-vs-code.md`, `docs/user-flows.md`,
`docs/handoff/frontend-repoint-survey.md`, `docs/handoff/supabase-rpc-inventory.md`,
`docs/handoff/supabase-schema-inventory.md`, `docs/handoff/v3-data-requirements.md` — **reconciled
against the live source** (`apps/web/src` at HEAD). Where the docs and the code disagree, **the code
wins** (CF-23); the divergences are logged in §10.

> **Load-bearing caveat read FIRST.** The two structural-map docs (`figma-vs-code.md`,
> `user-flows.md`) were written against a **pre-restructure** codebase (commit `02baeb1`/earlier):
> the 2635-line God-component `Dashboard.tsx`, `MyAccount.tsx`, `Parcs.tsx`, a separate persisted
> `admin.store`, `AdminRoute` role-gating commented out, `MOCK_CAMPAIGNS` demo fallbacks. **None of
> that is true at HEAD.** Phase-1f (frontend repoint + the `1f-f7` cleanup) and Phase-1g (admin)
> restructured `apps/web` into feature folders and deleted most of the demo/dead surface. This
> discovery is the **current** map; treat §10 as the errata against the older docs.

---

## §1 — Context & scope

### §1.1 — What slice 2 is

Slice 2 is the **product layer beyond the account keystone**. Slice 1 closed the account spine:
signup / signin / signout / password / email-verify / profile edits / documents (Phase 1e backend +
Phase 1f frontend repoint) and **admin approval** of users (Phase 1g — `/admin-users` is on
`apiClient`). The Toodooh stack is live on the VPS (HTTP-only) with the admin
`assistant.ia@too-dooh.com` seeded.

Everything else is slice 2: the marketplace transaction (campaigns, screens, wallet), the
moderation/ops surfaces (the rest of admin), analytics (performances), events, and a **net-new
AGENT user type**. Concretely, slice 2 is the work of repointing the **~54 files that still import
`@/lib/supabase`** onto `apps/api` backends, per data slice, plus the deletions/consolidations Kais
ruled, plus the agent build-out.

### §1.2 — What slice 2 is NOT

- **Not slice-1 close-out.** `1h-tls` + `1h-email` + `1h-flip` are Kais-coordinated and do not block
  this discovery or the slice-2 sub-slices.
- **Not the v3.0 pricing wire-in.** Architect ruling: pricing stays **unwired** through slice 2; the
  data feed comes from an **external platform** (sensor / pax-counter) whose contract is not yet
  known. `lib/dooh/`, `v3-model.ts`, and all pricing-model files are **untouched** this slice.
- **Not the external-data-platform integration** (sensors, real audience/affluence telemetry). Slice
  2 builds CRUD on **existing entities**; the model-unit wire-up waits for that platform (§9).
- **Not the screenhost-unit decision** (`business_profiles` vs `location` vs `screen` as the v3
  modeling unit). That is downstream of the pricing wire-in (§9).

### §1.3 — Reading prerequisites

`figma-vs-code.md` (structural Figma↔code map — **stale, see §10**), `user-flows.md` (per-user-type
behavior — **stale, see §10**), `frontend-repoint-survey.md` + §8 rulings (the slice-1 repoint
discipline; §2.3 deferred-live + §2.4 client-stays are the slice-2 entry state),
`supabase-rpc-inventory.md` (the 30 frontend-reachable RPCs), `supabase-schema-inventory.md` (table
surface the `apps/api` must expose), `v3-data-requirements.md` (**context only** — pricing deferred).

---

## §2 — The deletions list

Reconciled against source. **Several of Kais's expected deletions were already executed in the
`1f-f7` cleanup** — they are marked `[ALREADY DONE]` and require no slice-2 work beyond confirmation.
All file paths are under `apps/web/src/`.

### §2.1 — Live deletion targets (slice-2 work)

| # | Route | Page file (lines) | Orphaned by deletion | Nav / ref cleanup | Tests |
|---|---|---|---|---|---|
| 1 | `/my-clients` | `features/advertiser/pages/MyClients.tsx` (615) | `hooks/useClients.ts`, `hooks/useClientMutations.ts` (both used **only** by this page), `advertiserKeys.clients(...)` query-key entry | `App.tsx:336–344` route; `AdvertiserLayout.tsx:168` `navigate('/my-clients')`, `:180` active-state check | none |
| 2 | `/gift-catalog` | `features/screenhost/pages/GiftCatalogPage.tsx` (359) | `features/screenhost/components/GiftCatalog.tsx` (**duplicate** hardcoded gift list); both carry the Carrefour mock. `handleRedeem` is client-only (no backend) | `App.tsx:472–478` route; `OwnerNavigation` link | none |
| 3 | `/owner-locations` | `features/screenhost/pages/OwnerLocations.tsx` (429) | `features/screenhost/components/LocationsMap.tsx` (orphaned **only if** no other screenhost consumer — verify; it is the screenhost-specific map). **`react-leaflet` is NOT removed** — still used by `/admin-zones` (`GeographicZonesManagement.tsx`) and the wizard `new-campaign/Step4.tsx`. The typecheck floor does **not** clear here (§10). | `App.tsx:392–398` route; `OwnerNavigation` link | none |
| 4 | `/owner-activity` | `features/screenhost/pages/OwnerActivity.tsx` (14 — stub `<h1>Activité</h1>`) | none (no data) | `App.tsx:440–446` route; `OwnerNavigation` link | none |
| 5 | `/owner-maintenance` | `features/screenhost/pages/OwnerMaintenance.tsx` (16 — stub `<h1>Maintenance</h1>`) | none (no data) | `App.tsx:448–454` route; `OwnerNavigation` link | none |

`useClients`/`useClientMutations` write to a `clients` table; that table is **also read-joined** by
`admin-campaign-monitoring.service.ts`. Deleting `/my-clients` removes the *frontend CRUD only* — the
table and the monitoring join are untouched.

### §2.2 — Convert, don't delete

- **`/campaign-details/:id`** → `features/campaigns/pages/CampaignDetails.tsx` (310). Kais #8: align
  to Figma's **side-drawer** over the campaigns list. Removes `App.tsx:308–314` route + the orphan
  hook `hooks/useCampaignDetail.ts`. `useVideoById` is **shared** (MyCampaigns, NewCampaign,
  OwnerCampaigns) — keep. The drawer host is the advertiser `MyCampaigns`; the screenhost
  `OwnerCampaigns` already renders a detail drawer (figma-vs-code §2 screenhost). **Ambiguity:** is
  `CampaignDetails.tsx`'s body re-homed as a shared `<CampaignDetailDrawer>` consumed by both, or two
  drawers? (§7 / ambiguities.)

### §2.3 — `[ALREADY DONE]` — confirm-only (no slice-2 work)

- **`/parcs` (`Parcs.tsx`)** — page + route **gone**. The surviving "Parcs" references
  (`useAvailableParcs`, `screensKeys.availableParcs`, `new-campaign/Step2.tsx`/`Step6.tsx`,
  `assets/inscrit/parcs.png`) are the **legitimate `parc_tv` wizard targeting mode** Figma intended —
  **keep**.
- **`/my-account` (`MyAccount.tsx`)** — page + route **gone**. The "third profile UI" no longer
  exists; the profile consolidation is now **2→1**, not 3→1 (§3.1).
- **Dashboard MVP variant** — never existed in code (Figma-only "MES PERFORMANCES MVP" frame). Kais
  #10 (abandoned) is satisfied by reality.
- **Hardcoded demo content** — `MOCK_CAMPAIGNS`, "Festival de Carthage", "Ramadan 2024", "Rentrée
  Scolaire", "Black Friday" — **all gone**. Residual demo content is only: (a) the Carrefour gift
  items (rides the `/gift-catalog` deletion, §2.1#2); (b) `DEMO_RECIPIENT`
  (`features/screenhost/utils/statementRecipient.ts:5–11`, `Ahmed Hamouda` / `Entreprise XYZ`),
  consumed by the **kept** `OwnerStatements*` pages — sweep it during the Wallet/Revenue consolidation
  (§3.3), not in a standalone pass.

### §2.4 — Merge (tracked in §3.4)

- **`/owner-campaign-approvals`** is not a pure delete — it overlaps `/owner-campaigns`. Both call
  `campaignOwnerApprovalService` via **shared** hooks (`useOwnerCampaignApprovals`,
  `useOwnerCampaignApprovalMutations` — also used by `OwnerDashboard`). Treated as a consolidation
  (§3.4); the merge has 6 inbound references to reroute.

---

## §3 — The consolidations list

### §3.1 — Profile pages → ONE (Kais #4)

**Now 2, not 3** (`MyAccount.tsx` already deleted, §2.3):

- `features/advertiser/pages/UserProfile.tsx` — `/profile` (advertiser, under `AdvertiserLayout`).
- `features/screenhost/pages/OwnerSettings.tsx` — `/owner-settings` (screenhost).

Both are tabbed editors with a near-identical structure (`Responsable` / `Entreprise`∼`Établissement`
/ `Notifications` / `Confidentialité et sécurité`; sub-items documents / bank / préférences /
password / delete-account). **Both were already repointed to `apiClient` in Phase 1f** (profile edits
→ `PATCH /api/profile/{business,contact,address,notifications}`; documents → `/api/profile/
documents/:type`). So this consolidation is **UI/structural, not a repoint**.

- **Canonical target (lean):** extract one shared `ProfileSettings` component parametrized by role
  (the only real divergence is label text — *Entreprise/Documents légaux* vs *Établissement/Coordonnées
  bancaires*), consumed by two thin route wrappers. Literal "one route for everyone" is not viable
  (the advertiser and screenhost tab sets differ). **Surface for ruling (§7).**
- **What's lost:** nothing functional; the duplication collapses.

### §3.2 — Mes Finances → ONE (Kais #6)

Figma designs one **"Mes Finances"** hub; code splits it:

- `features/wallet/pages/MyRecharges.tsx` — `/my-recharges` (balance card, quick-recharge tiles
  1000/2500/5000/10000, payment-method picker, recharge history).
- `features/wallet/pages/MyInvoices.tsx` — `/my-invoices` (invoice list + download-PDF;
  RPC `get_user_invoices_with_monthly`).

**Target:** one `/my-finances` page (wallet tab + invoices tab) matching the Figma hub. Data needed:
balance + recharge history (`balance.service` / wallet hooks) + invoices list
(`get_user_invoices_with_monthly`). Figma's full **"Facture"** document-detail view is *not built*
(`MyInvoices` only downloads PDF) — opportunity to add it as a drawer, or leave the PDF download.
**Lives in the Wallet sub-slice** (§7) — consolidate *while* repointing to avoid a double-touch.

### §3.3 — Mes Revenus → ONE (Kais #6)

Figma designs one **"Mes Revenus"**; code splits it three ways:

- `features/screenhost/pages/OwnerRevenue.tsx` — `/owner-revenue` (revenue card, recharges/dépenses
  tabs, RIB bank-details form w/ storage upload, "versement mensuel").
- `features/screenhost/pages/OwnerStatementsPage.tsx` — `/owner-statements` ("Tous les relevés").
- `features/screenhost/pages/OwnerStatementDetailPage.tsx` — `/owner-statements/:statementId`
  ("Relevé" doc; uses `DEMO_RECIPIENT`).

**Target:** one `/owner-revenue` ("Mes Revenus") with statements as an in-page list and the statement
detail as a **drawer/sub-view** (mirrors the campaign-detail drawer pattern). **Sweep `DEMO_RECIPIENT`
here** (§2.3). Data: revenue stats + monthly statements + bank details. **What's lost:** the standalone
statement-detail route (becomes a drawer). **Lives in the Wallet/Revenue sub-slice.**

> The "recharges / dépenses / Dépenses ce mois" labels on the screenhost revenue page read
> advertiser-ish (a long-standing `user-flows.md §5` question). Resolve label semantics during this
> consolidation.

### §3.4 — Events folded into Mes Campagnes (Kais #7)

Kais #7: the **screenhost** events page is **dropped entirely**; events appear **in Mes Campagnes**.
Reality check: there **never was** an `/owner-events` route or `OwnerEvents` page — the Figma "Mes
événements (screenhost)" frame was *designed-not-built*, and screenhost events already surface only as
a section on `OwnerDashboard`. So "drop the page" is **already satisfied**; the work is to **surface
events inside `OwnerCampaigns`** (a section/tab) rather than the dashboard-only card. **Lives in the
Campaigns sub-slice** (the screenhost campaigns surface).

- **Resolved non-conflict:** "events dropped" + "events in Mes Campagnes" is not a contradiction — the
  *separate page* is dropped; events become a *section of the campaigns surface*.
- **Ambiguity (§7):** the **advertiser** `/evenements` (`Events.tsx`) is the event-campaign **browse
  + Booster** entry (→ `/new-campaign` event mode). Kais #7 reads screenhost-specific. Does the
  advertiser `/evenements` also fold into `/my-campaigns`, or stay standalone? **Lean: stays
  standalone** (it's the event-campaign creation funnel, not a redundant list).

### §3.5 — The `/owner-campaign-approvals` ↔ `/owner-campaigns` merge

`OwnerCampaignApprovals.tsx` (327, tabs *En attente / Approuvées / Rejetées / Toutes*) overlaps
`OwnerCampaigns.tsx` (richer list + accept/refuse drawer). Figma designs **one** screenhost campaigns
surface. **Target:** merge approvals into `OwnerCampaigns` as a tab/filter; delete the standalone
route. **Inbound references to reroute (6):**

- `App.tsx:456–462` (route).
- `features/screenhost/components/OwnerNotificationsBell.tsx:168` `navigate('/owner-campaign-approvals')`.
- `features/screenhost/hooks/useOwnerNotifications.ts:152,171,182` hardcoded `actionPath`.
- `features/admin/services/admin-video.service.ts:321` hardcoded notification `action_path`
  (server-authored payload — reroute the string).

**Lives in the Campaigns sub-slice** (screenhost side). **Confirm merged target route name (§7).**

---

## §4 — The AGENT user type slice (net-new)

**Confirmed net-new** — nothing agent-shaped exists in code today.

### §4.1 — Current enum reality

`features/auth/types/auth.ts:8` — `profile_type: 'advertiser' | 'agency' | 'individual_owner' |
'fleet_owner'`. `business_type: 'local' | 'national' | 'agency' | 'event_organizer'`. The existing
`agent_toodooh` (signup) and `agent_code` (admin) fields are **referral metadata on existing users**,
**not** a user type. No `'agent'` role, no agent routes, no sensor-management UI.

### §4.2 — Platform role (assumptions — Kais's email was light)

Recorded assumptions for the executor scoping this sub-slice (NOT settled):

- The AGENT is a **Toodooh field-ops / sensor manager** — manages the physical sensor fleet
  (installation, status, maintenance) per screenhost establishment. (Inferred from "sensor
  management" + the existing `sensor_info` structure: `sn`, `hw_platform`, `sw_release`, `ip_address`,
  `connection_type`, `last_heartbeat`.)
- **Signup shape:** assume same approval-gated flow as other roles (`verification_status: pending` →
  admin approves) — agents are staff/field operatives, so admin-created may be more appropriate than
  self-signup. **Open.**

### §4.3 — Data model needed

- `profile_type` enum extension (`+ 'agent'`) **or** a separate role/permission table. Given agents
  are operationally distinct (not advertisers/screenhosts), and the better-auth `role` field already
  exists post-1g, **lean: a `role`-based extension** rather than overloading `profile_type`. **Open —
  needs the schema decision the executor scopes.**
- Sensor entities: a sensor registry (per screenhost unit), status/heartbeat, maintenance log. These
  **connect to the external platform** (same feed that gates v3 pricing, §9). Slice-2's agent
  sub-slice may need to **coordinate with that platform's interface** — **flag, do not resolve**.

### §4.4 — Figma maquette

Kais: a Figma-designed **agent dashboard exists**. It is **not** in the 27-frame export
(`figma-vs-code.md` had no agent frames). Figma is now accessible via the connected
`assistant.ia@too-dooh.com` workspace (file key `GZX8fN9wpRJdVtxGMONo4q`).
**→ Figma access is available for the executor that scopes the agent sub-slice. DO NOT make Figma API
calls in discovery.**

### §4.5 — Sensor-management assumptions

Plausible surface (record, don't resolve): a map/list of installed sensors per establishment, status
badges (online/offline/maintenance via `last_heartbeat`), maintenance ticketing, firmware
(`sw_release`) visibility. All of it depends on the external platform supplying live sensor state —
so the **UI can be built against a contract** but the live feed waits on the external interface.

---

## §5 — The 12 admin pages

Kais #2: **replicate existing code exactly** (no Figma maquette; no redesign). The work is repointing
each page's Supabase service to `apiClient` endpoints. **The admin auth layer is already done** (see
errata §10): `AdminRoute` reads the **unified `auth.store`** `role` field (no separate `admin.store`),
and `requiredRoles` gating is **active** (not commented out).

### §5.1 — Already repointed (slice-1, no slice-2 work)

- **`/admin-login`** (`AdminLogin.tsx`, 173) — `useAuthStore().login` → backend. Done.
- **`/admin-users`** (`UserManagement.tsx`, 972) — `admin-user.service.ts` → `apiClient`
  (`GET /admin/users`, `POST /admin/users/:id/approve|reject`, document presign). **This is the
  slice-1 approval keystone.** `admin-user.service.ts` is **not** in the 54-supabase set.

### §5.2 — Slice-2 admin repoint targets (still on Supabase)

| Route | Page (lines) | Service | Tables touched | RPCs called | State |
|---|---|---|---|---|---|
| `/admin-dashboard` | `AdminDashboard.tsx` (557) | `platform-stats.service.ts` | business_profiles, screens, campaigns, videos, special_events | `get_platform_global_stats`, `get_platform_revenue_stats`, `get_screens_occupancy_rate`, `get_campaigns_performance`, `get_top_performing_screens`, `get_recent_platform_activity` | functional, read-only |
| `/admin-screens` | `ScreenManagement.tsx` (432) | `admin-screens.service.ts` (+ `supabase` direct in `useAffluenceSchedule`) | locations, screens, business_profiles, screen_affluence_data, location_affluence_schedule | — | functional; **affluence CRUD is now wired** (AffluenceModal + `useAffluenceSchedule`/`useSaveAffluenceSchedule`) — contradicts older "no UI caller" note (§10) |
| `/admin-campaigns` | `CampaignMonitoring.tsx` (968) | `admin-campaign-monitoring.service.ts` | campaigns, business_profiles, clients, videos, campaign_screens, campaign_locations, locations, screens | `get_campaigns_global_stats`, `get_campaigns_with_screens`, `get_campaigns_by_status`, `get_campaigns_by_category`, `get_top_advertisers`, `get_most_used_screens` | functional; read + emergency-stop (`status:'paused'`) |
| `/admin-recharges` | `RechargeManagement.tsx` (913) | `admin-recharges.service.ts` | recharges, business_profiles, admin_profiles | `get_user_balance` | functional, **MONEY-ADJACENT** (CLAUDE rule 10); approve/reject/cancel + manual create |
| `/admin-videos` | `VideoManagement.tsx` (524) | `admin-video.service.ts` | admin_videos_view, videos | `get_video_validation_stats`, `get_campaigns_using_video` | functional; approve/reject — the **`content_validation_status` gate** (drives cart active-vs-pending) |
| `/admin-events` | `EventManagement.tsx` (1270) | `admin-events.service.ts` | admin_events_view, special_events, event_campaigns; storage `event-images` | `get_events_stats` | functional; full CRUD + toggle featured/active. **Kais #13 event-taxonomy collapse → sportif+culturel lands here** |
| `/admin-create` | `CreateAdmin.tsx` (373) | `admin.service.ts` | admin_profiles + `supabase.auth.signUp` | — | functional; **repoint must move admin creation off `supabase.auth.signUp` to the better-auth admin path** (§7) |
| `/admin-management` | `AdminManagement.tsx` (564) | `admin.service.ts` | admin_profiles (soft-delete/reactivate); business_profiles/screens counts | — | functional CRUD |
| `/admin-zones` | `GeographicZonesManagement.tsx` (676) | `predefined-zones.service.ts` (**screens domain**, shared w/ wizard) | predefined_zones; storage `zone-images` | — | functional CRUD (map UI, Leaflet) |
| `/admin-global-config` | `AdminGlobalConfiguration.tsx` (143) | `global-configuration.service.ts` (**shared**) | global_configuration + `supabase.auth.getUser` | — | functional key/value editor. **Still on Supabase** (sub-agent misread it as API-driven — §10). The v3 pricing keys land here **later** (slice 3, §9); the *config-CRUD repoint* is slice-2 |

**Cross-domain note:** `/admin-zones` uses the **screens-domain** `predefined-zones.service` (also
consumed by the campaign wizard), and `/admin-global-config` uses the cross-cutting
`global-configuration.service`. These two admin pages repoint *with* their owning domains, not as
admin-only work.

---

## §6 — The data domains

The ~54 supabase-importing files group into the domains below (counts approximate — a few files
double-classify, e.g. `OwnerSettings.tsx` is profile/auth not screens). Each domain is a candidate
sub-slice.

### §6.1 — Campaigns / video (≈16 files) — `features/campaigns/**` + `features/events` link

- **Keystone E2E:** advertiser builds a draft in the wizard (`NewCampaign.tsx`) → `/my-cart` →
  `handleConfirmAndLaunch` debits balance + sets `active|pending` → screenhost accepts/refuses in
  `OwnerCampaigns`. "This domain works" = that round-trip green.
- **RPCs:** `update_expired_campaigns`, `link_campaign_to_event` (+ video reads). **Tables:**
  campaigns, campaign_screens, campaign_locations, campaign_categories, campaign_owner_approvals,
  campaign_hourly_location_plan, videos; storage `videos` bucket.
- **Files:** 6 services (`campaign`, `campaign-screens`, `campaign-owner-approval`,
  `campaign-hourly-location-plan`, `dooh-new-campaign-estimate`, `video-upload`) + ~10 hooks
  (`useCampaignDetail`, `useCampaignMutations`, `useCampaignZonesForEdit`, `useConfirmCartLaunch`,
  `useMyApprovedVideos`, `useMyCampaignsMutations`, `useMyCampaigns`, `useRecommendedEventsForPeriod`,
  `useVideoById`, `new-campaign/useCampaignWizard`).
- **Deps:** **screens** (targeting), **wallet/balance** (cart debit — the seam), **events** (link),
  **global-config** (`getDoohConfigNumbers` — but pricing math is **deferred/untouched**:
  `dooh-new-campaign-estimate.service` stays on the legacy model, do not rewire pricing).
- **Largest file:** `NewCampaign.tsx` (already decomposed into `new-campaign/Step*.tsx` — the
  CLAUDE-flagged 4359-line monolith has been split; verify at scope time).

### §6.2 — Screens / locations (≈7 files) — `features/screens/**` + screenhost screen pages

- **Keystone E2E:** screenhost adds a screen (`AddScreen` → `screensService.createScreen`), toggles
  availability/status, marks calendar unavailability. Admin sees it in `/admin-screens`.
- **RPC:** `check_unavailability_status`. **Tables:** screens, screen_configurations,
  screen_unavailability_periods, screen_statistics, screen_alerts, screen_activity_logs,
  predefined_zones; storage `zone-images`.
- **Files:** `screens.service`, `predefined-zones.service`, `useOwnerScreensData`,
  `useOwnerScreensMutations`, `useAvailableParcs`, `useOwnerCampaignsOverview`.
- **Deps:** business_profiles. **predefined-zones is shared** with the wizard (§6.1) and `/admin-zones`
  (§5.2) — it is foundational to campaigns.
- **Note:** the screenhost-unit ambiguity (location vs screen) is **NOT** resolved here (waits on
  pricing, §9) — slice-2 builds CRUD on the entities as they exist.

### §6.3 — Wallet / Finance (≈8 files) — `features/wallet/**` + `services/balance.service.ts`

- **Keystone E2E:** advertiser requests recharge → admin approves (`/admin-recharges`) → balance
  credited → cart launch debits at `/my-cart`. Screenhost revenue/statements + RIB bank details.
- **RPCs:** `get_user_balance`, `check_campaign_balance`, `calculate_campaign_cost` (legacy pricing —
  **debit semantics preserved exactly**, CLAUDE rule 10). **Tables:** recharges, campaigns,
  user_balance_info; storage (bank docs / RIB).
- **Files:** `invoice-pdf.service`, `revenue.service`, `useCreateRecharge`, `useInvoices`,
  `useSaveBankDetails`, `useWalletTransactions`, `balance.service`.
- **Deps:** **campaigns** (cart debit — the circular seam; resolve by repointing `balance.service` in
  foundation), **admin-recharges** (same `recharges` table, admin moderation side).
- **Absorbs** the §3.2 (Mes Finances) + §3.3 (Mes Revenus) consolidations.
- **MONEY-ADJACENT — CLAUDE rule 10:** confirm recharge/debit semantics on every repoint; ask before
  changing.

### §6.4 — Performances (≈2 files) — `features/performances/**`

- **Asymmetric:** advertiser `/perfor` is an **18-line placeholder**
  (`AdvertiserPerformancePlaceholder.tsx` — "Cette page sera bientôt disponible"); the screenhost
  `OwnerPerformance` is real (`performance.service`).
- **Tables:** campaigns, campaign_screens, screens, campaign_locations, locations, predefined_zones,
  business_sectors. No RPC (compute-heavy in-service).
- **Deps:** campaigns, screens. **Real audience/affluence metrics depend on the external platform**
  (same feed as pricing/sensors) — so this is the **lowest-urgency** domain and partly blocked (§9).

### §6.5 — Events (≈3 files, user-facing) — `features/events/**`

- **Keystone E2E:** advertiser browses `/evenements` → Booster → event-campaign in the wizard.
- **RPCs:** `get_featured_events`, `get_all_events`, `get_all_events_count`,
  `get_my_event_campaigns_events`, `get_my_event_campaign_links` (+ `link_campaign_to_event` in
  campaigns). **Tables:** special_events, event_campaigns.
- **Files:** `events.service`, `useMyEventCampaigns` (+ the admin side is `admin-events`, §6.6).
- **Deps:** campaigns. Small; the screenhost-events fold (§3.4) rides the campaigns surface.

### §6.6 — Admin non-approval (≈9–11 files) — `features/admin/**` (minus `admin-user`)

The §5.2 pages' services: `platform-stats`, `admin-screens`, `admin-campaign-monitoring`,
`admin-recharges`, `admin-video`, `admin-events`, `admin.service` (+ hooks). **Cross-cutting reader/
moderator** — depends on every other domain's tables. Replicate UI exactly (Kais #2). `/admin-zones`
+ `/admin-global-config` repoint with their owning domains (§5.2 note).

### §6.7 — Agent (new) — §4

Net-new sub-slice. Depends on screens/sensors + the external platform interface.

### §6.8 — Global / cross-cutting (foundation, not a sub-slice)

`balance.service` (wallet ∩ campaigns ∩ admin-recharges), `global-configuration.service` (admin ∩
dooh path), notifications (`useOwnerNotifications` + bell). These are **seams multiple domains share**
— repoint them in **foundation** so the data-domain sub-slices build on a stable base. Also the
dev-only `scripts/checkTableStructure.ts` (a `scripts/**` file — console-allowed, low priority).

### §6.9 — Dependency graph (summary)

```
            screens ──────────────┐
              │  (predefined-zones)│
              ▼                    ▼
   campaigns ──→ wallet/balance   admin (reads all)
     │  ▲           ▲
     │  └───────────┘ (cart debit seam)
     ▼
   events
     ▼
   performances (+ external data, blocked)        agent (+ external platform, net-new)
```

Screens is the root (campaigns target screens; performances + admin read screens). Campaigns ↔ wallet
are coupled at the cart-launch balance debit (`balance.service` — repoint in foundation to cut the
knot). Admin is a pure consumer. Performances and Agent are downstream/partly external-blocked.

---

## §7 — Sub-slice ordering proposal

### §7.1 — Three lenses

- **Dependency-driven:** Screens → Campaigns → Wallet → Events → Admin → Performances → Agent.
  (`balance.service` repointed in foundation breaks the campaigns↔wallet cycle.)
- **Priority-driven (Kais "screenhost signup → campaign creation"):** signup is done, so the headline
  product flow is **campaign creation** — but it can't go live without Screens (targeting) and Wallet
  (cart launch). So Screens+Campaigns+Wallet form a **core-transaction cluster** that ships in
  sequence early.
- **Risk-driven (velocity / smallest-first):** Foundation (deletions + consolidations + cross-cutting
  repoint) → **Agent signup** (net-new, isolated, small) → then data domains. Builds momentum but
  defers the high-value transaction.

### §7.2 — Recommended path (lean)

**Dependency-driven with foundation first**, Agent sliceable in parallel:

0. **Foundation** (§8) — deletions + merge + drawer conversion; cross-cutting `balance.service` /
   `global-configuration.service` / notifications repoint; apiClient upload-helper gap.
1. **Screens** — root dependency; unblocks campaigns + `/admin-screens` + `/admin-zones`.
2. **Campaigns (+ video + cart)** — the headline transaction; pulls the wallet balance debit; absorbs
   the screenhost-events fold (§3.4) and the approvals merge (§3.5).
3. **Wallet / Finance** — recharge/revenue/statements/invoices; absorbs §3.2 + §3.3 consolidations.
4. **Events** — small; user-facing browse/boost.
5. **Admin** — repoint the 8 remaining admin services; replicate UI (Kais #2); event-taxonomy
   collapse (#13).
6. **Performances** — lowest urgency; screenhost real, advertiser placeholder; partly external-blocked.
7. **Agent** — net-new; needs Figma scoping (§4.4) + external-platform coordination (§4.3). **Agent
   *signup* (role + onboarding) can slot in parallel early** (it's auth-adjacent and isolated);
   **sensor-management waits** on the external interface.

### §7.3 — Dependency-only (what could parallelize)

- After **Foundation**: Screens and Agent-signup are independent → parallel.
- After **Screens**: Campaigns and `/admin-screens` + `/admin-zones` can proceed; Wallet is largely
  parallel to Campaigns except the cart-launch seam.
- **Admin** pages are independent of each other (per-page repoint) → highly parallelizable among
  themselves once their owning-domain tables are stable.
- **Performances** and **Agent-sensors** are the trailing/external-blocked pair.

---

## §8 — Foundation work (before the first data-domain sub-slice)

### §8.1 — Packaging options (for ruling)

- **Option A (prompt's lean): one `slice-2-foundation` commit** — deletions + consolidations +
  demo-sweep together. **Risk:** the finance/revenue/profile consolidations are real refactors that
  intersect the Wallet domain — bundling them invites a double-touch when Wallet repoints.
- **Option B (recommended): split.**
  - **Foundation-A (cheap, no backend):** deletions (§2.1) + `/campaign-details`→drawer (§2.2) +
    approvals merge (§3.5) + notification actionPath reroute. Pure removal/restructure.
  - **Foundation-B:** profile 2→1 consolidation (§3.1) — UI only, already-repointed.
  - **Finance (§3.2) + Revenue (§3.3) consolidations ride the Wallet sub-slice** (consolidate while
    repointing).
  - **Events fold (§3.4) rides the Campaigns sub-slice.**

### §8.2 — apiClient infrastructure gaps

Phase 1f built the `apiClient` (`credentials:'include'`, `VITE_API_URL`) and a document-upload path
(`POST /api/profile/documents/:type`). **New upload surfaces** slice-2 needs that may lack a helper:
**video upload** (large files — likely presigned/multipart), **RIB/bank docs**, **zone-images**,
**event-images**. Audit the `apiClient` for a reusable multipart/presigned helper; if absent, it is
**foundation infra** blocking the first domain that uploads (Campaigns video, or Screens zones).

---

## §9 — Tracked for later (slice 3+)

- **v3.0 pricing wire-in** — waits on the **external platform** (sensor/pax-counter data contract).
  `lib/dooh/`, `v3-model.ts`, pricing-model files untouched through slice 2.
- **Screenhost-unit decision** (`business_profiles` vs `location` vs `screen`) — downstream of the
  pricing wire-in.
- **v3 config keys in `/admin-global-config`** — the new pricing scalars (CPM, F, T thresholds, event
  coefficient, revenue split; the SPS weights are **constants**, not admin-editable — Kais #14) seed
  the `global_configuration` table **when pricing wires in**, not in slice 2.
- **Sensor live feed / external-platform integration** — the agent sub-slice can build UI against a
  contract; the live feed waits.
- **Carry-forwards (repoint survey §17.1 / 1f):** 2FA, strict `tax_number` matricule validation,
  `autoRefreshToken` removal.
- **`lint-1` floor (`import-x/no-unresolved` on `database.types`)** — clears only when **the last**
  data-domain repoint lets `src/lib/supabase.ts` be deleted (or TBD #15 generates `database.types`).
  Same model as repoint-survey §2.4/§8.3 — a still-1 floor mid-slice-2 is **not a miss**.

---

## §10 — Methodology surfaces (docs-vs-reality drift)

The slice-1 `1h-app-deploy` "lint-1 floor" model was stale; slice-2 discovery surfaced a **larger**
stale-doc problem. Logged so the executor trusts the code, not the older maps:

1. **`figma-vs-code.md` + `user-flows.md` describe a pre-restructure codebase.** At HEAD: the
   2635-line God-component `Dashboard.tsx` is **gone** (replaced by `AdvertiserLayout` +
   `AdvertiserDashboard` + real feature-folder routes); `MyAccount.tsx`, `Parcs.tsx` are **deleted**;
   `MOCK_CAMPAIGNS` and the demo events are **gone**. **Recommendation:** treat *this* discovery as
   the slice-2 map; do a targeted refresh of the two structural docs if they're to remain canonical.
2. **The `1f-f7` cleanup already did most of Kais's deletion/sweep list.** Slice-2 deletion scope is
   **5 live targets** (§2.1), not the ~12 the prompt anticipated. `/parcs`, `/my-account`, the demo
   content, and the MVP variant are already handled.
3. **Profile consolidation is 2→1, not 3→1** (`MyAccount.tsx` gone). §3.1.
4. **Admin auth is unified, not separate.** No `admin.store` — `AdminRoute` reads `auth.store.role`
   (corrects repoint-survey §1.2 / user-flows §4.1). **`requiredRoles` gating is ACTIVE** (corrects
   user-flows §5 "dead code" claim) — per-route superadmin/admin constraints are enforced.
5. **`admin-screens` create/affluence CRUD is now WIRED** (AffluenceModal + `useAffluenceSchedule`),
   contradicting user-flows §5's "no UI caller" note.
6. **`/admin-global-config` is still on Supabase** (`global-configuration.service` reads
   `global_configuration` + `supabase.auth.getUser`) — a per-page sub-agent read mislabeled it
   "API-driven." Verify per-page repoint status from the **service imports**, not the page.
7. **Deleting `/owner-locations` does NOT clear the react-leaflet typecheck floor** — Leaflet is
   retained by `/admin-zones` and the wizard `Step4` map. The floor clears only when those are
   re-typed, independent of slice-2 deletions.
8. **Advertiser performances was never built** — `/perfor` is an 18-line placeholder; the Figma
   advertiser "Perfor" frame is designed-not-built in reality.
9. **`/admin-create` creates admins via `supabase.auth.signUp`** — the repoint must route admin
   creation through the better-auth admin path, not just swap a table call.
10. **`apiClient` exists** (built in 1f) — the repoint-survey §5.1 "no HTTP client" is resolved; the
    open infra gap is **upload helpers** for the new slice-2 upload surfaces (§8.2).

---

## Conflicts / ambiguities needing an architect ruling

1. **Profile "ONE page" shape** (§3.1) — one shared `ProfileSettings` component + two role wrappers
   (lean), or literally one route? Tab sets differ by role.
2. **Campaign-detail drawer** (§2.2) — one shared `<CampaignDetailDrawer>` for advertiser +
   screenhost, or two?
3. **Advertiser `/evenements`** (§3.4) — fold into `/my-campaigns` too, or stay standalone (lean:
   standalone)?
4. **Approvals merge target** (§3.5) — confirm `/owner-campaigns` is the merged route + that the 3
   notification actionPaths + the admin-video notification payload reroute there.
5. **Agent** (§4) — `profile_type` extension vs separate role; self-signup vs admin-created;
   approval-gated?; sensor-management scope (blocked on external platform). Needs Figma scoping (file
   key on hand).
6. **Foundation packaging** (§8.1) — Option A (one commit) vs Option B (split; consolidations ride
   their sub-slices). Lean: B.
7. **Sub-slice ordering** (§7) — confirm dependency-driven (Screens→Campaigns→Wallet→Events→Admin→
   Performances→Agent) with Agent-signup parallelizable.
8. **Money-adjacent semantics** (§6.3) — confirm recharge/debit semantics are preserved exactly on
   the Wallet + admin-recharges repoint (CLAUDE rule 10).
9. **Admin-creation auth path** (§5.2 / §10.9) — does a better-auth admin-creation endpoint exist, or
   is it new backend work?

---

*End of slice-2 discovery. Held under `docs/handoff/`. Not committed.*
