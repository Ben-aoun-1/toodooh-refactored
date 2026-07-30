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
import { createEngineTrace } from '../lib/engine-journal/trace.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Dispatch entrypoint (L-disp). Admin/internal trigger — synthetic I_cible/CPM/S/T inputs for now
// (pricing supplies them in a later lane). Builds + FREEZES the PlanDiffusion (A.7) when deliverable,
// or returns a clôture alert (too-thin / no-eligible → 422, NOT frozen, re-dispatchable).
// TODO (activation): this synthetic admin trigger dispatches regardless of campaign state. The real
// on-activation trigger must gate on approved-creative + confirmed-payment + draft→active first.

const idParamSchema = z.object({ id: z.uuid() });
// E1 (VF) — `t` is no longer an input: the attention index derives from S inside runDispatch
// (tForDuration against the config buckets) and lands on the plan snapshot.
const bodySchema = z.object({
  i_cible: z.number().int().positive(),
  cpm: z.number().positive(),
  s: z.number().int().positive(),
});

export const planView = (
  plan: CampaignDispatchPlan,
  allocations: CampaignDispatchAllocation[],
) => ({
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
      .select({
        id: campaigns.id,
        name: campaigns.name,
        eventId: campaigns.eventId,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
      })
      .from(campaigns)
      .where(eq(campaigns.id, parsedParams.data.id))
      .limit(1);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });
    }
    // EV3 — THE ENGINE BOUNDARY (pinned): a positioning (an event-BOUND row) never reaches
    // runDispatch — no pool, no plan, no allocations until EV4 wires bloc dispatch.
    if (campaign.eventId !== null) {
      return reply.status(409).send({
        error: 'EVENT_POSITIONING',
        message: 'Un positionnement événementiel ne passe pas par le dispatch classique.',
      });
    }

    const result = await runDispatch(
      campaign,
      {
        iCible: parsed.data.i_cible,
        cpm: parsed.data.cpm,
        s: parsed.data.s,
      },
      // LOG1 — journal this admin/internal dispatch entry too (flushed inside runDispatch).
      createEngineTrace('dispatch', campaign.id),
    );

    if (result.status === 'NO_WINDOW') {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'window', reason: 'campaign requires a start_date and end_date' }],
      });
    }
    // E5.1 — the NO_TARGETING refusal retired: zero targeting lines = the whole network.
    if (result.status === 'ALREADY_DISPATCHED') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Campaign already has a frozen dispatch plan.',
        statusCode: 409,
      });
    }
    // Clôture alerts — NOT frozen, so the campaign stays re-dispatchable (renvoi curseur):
    if (result.status === 'TOO_THIN') {
      return reply.status(422).send({
        error: 'NOT_DELIVERABLE',
        reason: 'too_thin',
        message:
          'Covering I_cible would exceed materiality (N_min > N_max). Lower the cursor or broaden targeting, then re-dispatch.',
        n_min: result.nMin,
        n_max: result.nMax,
      });
    }
    if (result.status === 'NO_ELIGIBLE') {
      // CF-HF4 — saturated ≠ empty targeting on this surface too.
      return reply.status(422).send({
        error: 'NOT_DELIVERABLE',
        reason: result.saturated ? 'saturated' : 'no_eligible',
        message: result.saturated
          ? 'Inventaire momentanément saturé sur ce ciblage — réessayez avec une autre période.'
          : 'No eligible screenhost could be allocated. Adjust targeting/window, then re-dispatch.',
      });
    }

    const allocations = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, result.plan.id));
    return reply.status(201).send(planView(result.plan, allocations));
  });
};
