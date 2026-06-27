import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  type CampaignDispatchAllocation,
  type CampaignDispatchPlan,
  campaignDispatchAllocation,
  campaigns,
} from '../db/schema.js';
import { runDispatch } from '../lib/dispatch/dispatch-service.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Dispatch entrypoint (L-disp). Admin/internal trigger — synthetic I_cible/CPM/S/T inputs for now
// (pricing supplies them in a later lane). Builds + FREEZES the PlanDiffusion (A.7) or returns the
// clôture alert (partial / too-thin). The real on-activation trigger wires later.

const idParamSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  i_cible: z.number().int().positive(),
  cpm: z.number().positive(),
  s: z.number().int().positive(),
  t: z.number().positive(),
});

const planView = (plan: CampaignDispatchPlan, allocations: CampaignDispatchAllocation[]) => ({
  plan: {
    id: plan.id,
    campaign_id: plan.campaignId,
    i_cible: plan.iCible,
    cpm: Number(plan.cpm),
    s: plan.sSpotSeconds,
    t: Number(plan.tTierCoef),
    seuil_diffusable: plan.seuilDiffusable,
    s_min: Number(plan.sMin),
    g_jour: Number(plan.gJour),
    couvert: plan.couvert,
    n_min: plan.nMin,
    n_max: plan.nMax,
    n_retenus: plan.nRetenus,
    is_partial: plan.isPartial,
    is_too_thin: plan.isTooThin,
  },
  allocations: allocations.map((a) => ({
    screenhost_id: a.screenhostId,
    ii_potentiel: a.iiPotentiel,
    r_i: a.rI,
    revenu_previsionnel: Number(a.revenuPrevisionnel),
    statut_acceptation: a.statutAcceptation,
    creneaux: a.creneaux,
  })),
});

export const campaignDispatchRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.post('/api/campaigns/:id/dispatch', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const [campaign] = await db
      .select({ id: campaigns.id, startDate: campaigns.startDate, endDate: campaigns.endDate })
      .from(campaigns)
      .where(eq(campaigns.id, parsedParams.data.id))
      .limit(1);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }

    const result = await runDispatch(campaign, {
      iCible: parsed.data.i_cible,
      cpm: parsed.data.cpm,
      s: parsed.data.s,
      t: parsed.data.t,
    });

    if (result.status === 'NO_WINDOW') {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'window', reason: 'campaign requires a start_date and end_date' }],
      });
    }
    if (result.status === 'NO_TARGETING') {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'targeting', reason: 'campaign requires at least one targeting line' }],
      });
    }
    if (result.status === 'ALREADY_DISPATCHED') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Campaign already has a frozen dispatch plan.',
        statusCode: 409,
      });
    }

    const allocations = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, result.plan.id));
    return reply.status(201).send(planView(result.plan, allocations));
  });
};
