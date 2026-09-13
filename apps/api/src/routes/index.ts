import type { FastifyPluginAsync } from 'fastify';

import { env } from '../env.js';

import { adminAccountsRoutes } from './admin-accounts.js';
import { adminCampaignsRoutes } from './admin-campaigns.js';
import { adminCreativesRoutes } from './admin-creatives.js';
import { adminDispatchConfigRoutes } from './admin-dispatch-config.js';
import { adminEngineJournalRoutes } from './admin-engine-journal.js';
import { adminEventsRoutes } from './admin-events.js';
import { adminFacturesRoutes } from './admin-factures.js';
import { adminPlatformStatsRoutes } from './admin-platform-stats.js';
import { adminRechargesRoutes } from './admin-recharges.js';
import { adminReconcileRoutes } from './admin-reconcile.js';
import { adminScreenhostsRoutes } from './admin-screenhosts.js';
import { adminSimulationsRoutes } from './admin-simulations.js';
import { adminSupportRoutes } from './admin-support.js';
import { adminTestingRoutes } from './admin-testing.js';
import { adminWalletRoutes } from './admin-wallet.js';
import { adminRoutes } from './admin.js';
import { advertiserPerformancesRoutes } from './advertiser-performances.js';
import { agentCodeAvailabilityRoute } from './agent-code-availability.js';
import { agentRoutes } from './agent.js';
import { campaignBoostRoutes } from './campaign-boost.js';
import { campaignDispatchRoutes } from './campaign-dispatch.js';
import { campaignTargetingRoutes } from './campaign-targeting.js';
import { campaignsPricingRoutes } from './campaigns-pricing.js';
import { campaignsRoutes } from './campaigns.js';
import { cartRoutes } from './cart.js';
import { creativesRoutes } from './creatives.js';
import { deviceAuthRoutes } from './device-auth.js';
import { emailAvailabilityRoute } from './email-availability.js';
import { eventBoostRoutes } from './event-boost.js';
import { eventsRoutes } from './events.js';
import { internalRoutes } from './internal.js';
import { meRoutes } from './me.js';
import { notificationsRoutes } from './notifications.js';
import { ownerStatementsRoutes } from './owner-statements.js';
import { passwordRoutes } from './password.js';
import { predefinedZonesRoutes } from './predefined-zones.js';
import { profileDocumentsRoutes } from './profile-documents.js';
import { profileRoutes } from './profile.js';
import { rechargesRoutes } from './recharges.js';
import { referenceRoutes } from './reference.js';
import { screenhostsRoutes } from './screenhosts.js';
import { screensRoutes } from './screens.js';
import { signinRoutes } from './signin.js';
import { signupRoute } from './signup.js';
import { supportRoutes } from './support.js';
import { taxAvailabilityRoute } from './tax-availability.js';
import { walletDocumentsRoutes } from './wallet-documents.js';
import { zonesRoutes } from './zones.js';

// Aggregates all application-shaped /api/* routes. Future routes
// (/api/admin/users) register here.
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(signupRoute);
  // Public, rate-limited signup-wizard email pre-check (QA-fix lane) — the limiter is
  // registered inside the plugin, so it scopes to that route only.
  await app.register(emailAvailabilityRoute);
  await app.register(agentCodeAvailabilityRoute);
  // Public, rate-limited signup-wizard matricule-fiscal pre-check (Kais QA3) — same
  // encapsulated-limiter pattern; lets the wizard surface a duplicate tax number before the
  // last step instead of as a transient toast at submit.
  await app.register(taxAvailabilityRoute);
  await app.register(signinRoutes);
  // MAP M1 — TV-app opaque-token auth, namespaced /api/device/auth/* (better-auth owns /api/auth).
  await app.register(deviceAuthRoutes);
  // MAP M1 — device-bearer screen list + pair/GPS-link.
  await app.register(screensRoutes);
  // Owner + admin WiFi maintenance for screenhosts (SSID/password) — every edit re-pushes the
  // owner's approved screenhosts to wedooh (S-T1 Edge B2) so the hub's credentials stay current.
  await app.register(screenhostsRoutes);
  await app.register(meRoutes);
  // In-app notification feed (session-user-scoped): GET /api/notifications + POST /:id/read.
  // Producers (e.g. the dispatch producer) write rows; the FE bell reads + marks them read.
  await app.register(notificationsRoutes);
  // C1 — advertiser campaign draft lifecycle (greenfield): create/list/get/edit/submit/delete,
  // owner-scoped to the authenticated advertiser. Targeting/video/map/pricing land in later lanes.
  await app.register(campaignsRoutes);
  await app.register(cartRoutes);
  // Advertiser-readable CPM read: GET /api/campaigns/pricing-config — the wizard's Validation step
  // prices its budget→impressions estimate from the same resolved dispatch-config the admin edits.
  await app.register(campaignsPricingRoutes);
  // L-spot — advertiser creative library (greenfield): upload (video|photo) + owner-scoped reads.
  // MinIO storage-first/no-orphan; admin moderation lives in admin-creatives.
  await app.register(creativesRoutes);
  // EV1 — the sport-event catalogue: official reads + the shared suggestion list + « Suggérer un
  // match ». Positioning (EV3) and pricing (EV2) are NOT here.
  await app.register(eventsRoutes);
  // L-target — campaign audience targeting (category × class lines, ALL=toutes); owner-scoped to the
  // campaign's advertiser, replace-set write, draft-only. Dedup + category validation server-side.
  await app.register(campaignTargetingRoutes);
  await app.register(campaignBoostRoutes);
  // EV6 — the event booster (zones-only) sits beside the campaign one, never inside it.
  await app.register(eventBoostRoutes);
  // L-disp — admin/internal dispatch entrypoint: builds + freezes the PlanDiffusion (A.7).
  await app.register(campaignDispatchRoutes);
  // L-wallet — advertiser wallet surface: POST recharge (manual bank-transfer top-up → pending +
  // facture reference), GET own recharges, GET /api/wallet/balance (derived from confirmed recharges).
  await app.register(rechargesRoutes);
  // FCT2 — the screencaster's money documents: monthly consolidated invoices (list + stored PDF)
  // + the wallet-adjustment history (the third ledger row type).
  await app.register(walletDocumentsRoutes);
  // SC-P — the screencaster's « Mes performances » reads (closed campaigns, live counters,
  // footprint, analysis sections 01–04, per-campaign report PDF).
  await app.register(advertiserPerformancesRoutes);
  // FCT2 — the owner's « Relevés de reversement »: monthly per-venue statements (list + stored PDF).
  await app.register(ownerStatementsRoutes);
  await app.register(profileRoutes);
  await app.register(profileDocumentsRoutes);
  await app.register(passwordRoutes);
  await app.register(adminRoutes);
  // L-spot — admin creative content-moderation (approve/reject + audit trio); the bifurcated
  // content gate. A campaign's content_validation_status is derived from its linked creative.
  await app.register(adminCreativesRoutes);
  // L-wallet — admin recharge moderation: the manual-payment queue + confirm (credits the balance,
  // idempotent) / reject (with a reason). The money-confirmation step of the offline top-up flow.
  await app.register(adminFacturesRoutes);
  // SUP-1 — le support enfin enregistré : POST /api/support (tout rôle) + la file admin.
  await app.register(supportRoutes);
  await app.register(adminSupportRoutes);
  await app.register(adminRechargesRoutes);
  // FCT2 — the admin wallet adjustment (signed, audited, reason-required) + its audit trail.
  await app.register(adminWalletRoutes);
  // ACTIVATION WIRING — admin campaign moderation: the review queue + activate (gate on pending +
  // approved creative + funded, then dispatch → status='active') / reject. The keystone that lets
  // the dispatch → playout → proof-of-play chain run end-to-end.
  await app.register(adminCampaignsRoutes);
  // CPM CONFIG — admin-editable dispatch CPM (standard/event TND-per-1000). The activation
  // derivation reads it to compute I_cible = ⌊budget·1000/cpm⌋; editable without a migration.
  await app.register(adminDispatchConfigRoutes);
  // ADMIN DASHBOARD STATS — headline platform numbers derived from the new-engine tables
  // (de-Supabase of the dead platform-stats RPCs). Read-only aggregation.
  await app.register(adminPlatformStatsRoutes);
  // ADM-SCR1 — the admin venue listing (« Localités et écrans »), off the new-engine tables.
  await app.register(adminScreenhostsRoutes);
  await app.register(adminTestingRoutes);
  // SIM-0 — the admin « Simulateur » registry (sandbox databases + context-routed engines).
  await app.register(adminSimulationsRoutes, {
    enabled: env.SIMULATOR_ENABLED,
    maxSandboxes: env.SIMULATOR_MAX_SANDBOXES,
  });
  // L-redisp — admin reconciliation: value plan-promised vs proof-aired at clôture, settle the
  // screencaster wallet (the spend) + record screenhost earnings. Idempotent per campaign.
  await app.register(adminReconcileRoutes);
  await app.register(adminEngineJournalRoutes);
  // EV1 — admin event management (§10 field set, type locked Sport, annuler, affiche upload).
  await app.register(adminEventsRoutes);
  // Superadmin-only internal-account creation (staff admins + agents) — slice-2 A.
  await app.register(adminAccountsRoutes);
  // S-T1 — service-authenticated toodooh↔wedooh sync surface (/api/internal/*): B1 locations read,
  // C1 affluence ingest, Edge A agent provisioning. Guarded by WEDOOH_SYNC_KEY; 503 when unset.
  await app.register(internalRoutes);
  // (CF-19 P0) agent establishment-write routes removed — agents do NOT create places. The
  // screenhosts table (replaces establishments) is scaffolding only — no write path, read
  // endpoint, or signup capture yet (P2/P3).
  // (P2) Read-only agent dashboard: GET /api/agent/clients — an agent's referred clients only.
  await app.register(agentRoutes);
  // Zones cutover (Z1): public GET catalog + admin-guarded scalar writes.
  await app.register(predefinedZonesRoutes);
  // CF-Z1 — the NEW zones read (wizard); distinct from the legacy predefined_zones CRUD above.
  await app.register(zonesRoutes);
  // Public reference-data reads (no auth) — register last; they add no preHandler.
  await app.register(referenceRoutes);
};
