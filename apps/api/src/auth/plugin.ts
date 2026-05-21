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
