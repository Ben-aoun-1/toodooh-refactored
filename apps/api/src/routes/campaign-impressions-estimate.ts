import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { campaigns, creatives } from '../db/schema.js';
import {
  type EstimateRefusal,
  type ImpressionsEstimate,
  estimateCampaignImpressions,
} from '../lib/impressions-estimate.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

// IMP-EST1 — GET /api/campaigns/:id/impressions-estimate: « Impressions estimées », the read-only
// dry-run of the real dispatch (lib/impressions-estimate.ts). Owner-scoped exactly like /cmax
// (a foreign id ≡ a missing one: 404, never a leak). `budget_tnd` sizes the dry-run with the
// wizard's cursor before it is saved; absent, the stored requested_budget does. Every outcome the
// estimate can reach is a 200 carrying a status — « no estimate » is an answer, not an error.

const idParamSchema = z.object({ id: z.uuid() });
const querySchema = z.object({ budget_tnd: z.coerce.number().positive().finite().optional() });

/** The wire shape (snake_case, the campaigns API idiom). impressions is null unless status = ok. */
export interface ImpressionsEstimateWire {
  status:
    | 'ok'
    | 'no_dates'
    | 'no_budget'
    | 'budget_too_low'
    | 'no_creative'
    | 'no_eligible'
    | 'saturated'
    | 'too_thin'
    | 'event_cancelled';
  source: 'simulation' | 'plan' | null;
  /** PHYSICAL — the real audience of the (simulated or frozen) plan. */
  impressions: number | null;
  /** IMP-FACT1 — the BILLABLE objective, the advertiser's « Impressions prévues »; null unless ok. */
  objectif: number | null;
  venues_count: number | null;
  days_count: number | null;
}

const WIRE_REFUSAL: Record<EstimateRefusal, Exclude<ImpressionsEstimateWire['status'], 'ok'>> = {
  NO_DATES: 'no_dates',
  NO_BUDGET: 'no_budget',
  BUDGET_TOO_LOW: 'budget_too_low',
  NO_CREATIVE: 'no_creative',
  NO_ELIGIBLE: 'no_eligible',
  SATURATED: 'saturated',
  TOO_THIN: 'too_thin',
  EVENT_CANCELLED: 'event_cancelled',
};

export const toEstimateWire = (e: ImpressionsEstimate): ImpressionsEstimateWire =>
  e.status === 'OK'
    ? {
        status: 'ok',
        source: e.source === 'PLAN' ? 'plan' : 'simulation',
        impressions: e.impressions,
        objectif: e.objectif,
        venues_count: e.venuesCount,
        days_count: e.daysCount,
      }
    : {
        status: WIRE_REFUSAL[e.status],
        source: null,
        impressions: null,
        objectif: null,
        venues_count: null,
        days_count: null,
      };

export const campaignImpressionsEstimateRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  app.get('/api/campaigns/:id/impressions-estimate', advertiserGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedQuery = querySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: [{ field: 'budget_tnd', reason: 'must be a positive number' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [row] = await db
      .select({
        id: campaigns.id,
        campaignType: campaigns.campaignType,
        eventId: campaigns.eventId,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        requestedBudget: campaigns.requestedBudget,
        standardCpmTnd: campaigns.standardCpmTnd,
        eventCpmTnd: campaigns.eventCpmTnd,
        t10s: campaigns.t10s,
        t20s: campaigns.t20s,
        t30s: campaigns.t30s,
        creativeId: campaigns.creativeId,
        creativeDurationSeconds: creatives.durationSeconds,
      })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(and(eq(campaigns.id, parsedParams.data.id), eq(campaigns.advertiserId, userId)))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    const { creativeId, creativeDurationSeconds, ...campaign } = row;
    const estimate = await estimateCampaignImpressions(
      { ...campaign, spotSeconds: creativeId === null ? null : creativeDurationSeconds },
      { budgetTnd: parsedQuery.data.budget_tnd },
    );
    return reply.status(200).send(toEstimateWire(estimate));
  });
};
