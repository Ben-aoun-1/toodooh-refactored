import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { campaigns, creatives } from '../db/schema.js';
import {
  agentOffer,
  agentPendingOffers,
  noticeAgentAnswered,
  offerAnsweredBy,
  offerState,
} from '../lib/agent-offers.js';
import { afterClassicDecision } from '../lib/allocation-decision-effects.js';
import { OFFER_ALREADY_ANSWERED, decideAllocation } from '../lib/allocation-decision.js';
import { airedCreativeTypeSql, airedStorageKeySql } from '../lib/spot-cta.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

import { agentCgeGate } from './agent-account.js';

// Agent Screenhost spec VF §10 (Mariem 12/11/2026) — the Screenhost agent reads and answers the
// campaign offers of his affiliated venues:
//
//   GET  /api/agent/offers                    the offers still waiting
//   GET  /api/agent/offers/:id                one offer, in any state (the offer window)
//   GET  /api/agent/offers/:id/creative-url   the spot, short-TTL presigned
//   POST /api/agent/offers/:id/accept|refuse  answer for the Host
//
// The answer runs the Host's own transaction (lib/allocation-decision.ts) with the agent as its
// author: the first answer decides, a second one is a 409 « Cette offre a déjà reçu une réponse ».
// Every read and write is scoped to the agent's LIVE affiliations; a foreign id is a 404.

const guard = { preHandler: [requireAuth, requireRole('screenhost_agent'), agentCgeGate] };
const idParam = z.object({ id: z.uuid() });

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ error: 'NOT_FOUND', message: 'Offre introuvable.' });

export const agentOfferRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/agent/offers', guard, async (request, reply) =>
    reply.status(200).send({ offers: await agentPendingOffers(request.user?.id ?? '') }),
  );

  app.get('/api/agent/offers/:id', guard, async (request, reply) => {
    const parsed = idParam.safeParse(request.params);
    if (!parsed.success) return notFound(reply);
    const found = await agentOffer(request.user?.id ?? '', parsed.data.id);
    if (!found) return notFound(reply);
    return reply.status(200).send(found.offer);
  });

  app.get('/api/agent/offers/:id/creative-url', guard, async (request, reply) => {
    const parsed = idParam.safeParse(request.params);
    if (!parsed.success) return notFound(reply);
    const found = await agentOffer(request.user?.id ?? '', parsed.data.id);
    if (!found) return notFound(reply);
    const { offer } = found;
    // The same spot the Host previews (QR-CTA1/2: what airs, or the photo itself for a photo).
    const [row] = await db
      .select({
        storageKey: airedStorageKeySql(),
        airedType: airedCreativeTypeSql(),
        creativeKey: creatives.storageKey,
        creativeType: creatives.creativeType,
      })
      .from(campaigns)
      .innerJoin(creatives, eq(creatives.id, campaigns.creativeId))
      .where(eq(campaigns.id, offer.campaign_id))
      .limit(1);
    if (!row) return notFound(reply);
    const key = row.airedType === row.creativeType ? row.storageKey : row.creativeKey;
    const result = await storage.getPresignedUrl({ key, expiresInSeconds: 300 });
    if ('error' in result) {
      return reply
        .status(502)
        .send({ error: 'STORAGE_ERROR', message: 'Le spot est indisponible. Réessayez.' });
    }
    return reply.status(200).send({ url: result.url });
  });

  const decide = async (
    request: FastifyRequest,
    reply: FastifyReply,
    statut: 'ACCEPTE' | 'REFUSE',
  ) => {
    const parsed = idParam.safeParse(request.params);
    const agentUserId = request.user?.id;
    if (!parsed.success || !agentUserId) return notFound(reply);
    const found = await agentOffer(agentUserId, parsed.data.id);
    if (!found || found.ownerId === null) return notFound(reply);
    const { offer, ownerId } = found;
    if (offer.state === 'attente' && !offer.decidable) {
      return reply.status(409).send({
        error: 'OFFER_CLOSED',
        message: 'Cette offre n’est plus d’actualité.',
      });
    }
    const outcome = await decideAllocation({
      allocationId: offer.id,
      ownerId,
      statut,
      actor: { kind: 'agent', userId: agentUserId },
    });
    if (outcome.kind === 'not_found') return notFound(reply);
    if (outcome.kind !== 'ok') {
      return reply.status(409).send({ error: 'ALREADY_ANSWERED', message: OFFER_ALREADY_ANSWERED });
    }
    await afterClassicDecision(outcome.screenhostId, statut, outcome.changed, request.log);
    if (outcome.changed) {
      await noticeAgentAnswered({
        agentUserId,
        ownerId,
        offer,
        accepted: statut === 'ACCEPTE',
      });
      request.log.info(
        { agentUserId, allocationId: offer.id, statut, screenhostId: outcome.screenhostId },
        'agent answered an offer on behalf of the host',
      );
    }
    return reply.status(200).send({
      id: offer.id,
      state: offerState(statut),
      answered_by: offerAnsweredBy(statut, 'agent', agentUserId, agentUserId),
      changed: outcome.changed,
    });
  };

  app.post('/api/agent/offers/:id/accept', guard, (request, reply) =>
    decide(request, reply, 'ACCEPTE'),
  );
  app.post('/api/agent/offers/:id/refuse', guard, (request, reply) =>
    decide(request, reply, 'REFUSE'),
  );
};
