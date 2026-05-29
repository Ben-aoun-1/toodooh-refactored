import type { FastifyPluginAsync } from 'fastify';

import { adminRoutes } from './admin.js';
import { meRoutes } from './me.js';
import { passwordRoutes } from './password.js';
import { profileDocumentsRoutes } from './profile-documents.js';
import { profileRoutes } from './profile.js';
import { referenceRoutes } from './reference.js';
import { signinRoutes } from './signin.js';
import { signupRoute } from './signup.js';

// Aggregates all application-shaped /api/* routes. Future routes
// (/api/admin/users) register here.
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(signupRoute);
  await app.register(signinRoutes);
  await app.register(meRoutes);
  await app.register(profileRoutes);
  await app.register(profileDocumentsRoutes);
  await app.register(passwordRoutes);
  await app.register(adminRoutes);
  // Public reference-data reads (no auth) — register last; they add no preHandler.
  await app.register(referenceRoutes);
};
