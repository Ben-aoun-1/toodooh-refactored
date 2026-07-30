import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import {
  type EventBoostRefusal,
  applyEventBoost,
  previewEventBoost,
} from '../lib/event-dispatch/boost.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

// EV6 (flow §7) — the event booster's HTTP shell: preview (nothing persists) then apply (one
// atomic transaction). Owner-scoped like every advertiser route — a foreign positioning is an
// indistinguishable 404. ZONES ONLY: the body carries no spot, no category and no date, because
// the match owns those axes (the surface never offers them either).

const idParamSchema = z.object({ id: z.uuid() });
const previewBodySchema = z.object({ added_zone_ids: z.array(z.uuid()).min(1).max(50) });
const applyBodySchema = previewBodySchema.extend({
  amount_tnd: z.number().positive().max(100_000_000),
});

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation échouée', fields: [{ field, reason }] });

/** The refusal → HTTP mapping, French. 404/409 for identity/state; 400 for a refused ask. */
const sendRefusal = (reply: FastifyReply, refusal: EventBoostRefusal) => {
  switch (refusal.status) {
    case 'NOT_FOUND':
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Positionnement introuvable.' });
    case 'NOT_POSITIONING':
      return reply.status(409).send({
        error: 'NOT_POSITIONING',
        message: 'Cette campagne n’est pas un positionnement événementiel.',
        statusCode: 409,
      });
    case 'NOT_BOOSTABLE':
      return reply.status(409).send({
        error: 'NOT_BOOSTABLE',
        message: 'Seul un positionnement à venir ou actif peut être boosté.',
        current_status: refusal.currentStatus,
        statusCode: 409,
      });
    case 'EVENT_ANNULE':
      return reply.status(409).send({
        error: 'EVENT_ANNULE',
        message: 'Cet événement est annulé — le positionnement ne peut plus être boosté.',
        statusCode: 409,
      });
    case 'NO_ADDITION':
      return reply.status(400).send({
        error: 'NO_ADDITION',
        message: 'Ajoutez au moins une nouvelle zone pour booster ce positionnement.',
      });
    case 'ZONE_NOT_FOUND':
      return reply.status(400).send({
        error: 'ZONE_NOT_FOUND',
        message: 'Une des zones sélectionnées n’est pas active.',
        zone_id: refusal.zoneId,
      });
    case 'ZONE_ALREADY_TARGETED':
      return reply.status(400).send({
        error: 'ZONE_ALREADY_TARGETED',
        message: 'Cette zone est déjà couverte par le positionnement.',
        zone_id: refusal.zoneId,
      });
    case 'BUDGET_BELOW_MINIMUM':
      return reply.status(400).send({
        error: 'BUDGET_BELOW_MINIMUM',
        message: `Le budget complémentaire doit être d’au moins ${refusal.floorTnd} TND.`,
        minimum_tnd: refusal.floorTnd,
      });
    case 'BUDGET_EXCEEDS_CMAX':
      return reply.status(400).send({
        error: 'BUDGET_EXCEEDS_CMAX',
        message: 'Le budget complémentaire dépasse l’inventaire encore disponible.',
        c_max_evt_tnd: refusal.cMaxEvtTnd,
      });
    case 'INSUFFICIENT_BALANCE':
      return reply.status(400).send({
        error: 'INSUFFICIENT_BALANCE',
        message: 'Solde insuffisant pour ce boost.',
        required_tnd: refusal.requiredTnd,
        available_tnd: refusal.availableTnd,
      });
    case 'NO_ELIGIBLE':
      return reply.status(400).send({
        error: 'NO_ELIGIBLE',
        message: 'Aucun établissement éligible dans les zones ajoutées sur cette fenêtre.',
      });
    case 'NMAX_EXCEEDED':
      return reply.status(400).send({
        error: 'EVENT_NMAX_EXCEEDED',
        message: `Le budget complémentaire dépasse la limite de concentration (N_max = ${refusal.nMax} établissement${refusal.nMax > 1 ? 's' : ''}).`,
        n_max: refusal.nMax,
      });
  }
};

export const eventBoostRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // POST /api/campaigns/:id/event-boost/preview {added_zone_ids} — the complementary ceiling over
  // the hypothetical merged zone set + how many venues the added zones actually bring. Persists
  // NOTHING (the CF-B1 preview posture, without its rollback sentinel: this read never dispatches).
  app.post('/api/campaigns/:id/event-boost/preview', advertiserGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const body = previewBodySchema.safeParse(request.body ?? {});
    if (!body.success) return invalidField(reply, 'added_zone_ids', 'at least one zone id');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const result = await previewEventBoost(params.data.id, userId, body.data.added_zone_ids);
    if (result.status !== 'PREVIEW') return sendRefusal(reply, result);
    return reply.status(200).send({
      c_max_evt_tnd: result.cMaxEvtTnd,
      eligible_count: result.eligibleCount,
    });
  });

  // POST /api/campaigns/:id/event-boost {added_zone_ids, amount_tnd} — the atomic apply.
  app.post('/api/campaigns/:id/event-boost', advertiserGuard, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return invalidField(reply, 'id', 'must be a uuid');
    const body = applyBodySchema.safeParse(request.body ?? {});
    if (!body.success) return invalidField(reply, 'amount_tnd', 'a positive amount is required');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const result = await applyEventBoost(params.data.id, userId, {
      addedZoneIds: body.data.added_zone_ids,
      amountTnd: body.data.amount_tnd,
    });
    if (result.status !== 'APPLIED') return sendRefusal(reply, result);
    return reply.status(200).send({
      boost_id: result.boostId,
      amount_tnd: result.amountTnd,
      placed_venues: result.placedVenues,
      placed_impressions: result.placedImpressions,
      partial: result.partial,
    });
  });
};
