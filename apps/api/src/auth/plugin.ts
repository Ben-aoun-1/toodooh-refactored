import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsync } from 'fastify';

import { auth } from './auth.js';

// better-auth ships no first-party Fastify plugin — the documented Fastify
// integration is a catch-all route that bridges the Fastify request to a Web
// Request and delegates to auth.handler. This plugin encapsulates that.
export const authPlugin: FastifyPluginAsync = async (app) => {
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      // /api/signup is the only validated signup path (Commit 3 Q3); block the
      // raw endpoint. Privilege is already safe via input:false — this guards
      // format/data integrity. Other /auth/* routes pass through.
      if (request.method === 'POST' && url.pathname === '/auth/sign-up/email') {
        return reply.status(404).send({ error: 'Not Found', message: 'Use POST /api/signup' });
      }
      const req = new Request(url.toString(), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        void reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });
};
