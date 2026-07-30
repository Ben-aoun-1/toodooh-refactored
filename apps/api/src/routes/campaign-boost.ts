import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { type BoostRefusal, runBoost } from '../lib/boost.js';
import { createEngineTrace } from '../lib/engine-journal/trace.js';
import { pushPlaylistToCampaignVenues } from '../lib/playout/push.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

// CF-B1 (spec §3.3) — the Booster endpoints. TWO RULED DEVIATIONS from the spec's letter (both
// operator-ratified, surfaced in the lane's PR): the boost applies DIRECTLY (not via the panier)
// and rides a DEDICATED surface (not the wizard in extension mode). Owner-scoped; active|upcoming
// only; strictly additive — the engine (lib/boost) enforces every rule and rolls back whole.

const idParamSchema = z.object({ id: z.uuid() });
const additionsSchema = z.object({
  new_end_date: z.iso.date().optional(),
  added_zone_ids: z.array(z.uuid()).max(50).optional(),
  added_category_ids: z.array(z.uuid()).max(50).optional(),
});
const applySchema = additionsSchema.extend({ amount_tnd: z.number().positive() });

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

// One refusal → HTTP mapping for both endpoints (the machine reason IS the error code).
const sendRefusal = (reply: FastifyReply, refusal: BoostRefusal) => {
  if (refusal.status === 'NOT_FOUND') {
    return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
  }
  if (refusal.status === 'EVENT_POSITIONING') {
    return reply.status(409).send({
      error: 'EVENT_POSITIONING',
      message: 'Le boost ne s’applique pas à un positionnement événementiel.',
    });
  }
  if (refusal.status === 'NOT_BOOSTABLE') {
    return reply.status(409).send({
      error: 'NOT_BOOSTABLE',
      message: 'Only an active or upcoming campaign can be boosted.',
      current_status: refusal.currentStatus,
    });
  }
  const { status, ...detail } = refusal;
  return reply.status(400).send({
    error: status,
    message: 'The boost was refused.',
    ...Object.fromEntries(
      Object.entries(detail).map(([k, v]) => [
        k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
        v,
      ]),
    ),
  });
};

export const campaignBoostRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // POST /api/campaigns/:id/boost/preview — the boost ceiling over the HYPOTHETICAL merged
  // state (end/zones/categories applied in-tx then rolled back). Nothing persists.
  app.post('/api/campaigns/:id/boost/preview', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedBody = additionsSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const result = await runBoost(
      parsedParams.data.id,
      userId,
      {
        newEndDate: parsedBody.data.new_end_date,
        addedZoneIds: parsedBody.data.added_zone_ids,
        addedCategoryIds: parsedBody.data.added_category_ids,
      },
      { previewOnly: true },
    );
    if (result.status !== 'PREVIEW') return sendRefusal(reply, result as BoostRefusal);
    return reply.status(200).send({
      c_max_boost_tnd: result.cMaxBoostTnd,
      eligible_count: result.eligibleCount,
    });
  });

  // POST /api/campaigns/:id/boost — the ATOMIC apply: extend + append + dispatch V over the
  // merged pool + the boost row, in ONE transaction. Any refusal → 400/409, NOTHING persisted.
  app.post('/api/campaigns/:id/boost', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedBody = applySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const result = await runBoost(
      parsedParams.data.id,
      userId,
      {
        newEndDate: parsedBody.data.new_end_date,
        addedZoneIds: parsedBody.data.added_zone_ids,
        addedCategoryIds: parsedBody.data.added_category_ids,
      },
      {
        previewOnly: false,
        amountTnd: parsedBody.data.amount_tnd,
        appliedBy: userId,
        // LOG1 — journal the APPLY (previews never journal; flushed inside runBoost, post-tx).
        trace: createEngineTrace('boost', parsedParams.data.id),
      },
    );
    if (result.status !== 'APPLIED') return sendRefusal(reply, result as BoostRefusal);
    // CF-HF4 — the boost extended/added allocations: re-push every venue of the campaign so
    // connected screens pick the appended volume without waiting for a reconnect.
    try {
      await pushPlaylistToCampaignVenues(parsedParams.data.id, request.log);
    } catch (err) {
      request.log.warn({ err }, 'playlist re-push on boost failed');
    }
    return reply.status(200).send({
      boost_id: result.boostId,
      placed_fact: result.placedFact,
      v_fact: result.vFact,
      new_end_date: result.newEndDate,
      reliquat_added_fact: result.reliquatAddedFact,
    });
  });
};
