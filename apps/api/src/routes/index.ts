import type { FastifyPluginAsync } from 'fastify';

import { signupRoute } from './signup.js';

// Aggregates all application-shaped /api/* routes. Future routes
// (/api/onboarding, /api/admin/users) register here.
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(signupRoute);
};
