import type { FastifyPluginAsync } from 'fastify';

import { profileDocumentsRoutes } from './profile-documents.js';
import { profileRoutes } from './profile.js';
import { signupRoute } from './signup.js';

// Aggregates all application-shaped /api/* routes. Future routes
// (/api/admin/users) register here.
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(signupRoute);
  await app.register(profileRoutes);
  await app.register(profileDocumentsRoutes);
};
