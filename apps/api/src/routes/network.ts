import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { excludeVenues, reintegrateVenues } from '../lib/caster-exclusions.js';
import { networkFor, networkVenueIds, parksFor } from '../lib/network.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// Mariem 17/11/2026 — « Réseau Screenhosts » and « Parcs TV » of a Screencaster:
//   GET    /api/network                       his network, venue by venue, exclusions flagged
//   POST   /api/network/exclusions            « Ne plus diffuser dans ces établissements »
//   DELETE /api/network/exclusions/:id        « Réintégrer »
//   GET    /api/network/parks                 the parks (one brand, several locations)
// The list applies to him alone and to the campaigns he has not validated yet; the engine side
// is lib/caster-exclusions.ts. A park is an owner with two venues or more in the network
// (lib/network.ts parksFor — no table); with none the page says « Bientôt disponible ».
// Excluding a park is excluding each of its locations through the same POST.

const advertiserGuard = { preHandler: [requireAuth, requireRole('advertiser')] };

const MAX_PER_CALL = 500;
const exclusionsBody = z.object({
  screenhost_ids: z.array(z.string().uuid()).min(1).max(MAX_PER_CALL),
});
const idParam = z.object({ id: z.string().uuid() });

export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/network', advertiserGuard, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
    return reply.status(200).send(await networkFor(request.user.id));
  });

  app.get('/api/network/parks', advertiserGuard, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
    return reply.status(200).send({ parks: await parksFor(request.user.id) });
  });

  app.post('/api/network/exclusions', advertiserGuard, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
    const parsed = exclusionsBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Sélection invalide.',
        statusCode: 400,
        requestId: request.id,
      });
    }
    // Only venues of HIS network can be excluded (an unknown or hidden id is ignored).
    const ids = await networkVenueIds(request.user.id, parsed.data.screenhost_ids);
    const excluded = await excludeVenues(request.user.id, ids);
    return reply.status(200).send({ excluded_ids: excluded });
  });

  app.delete('/api/network/exclusions/:id', advertiserGuard, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'UNAUTHORIZED' });
    const parsed = idParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Établissement invalide.',
        statusCode: 400,
        requestId: request.id,
      });
    }
    await reintegrateVenues(request.user.id, [parsed.data.id]);
    return reply.status(200).send({ reintegrated: true });
  });
};
