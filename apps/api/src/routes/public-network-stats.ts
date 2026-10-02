import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { clientIp } from '../lib/client-ip.js';
import { publicNetworkStats } from '../lib/public-network-stats.js';

// NEWLANDING-1 (ruling 1A) — GET /api/public/network-stats: the landing's live « Smart Sensor »
// counters. Public and unauthenticated by design; network-wide aggregates only
// (lib/public-network-stats). Rate-limited per visitor; the figure itself is cached 60 s.

const MAX_PER_MINUTE = 30;

export const publicNetworkStatsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: MAX_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Trop de requêtes. Réessayez dans une minute.',
    }),
  });

  app.get('/api/public/network-stats', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.status(200).send(await publicNetworkStats());
  });
};
