import type { FastifyPluginAsync } from 'fastify';

import { adminAccountsRoutes } from './admin-accounts.js';
import { adminCreativesRoutes } from './admin-creatives.js';
import { adminRoutes } from './admin.js';
import { agentRoutes } from './agent.js';
import { campaignsRoutes } from './campaigns.js';
import { creativesRoutes } from './creatives.js';
import { deviceAuthRoutes } from './device-auth.js';
import { emailAvailabilityRoute } from './email-availability.js';
import { internalRoutes } from './internal.js';
import { meRoutes } from './me.js';
import { passwordRoutes } from './password.js';
import { predefinedZonesRoutes } from './predefined-zones.js';
import { profileDocumentsRoutes } from './profile-documents.js';
import { profileRoutes } from './profile.js';
import { referenceRoutes } from './reference.js';
import { screenhostsRoutes } from './screenhosts.js';
import { screensRoutes } from './screens.js';
import { signinRoutes } from './signin.js';
import { signupRoute } from './signup.js';
import { taxAvailabilityRoute } from './tax-availability.js';

// Aggregates all application-shaped /api/* routes. Future routes
// (/api/admin/users) register here.
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(signupRoute);
  // Public, rate-limited signup-wizard email pre-check (QA-fix lane) — the limiter is
  // registered inside the plugin, so it scopes to that route only.
  await app.register(emailAvailabilityRoute);
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
  // C1 — advertiser campaign draft lifecycle (greenfield): create/list/get/edit/submit/delete,
  // owner-scoped to the authenticated advertiser. Targeting/video/map/pricing land in later lanes.
  await app.register(campaignsRoutes);
  // L-spot — advertiser creative library (greenfield): upload (video|photo) + owner-scoped reads.
  // MinIO storage-first/no-orphan; admin moderation lives in admin-creatives.
  await app.register(creativesRoutes);
  await app.register(profileRoutes);
  await app.register(profileDocumentsRoutes);
  await app.register(passwordRoutes);
  await app.register(adminRoutes);
  // L-spot — admin creative content-moderation (approve/reject + audit trio); the bifurcated
  // content gate. A campaign's content_validation_status is derived from its linked creative.
  await app.register(adminCreativesRoutes);
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
  // Public reference-data reads (no auth) — register last; they add no preHandler.
  await app.register(referenceRoutes);
};
