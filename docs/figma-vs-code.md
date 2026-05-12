# Figma ↔ Code Structural Map

Maps the TOODOOH WebApp Figma file against the current frontend. This is a **structural** pass —
which screens exist on each side, how they're shaped, where they split or merge — not a pixel/visual
audit. The pixel-level pass is deferred to per-screen implementation work (likely Step 5 onward;
see §7).

Cross-reference: `docs/user-flows.md` (current per-user-type behavior, route → page mapping) and
`docs/audit.md` (technical-debt roadmap). When this doc disagrees with the code, the code wins —
update this doc to match.

## 1. Methodology and caveats

- **Source material:** 27 PNG frames exported from the Figma file `TOODOOH — WebApp` — 15 advertiser
  frames and 12 screenhost frames. No admin frames were in the export. The Figma MCP path is currently
  blocked (the authed account can't open the file; the plan also rate-limits Dev-Mode calls), so this
  is a screenshot-based reading, not a live node-by-node read.
- **Resolution caveat:** several frames are multi-screen boards (login states, the full signup wizard,
  the campaign wizard) downscaled to roughly 1.5–2k px wide in the export. That is enough to read
  _structure_ — section inventory, layout zones, sidebars, step counts, modal-vs-page shape — and
  nothing finer. **No claim in this doc is a pixel-level, spacing, typography, or exact-component
  claim.** Where a structural reading needs confirmation it's flagged "verify at pixel-pass time".
- **Code-wins-until-verified:** classifications below are best-effort from thumbnails plus the route
  map in `docs/user-flows.md`. Treat any "structural match" as "no structural divergence visible at
  this resolution", not "verified identical".
- **Route order** in §2 follows `docs/user-flows.md`: common → advertiser → screenhost → admin.

Classification vocabulary used in §2:

- **Structural match** — same screen, same section inventory, same layout shape.
- **Structural divergence (split)** — one Figma screen ↔ several code routes, or vice versa.
- **Structural divergence (merge)** — code merges what Figma separates (rare in practice; the reverse
  is more common — see §5).
- **Designed not built** — a Figma frame with no corresponding route/page.
- **Built not designed** — a route/page with no corresponding Figma frame.
- **Different layout shape** — same content, different container (modal vs page, drawer vs route).

## 2. Page-by-page structural mapping

### Common (auth)

| Route                                     | Figma frame                                                                   | Classification                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login` (`Login.tsx` → `LoginForm`)      | "Login" (advertiser) + "Login Screenhost"                                     | Structural match (+ minor layout-shape note) | Both Figma exports are visually identical six-state login cards (Connexion / request-reset / set-new-password / wrong-password error / invalid-email error). Code serves all states with one `LoginForm` + `ResetPasswordForm` + `UpdatePasswordForm`. One Figma frame uses a left-form / right-mint-panel desktop layout; the live `Login.tsx` is a centered card.                                                                                                                    |
| `/reset-password` (`ResetPasswordForm`)   | "Changer le mot de passe — saisissez votre email" card inside the Login frame | Structural match                             | Single email field + "Modifier le mot de passe" + "Revenir à la page d'accueil" link — matches `ResetPasswordForm`.                                                                                                                                                                                                                                                                                                                                                                    |
| `/update-password` (`UpdatePasswordForm`) | "Changer le mot de passe — nouveau mot de passe" card inside the Login frame  | Structural match                             | "Nouveau mot de passe" + "Saisissez à nouveau" + "Enregistrer" — matches `UpdatePasswordForm`.                                                                                                                                                                                                                                                                                                                                                                                         |
| `/signup` (`SignUp.tsx` → `SignUpForm`)   | "Inscription" (advertiser) + "Inscription" (screenhost)                       | Structural match                             | Horizontal stepper in both. Advertiser frame: Profil → Responsable → Entreprise → Adresse → Documents légaux → "Merci pour votre inscription !". Screenhost frame: Profil → Responsable → Établissement → Adresse → Coordonnées bancaires → same confirmation. Matches `stepsDefault` / `stepsOwner` / `stepsIndividualOwner`. The profile-picker cards (Annonceur / Agence / Propriétaire individuel / Propriétaire de parc) match the four `profile_type` / `business_type` options. |

### Advertiser

| Route                                                 | Figma frame                                                                                                                                                                 | Classification                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard` (`Dashboard.tsx` default case)           | "Dashboard" (advertiser)                                                                                                                                                    | Structural match                                                  | Both have an icon sidebar, top greeting bar ("Bonjour, Youssef"), dark balance card + "Lancer une campagne", same-enseigne spot widgets, "Pour bien commencer" onboarding cards, KPI tiles, campaigns table, "Insights clés" — the same section inventory as `renderContent`'s default case (plus the `react-joyride` tour). Figma adds a "Prendre rendez-vous" button in the top bar (not built — §3).                                                                                                                             |
| `/my-campaigns` (`MyCampaigns.tsx`)                   | "Mes campagnes" (advertiser)                                                                                                                                                | Structural match (list); detail handled differently               | Status-badged campaign table + stat tiles + "Créer une nouvelle campagne" matches `MyCampaigns`. The Figma frame also includes a "Détails de la campagne" side-drawer with a video thumbnail; code renders campaign detail as a separate full-page route — see `/campaign-details/:id`.                                                                                                                                                                                                                                             |
| `/campaign-details/:id` (`CampaignDetails.tsx`)       | the "Détails de la campagne" drawer within the "Mes campagnes" frame                                                                                                        | Different layout shape                                            | Figma designs this as an in-page side-drawer over the campaigns list; code implements it as a standalone route. Content matches (status badge draft/pending/active/completed/rejected, video `validation_status`).                                                                                                                                                                                                                                                                                                                  |
| `/new-campaign` (`NewCampaign.tsx`)                   | "Lancer une campagne"                                                                                                                                                       | Structural match                                                  | Multi-step wizard in both. The Figma frame splits the wizard into two labeled targeting modes — "Réseau Toodooh" and "Parcs TV" — each a full run (zone selection w/map → screen/establishment selection → video → period → pricing recap → confirmation). The code's wizard pulls `predefinedZonesService` + `campaign-screens.service` + `screensService`, consistent with a network-vs-parks split; whether it's surfaced as two explicit modes needs the pixel pass.                                                            |
| `/new-event-campaign` (`NewCampaign.tsx`, event mode) | "Configurer un evenement"                                                                                                                                                   | Structural match                                                  | Three-step "Configurer un événement" wizard — zone géographique (event cards + map) → contenu média (video upload) → validation/récapitulatif (CPM + impressions estimate + "Ajouter votre impact"). Code routes `/new-event-campaign` to `<NewCampaign>` in event mode (entered via Events "Booster").                                                                                                                                                                                                                             |
| `/parcs` (`Parcs.tsx`)                                | no standalone "Parcs" frame; "Parcs TV" appears only as a sidebar item and as a wizard targeting-mode in "Lancer une campagne"                                              | Built not designed (intent mismatch)                              | Code's `Parcs.tsx` is a 106-line hardcoded-Carrefour mock; the Figma "Parcs TV" concept is a campaign-targeting flow, not a standalone listing page. The route and the design diverge in purpose — flag.                                                                                                                                                                                                                                                                                                                            |
| `/evenements` (`Events.tsx`)                          | "Mes événements" (advertiser)                                                                                                                                               | Structural match (+ taxonomy/rail notes)                          | Search + category tabs + "Mes événements" featured cards w/"Booster" + "Les événements à venir" grid w/"Je me positionne" — matches `Events.tsx`. The Figma frame adds a right-rail cart-summary panel (Sous-total / campaign name / event line item) not present in `Events.tsx`. Category taxonomy differs: Figma shows Sport/Business/Culture/Ramadan; `Events.tsx` categorises ramadan/culture/concert/festival/conférence/exposition; the v3.0 simulator uses sports finales — three taxonomies (see §5, and `docs/handoff/`). |
| `/my-cart` (`CartPage.tsx`)                           | "Mon panier" (advertiser)                                                                                                                                                   | Structural match                                                  | "Récapitulatif" line items w/thumbnails + "Prêt à diffuser — Total TTC" + "Confirmer et jouer" + delete-confirmation modal + insufficient-balance state ("votre solde n'est pas suffisant" → "Recharger") + success modal — matches `CartPage`'s `handleConfirmAndLaunch` + balance check → `/my-recharges` redirect. The "Augmentez votre impact lors d'événements" upsell block isn't in `CartPage` (minor).                                                                                                                      |
| `/my-recharges` (`MyRecharges.tsx`)                   | part of the "Mes Finances" frame (dark balance card + quick-recharge tiles 1000/2500/5000/10000 + transactions table + "Recharger mon portefeuille" modal w/payment method) | Structural divergence (split)                                     | Figma presents one "Mes Finances" hub; code splits it into `/my-recharges` (wallet/recharges) + `/my-invoices`. The recharge tiles, payment-method picker, and "Rechargement wallet" designation match `MyRecharges`.                                                                                                                                                                                                                                                                                                               |
| `/my-invoices` (`MyInvoices.tsx`)                     | the "Suivi de factures" + "Facture" (full invoice document, "Total TTC") frames within "Mes Finances"                                                                       | Structural divergence (split) + designed invoice-detail not built | Same split note as `/my-recharges`. The Figma "Facture" frame is a full invoice-document detail view; `MyInvoices` lists invoices with a download-PDF action but has no in-app invoice-detail page.                                                                                                                                                                                                                                                                                                                                 |
| `/my-clients` (`MyClients.tsx`)                       | none; no "Mes clients" item in the Figma advertiser sidebar                                                                                                                 | Built not designed                                                | Agency-style client CRUD; absent from the Figma advertiser nav and screen set.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Screenhost

| Route                                                       | Figma frame                                                                                                                                | Classification                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/owner-dashboard` (`OwnerDashboard.tsx`)                   | "Dashboard" (screenhost)                                                                                                                   | Structural match                          | Revenue card + a campaign-brand card w/Catégorie/Zone, "Statut des outils de diffusion" (Capteur A/B + Screen 1/2/3 status badges), KPI tiles (Revenus cumulés / Campagnes diffusées / Impressions / Durée), "Mes campagnes" cards (Active/En cours/Refusée), "Mes événements" cards, an inline Notifications block w/Accepter–Refuser on a campaign request — matches `OwnerDashboard` (screens-in-maintenance cards, revenue stats, pending campaign approvals, `AddScreen` entry, "Points fidélité"). |
| `/owner-campaigns` (`OwnerCampaigns.tsx`)                   | "Mes campagnes" (screenhost)                                                                                                               | Structural match                          | Campaign-brand cards / table + a campaign-detail drawer w/video + accept ("Félicitations !") and refuse ("Êtes-vous sûr de vouloir refuser cette campagne ?") confirmation modals — matches `OwnerCampaigns`'s approve/reject via `campaignOwnerApprovalService`. The accept/refuse workflow is the screenhost-specific element vs the advertiser's read-only list.                                                                                                                                      |
| `/owner-campaign-approvals` (`OwnerCampaignApprovals.tsx`)  | none dedicated; the approval workflow is folded into the "Mes campagnes" (screenhost) frame and the OwnerDashboard notifications block     | Built not designed (as a separate page)   | `OwnerCampaignApprovals` (tabs En attente/Approuvées/Rejetées/Toutes) overlaps `OwnerCampaigns`; Figma designs only one campaigns surface — reinforces the §5 user-flows question of whether the two should merge.                                                                                                                                                                                                                                                                                       |
| `/owner-screens` (`OwnerScreens.tsx`)                       | partly the "ÉTAT DE MON DISPOSITIF" section of "Mon calendrier et mes dispositifs de diffusion"                                            | Different layout shape                    | Code has `/owner-screens` as a standalone list w/per-screen auto-accept toggle + status change + `AddScreen` modal; Figma folds device status into the calendar page and shows no auto-accept-toggle or add-screen UI — those are built-not-designed details.                                                                                                                                                                                                                                            |
| `/owner-locations` (`OwnerLocations.tsx`)                   | none                                                                                                                                       | Built not designed                        | Leaflet map of the screenhost's screens; not represented in the Figma screenhost set (which has a calendar+devices page instead).                                                                                                                                                                                                                                                                                                                                                                        |
| `/owner-calendar-devices` (`OwnerCalendarDevices.tsx`)      | "Mon calendrier et mes dispositifs de diffusion"                                                                                           | Structural match                          | Month calendar (Janvier 2026) w/days colour-coded Disponible/Indisponible + screen selector ("DISPONIBILITÉS DE MES ÉCRANS"), plus an "ÉTAT DE MON DISPOSITIF" device-status strip + "Contacter le support" — matches `OwnerCalendarDevices` (mark date ranges unavailable via `createUnavailabilityPeriod`/`updateScreen`). The device-status strip overlaps `/owner-screens`.                                                                                                                          |
| `/owner-performance` (`OwnerPerformance.tsx`)               | "Performances" (screenhost) + the long "Dashboard - MES PERFORMANCES MVP" frame                                                            | Structural match (+ an MVP merge variant) | The standalone "Performances" frame mirrors the advertiser `Perfor` layout with "Revenus ce mois" replacing "Dépenses ce mois" (period filters Par Campagne / Par Audience, 5 KPI tiles, audience-evolution area chart, "Vos performances globales" top-campagnes list, "Métriques détaillées", "Générer rapport global") — matches `OwnerPerformance`. The separate "MES PERFORMANCES MVP" frame inlines this whole section under the dashboard top — see §5.                                           |
| `/owner-revenue` (`OwnerRevenue.tsx`)                       | "Mes Revenus" (screenhost)                                                                                                                 | Structural match                          | Dark "0,000.00 TND" revenue card + "Demander un versement" + "Versements mensuels" table + a "Wallet & Paiements" view w/payment-method modal + a "Détails bancaires" modal (RIB upload) — matches `OwnerRevenue` (revenue stats, recharges/dépenses tabs, RIB bank-details form, "versement mensuel" section). The recharges/dépenses tab labels read advertiser-ish (already a §5 user-flows question).                                                                                                |
| `/owner-statements` (`OwnerStatementsPage.tsx`)             | implied by the "Versements mensuels" tables on the "Mes Revenus" frame; no dedicated list frame                                            | Structural match (partial)                | The list route ("Tous les relevés") has no dedicated Figma frame.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/owner-statements/:id` (`OwnerStatementDetailPage.tsx`)    | the "Relevé" document frame within "Mes Revenus"                                                                                           | Structural match                          | "Émetteur"/recipient block + line items + Total TTC + print/download — matches; recipient may render `DEMO_RECIPIENT` demo data (user-flows §6).                                                                                                                                                                                                                                                                                                                                                         |
| `/owner-activity` (`OwnerActivity.tsx`, 14-line stub)       | partly the "ÉTAT DE MON DISPOSITIF" device-status section                                                                                  | Designed (concept) not built              | Code is an empty `<h1>Activité</h1>`; the device-status strip (real-time Capteur/Screen states) is the most plausible intended content. Flag.                                                                                                                                                                                                                                                                                                                                                            |
| `/owner-maintenance` (`OwnerMaintenance.tsx`, 16-line stub) | none dedicated; closest is the "Défaillance détectée au niveau d'un capteur — Contacter le support" notification + the device-status strip | Designed-adjacent, not built              | Empty `<h1>Maintenance</h1>`; no maintenance screen designed beyond the failure-notification + "Contacter le support" affordance. Flag.                                                                                                                                                                                                                                                                                                                                                                  |
| `/owner-settings` (`OwnerSettings.tsx`)                     | "Settings" (screenhost)                                                                                                                    | Structural match                          | Tabbed editor (Responsable / Établissement / Notifications / Confidentialité et sécurité; sub-items Documents légaux / Mes coordonnées bancaires / Préférences / Modifier le mot de passe / Supprimer le compte) — matches `OwnerSettings`. Mirrors the advertiser "Settings" frame with "Établissement"/"Coordonnées bancaires" replacing "Entreprise"/"Documents légaux".                                                                                                                              |
| `/gift-catalog` (`GiftCatalogPage.tsx`)                     | none                                                                                                                                       | Built not designed                        | Hardcoded gift catalog + client-only redemption; no gifts screen in the export (only a "Points fidélité disponibles" card on the screenhost Dashboard frame).                                                                                                                                                                                                                                                                                                                                            |
| `/my-account` (`MyAccount.tsx`)                             | none dedicated (the only profile design is "Settings")                                                                                     | Built not designed                        | Second/third profile UI — a 4-step wizard (Responsable → Entreprise → Adresse → Validation); Figma designs one screenhost profile surface (the tabbed "Settings"). Reinforces the §5 "three overlapping profile pages" question.                                                                                                                                                                                                                                                                         |
| `/contact` (`ContactPage.tsx`, `<OwnerRoute>`)              | the "Support" modal in "Contacter le support" (screenhost) and in "Prendre rendez-vous avec un agent Toodooh + Contact" (advertiser)       | Different layout shape                    | Figma designs contact as a modal ("Support — Choisissez vos objectifs / Commentaires additionnels / Envoyer") launched from a sidebar "Support" item; code implements it as a full-page route under `<OwnerRoute>`. Modal-vs-page _and_ the route being owner-only (despite the `ContactPage` "BYPASS" comment) are both worth resolving.                                                                                                                                                                |
| _(no route — `/owner-events` does not exist)_               | "Mes événements" (screenhost)                                                                                                              | Designed not built                        | The screenhost events page (Mes événements / Mes événements passés grids, category tabs, "Diffusion à venir / passée" badges) is designed but has no route; screenhost events surface only as a section on `OwnerDashboard`. The advertiser `/evenements` is `<AdvertiserRoute>`, so screenhosts can't reach it.                                                                                                                                                                                         |

### Admin

| Routes                                                                                                                                                                                                                                                    | Figma frame         | Classification     | Notes                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| All `/admin-*` routes — `/admin-login`, `/admin-dashboard`, `/admin-create`, `/admin-management`, `/admin-users`, `/admin-screens`, `/admin-campaigns`, `/admin-recharges`, `/admin-events`, `/admin-videos`, `/admin-zones`, `/admin-global-config` (12) | none in this export | Built not designed | No admin design in the exported file. Either admin was designed elsewhere / later, or it ships design-less. See §6. |

## 3. Designed but not built

Each item is one Figma frame (or sub-frame) with no code counterpart. Priority calls (Phase 1 vs
post-launch) belong with the CEO/CTO — flagged in §6.

- **FAQ** — a "Foire Aux Questions" page: an accordion of questions under "Vous avez des questions sur
  Toodooh ? Nous avons les réponses." (placeholder Lorem Ipsum content), plus a "FAQ / Paramètres / Se
  déconnecter" entry in the user-avatar popup. No `/faq` route.
- **Prendre rendez-vous avec un agent Toodooh** — a booking modal: "Choisissez vos objectifs" select
  - a date-picker calendar (Janvier 2026) + "Aidez-nous à préparer l'entretien" textarea + "Prendre
    rendez-vous", triggered by the "Prendre rendez-vous" button in the dashboard top bar. Code has only
    the simpler "Support" contact form — no objectives-driven appointment booking, no calendar.
- **Notifications (mostly built — correction)** — the Figma "Notifications" frame is a bell-anchored
  **dropdown panel** (items with "Marquer comme lu" / contextual action buttons, footer "Gérer les
  notifications" / "Marquer tout comme lu"), not a full screen — and that dropdown _is_ built (the
  notification-bell component). The only not-built piece is the "Gérer les notifications" preferences
  target (notification prefs currently live as a tab inside Settings, not as their own screen).
- **Contacter le support (built, different shape — correction)** — the "Support" modal _is_ built, as
  the `/contact` route page (see §2). Listed here only to note that what looks like a missing screen
  is actually a present feature shaped as a page instead of a modal.
- **Dashboard - MES PERFORMANCES MVP** — a single long-scroll frame that inlines the entire
  Performances section (period filters, KPI tiles, audience-evolution chart, age/sex segmentation,
  top campagnes, "Métriques détaillées") underneath the screenhost dashboard top — i.e. a "for MVP,
  merge dashboard + performances into one page" alternative. Code implemented the separated version
  (`/owner-dashboard` + `/owner-performance`).
- **Template Email** — a transactional-email design (signup-verification mail: "Bonjour …, merci de
  vous être inscrit sur Toodooh … 'Valider mon inscription'", footer with social icons + a Tunis
  address). Not an app screen — the verification email is sent by Supabase (`emailRedirectTo`); the
  template is configured outside `apps/web`. Note: the email copy says the user must complete their
  "Profil Entreprise avec les documents demandés", while the code makes onboarding documents optional
  — a small spec/behaviour divergence.

## 4. Built but not designed

Routes/pages with no Figma frame in this export.

- `/my-clients` (advertiser) — agency client CRUD; not in the Figma advertiser nav or screen set.
- `/parcs` (advertiser) — 106-line hardcoded-Carrefour mock widget; the only "Parcs TV" in Figma is a
  campaign-targeting mode, not a standalone listing page.
- `/gift-catalog` (screenhost) — hardcoded gift items + client-only redemption; no gifts screen
  designed (only a "Points fidélité" card on the screenhost dashboard).
- `/owner-locations` (screenhost) — Leaflet map of screens; no map-of-my-screens frame (Figma has a
  calendar+devices page instead).
- `/owner-activity` (14-line stub) and `/owner-maintenance` (16-line stub) — no dedicated frames; the
  device-status strip on the calendar page is the only adjacent design.
- `/owner-campaign-approvals` (screenhost) — duplicate-ish of `/owner-campaigns`; Figma designs one
  campaigns surface.
- `/campaign-details/:id` (advertiser) — built as a standalone route; Figma designs campaign detail as
  an in-page drawer over the campaigns list.
- `/my-account` (screenhost) — a second/third profile UI; Figma designs one profile surface (the
  tabbed Settings).
- `Onboarding.tsx` modal — the post-login optional-documents upload modal; no Figma frame (the signup
  "Documents légaux" / "Coordonnées bancaires" step covers document upload at signup, not the
  post-login modal).
- All `/admin-*` routes (12) — no admin design in this export.

## 5. Structural patterns to surface

- **Figma single-screen ↔ code multi-page (recurring).** "Mes Finances" (one hub) → `/my-recharges` +
  `/my-invoices`. "Mes Revenus" bundles statements that code splits into `/owner-revenue` +
  `/owner-statements` (+ `/owner-statements/:id`). The campaigns surface is one Figma screen but
  `/owner-campaigns` + `/owner-campaign-approvals` in code. Device status is one section in Figma but
  spans `/owner-screens` + `/owner-calendar-devices` + `/owner-activity` in code.
- **Auth designed as separate screens, built as shared components.** Two visually identical login
  frames ("Login" + "Login Screenhost") → one `LoginForm`. Two "Inscription" frames → one `SignUpForm`
  with per-profile step sets. The code's sharing is the right call; the design just duplicated.
- **MVP variant pattern.** The file carries scoped "MVP" alternatives in place — most clearly the
  "Dashboard - MES PERFORMANCES MVP" frame sitting next to the regular "Dashboard" + "Performances"
  frames. Reading the file requires knowing which variant is canonical.
- **Admin design absent.** ~12 `/admin-*` routes, zero admin frames in the export.
- **Modal/drawer in Figma ↔ full page in code (one-directional).** Figma designs Support/contact and
  campaign detail as a modal/drawer; code routes them as full pages (`/contact`, `/campaign-details/:id`).
  The reverse never appears — code never collapses a designed full page into a modal.
- **Detail-drawer-over-list pattern.** Both "Mes campagnes" frames (advertiser + screenhost) show a
  detail drawer sliding over the list; code splits list and detail into separate routes — a recurring
  shape mismatch.
- **Screenhost nav labels inconsistent within Figma.** Some screenhost frames show "Parcs TV" /
  "Mes finances" (advertiser labels); others show "Mon calendrier…" / "Mes revenus". The screenhost
  navigation wasn't fully reconciled in the design.
- **Cross-sell rails.** Figma puts a cart-summary rail on the Events page and an event-upsell block on
  the Cart page; code keeps these pages separate without the cross rails.
- **Event taxonomy drift.** Figma event categories (Sport / Business / Culture / Ramadan) vs code's
  (ramadan / culture / concert / festival / conférence / exposition) vs the v3.0 simulator's sports
  finales — three taxonomies in circulation (`docs/handoff/pricing-model-v3.md`).

## 6. Open questions for CEO/CTO

- **Consolidate "Mes Finances"?** Figma has one hub; code has `/my-recharges` + `/my-invoices`. Merge
  to match the design, or keep split? Same question for the screenhost "Mes Revenus" vs `/owner-revenue`
  - `/owner-statements`.
- **FAQ and the agent-booking-with-calendar flow** — Phase 1 scope, or post-launch?
- **Notifications** — confirm the dropdown is the intended pattern (it is, in Figma) and decide whether
  a "Gérer les notifications" preferences screen ships separately or stays a Settings tab.
- **"Dashboard - MES PERFORMANCES MVP"** — is the merged single-scroll dashboard the MVP target, or an
  exploration the team moved away from? If it's the target, `/owner-performance` should fold into
  `/owner-dashboard`.
- **Where is the admin design?** Separate Figma file, or does admin UI ship design-less?
- **Stub pages `/owner-activity`, `/owner-maintenance`** — do designs exist (the device-status strip is
  the only candidate in this export), or should these routes be removed?
- **Consolidation targets** — `/owner-campaigns` vs `/owner-campaign-approvals`, and the three profile
  pages (`UserProfile` / `OwnerSettings` / `MyAccount`): Figma designs one of each. Confirm the target
  (overlaps `docs/user-flows.md` §5 and `docs/audit.md` §3 / Step 5).
- **Screenhost events** — the "Mes événements" screenhost page is designed but has no route. Build it,
  or are screenhost events permanently just a dashboard section?
- **`/contact` scope** — the route is `<OwnerRoute>` (screenhost-only) yet the Support modal appears on
  advertiser dashboards in the design. Should it be global?

## 7. Follow-up work

- **Per-screen re-export at full resolution.** When a screen reaches implementation (likely Step 5
  onward), re-export _that_ frame on its own at full size — the composites here are downscaled
  multi-frame boards, fine for structure, useless for spacing/typography/exact components.
- **Or fix Figma MCP access properly.** The blocker is that the authed account can't open the file and
  the plan caps Dev-Mode MCP calls. Getting dev access on the right account would let `get_design_context`
  pull real per-node component/token data.
- **Per-screen pixel diff** (Figma frame vs running app) as part of each screen's implementation ticket
  — not a batch exercise.
