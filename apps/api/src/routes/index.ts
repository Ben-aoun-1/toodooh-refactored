import type { FastifyPluginAsync } from 'fastify';

import { adminAccountsRoutes } from './admin-accounts.js';
import { adminRoutes } from './admin.js';
import { agentRoutes } from './agent.js';
import { emailAvailabilityRoute } from './email-availability.js';
import { meRoutes } from './me.js';
import { passwordRoutes } from './password.js';
import { predefinedZonesRoutes } from './predefined-zones.js';
import { profileDocumentsRoutes } from './profile-documents.js';
import { profileRoutes } from './profile.js';
import { referenceRoutes } from './reference.js';
import { signinRoutes } from './signin.js';
import { signupRoute } from './signup.js';

// Aggregates all application-shaped /api/* routes. Future routes
// (/api/admin/users) register here.
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(signupRoute);
  // Public, rate-limited signup-wizard email pre-check (QA-fix lane) — the limiter is
  // registered inside the plugin, so it scopes to that route only.
  await app.register(emailAvailabilityRoute);
  await app.register(signinRoutes);
  await app.register(meRoutes);
  await app.register(profileRoutes);
  await app.register(profileDocumentsRoutes);
  await app.register(passwordRoutes);
  await app.register(adminRoutes);
  // Superadmin-only internal-account creation (staff admins + agents) — slice-2 A.
  await app.register(adminAccountsRoutes);
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
