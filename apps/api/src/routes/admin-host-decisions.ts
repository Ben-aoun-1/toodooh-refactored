import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  eventAllocations,
  notifications,
  screenhosts,
  users,
} from '../db/schema.js';
import { afterClassicDecision, afterEventDecision } from '../lib/allocation-decision-effects.js';
import { OFFER_ALREADY_ANSWERED, decideAllocation } from '../lib/allocation-decision.js';
import { decideEventAllocation } from '../lib/event-allocation-decision.js';
import { loadOwnerSharePcts, ownerShareTnd } from '../lib/owner-share.js';
import { userLabel } from '../lib/user-label.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Mariem 13/11/2026 (« Changements à livrer avant le test », point 1) — the Admin accepts or
// refuses a campaign ON BEHALF of a Host, from the campaign's window in Admin > Campagnes.
//
//   GET  /api/admin/campaigns/:id/host-decisions            every Host of the campaign + its answer
//   POST /api/admin/host-decisions/:kind/:id/accept|refuse   answer one Host's share (kind =
//                                                            campaign | event)
//
// The answer runs the OWNER's own transaction (lib/allocation-decision.ts /
// lib/event-allocation-decision.ts, called with the venue's owner id) and the same post-commit
// effects (lib/allocation-decision-effects.ts): a refusal is definitive and cascades exactly as the
// Host's own. The Host is told in-app that the Toodooh team answered for them.

export const ADMIN_DECISION_NOTICE_TYPE = 'admin_decided_for_host';

/** The Host's in-app notice (French, ONE home). */
export const adminDecisionNotice = (
  statut: 'ACCEPTE' | 'REFUSE',
  campaignName: string,
  venueName: string,
): { title: string; body: string } =>
  statut === 'ACCEPTE'
    ? {
        title: 'Campagne acceptée pour vous',
        body: `L’équipe Toodooh a accepté la campagne « ${campaignName} » pour ${venueName}.`,
      }
    : {
        title: 'Campagne refusée pour vous',
        body: `L’équipe Toodooh a refusé la campagne « ${campaignName} » pour ${venueName}.`,
      };

const idParam = z.object({ id: z.uuid() });
const decisionParams = z.object({ kind: z.enum(['campaign', 'event']), id: z.uuid() });

export const adminHostDecisionRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/campaigns/:id/host-decisions', adminGuard, async (request, reply) => {
    const parsed = idParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed' });
    }
    const [campaign] = await db
      .select({ id: campaigns.id, eventId: campaigns.eventId, status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, parsed.data.id))
      .limit(1);
    if (!campaign) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    const pcts = await loadOwnerSharePcts();
    const owner = {
      id: users.id,
      email: users.email,
      contactName: users.contactName,
      businessName: users.businessName,
    };
    const rows =
      campaign.eventId !== null
        ? (
            await db
              .select({
                allocationId: eventAllocations.id,
                screenhostId: screenhosts.id,
                screenhostName: screenhosts.name,
                statut: eventAllocations.statut,
                decidedAt: eventAllocations.decidedAt,
                montantTnd: eventAllocations.montantTnd,
                owner,
              })
              .from(eventAllocations)
              .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
              .leftJoin(users, eq(screenhosts.ownerId, users.id))
              .where(eq(eventAllocations.campaignId, campaign.id))
              .orderBy(asc(screenhosts.name))
          ).map((r) => ({ ...r, kind: 'event' as const, value: Number(r.montantTnd) }))
        : (
            await db
              .select({
                allocationId: campaignDispatchAllocation.id,
                screenhostId: screenhosts.id,
                screenhostName: screenhosts.name,
                statut: campaignDispatchAllocation.statutAcceptation,
                revenu: campaignDispatchAllocation.revenuPrevisionnel,
                owner,
              })
              .from(campaignDispatchAllocation)
              .innerJoin(
                campaignDispatchPlan,
                eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
              )
              .innerJoin(screenhosts, eq(campaignDispatchAllocation.screenhostId, screenhosts.id))
              .leftJoin(users, eq(screenhosts.ownerId, users.id))
              .where(eq(campaignDispatchPlan.campaignId, campaign.id))
              .orderBy(asc(screenhosts.name))
          ).map((r) => ({
            ...r,
            kind: 'campaign' as const,
            decidedAt: null,
            value: Number(r.revenu),
          }));
    return reply.status(200).send({
      campaign_id: campaign.id,
      campaign_status: campaign.status,
      kind: campaign.eventId !== null ? 'event' : 'campaign',
      hosts: rows.map((r) => ({
        kind: r.kind,
        allocation_id: r.allocationId,
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        owner_label: r.owner?.id ? userLabel(r.owner) : null,
        statut: r.statut,
        decided_at: r.statut === 'EN_ATTENTE' ? null : r.decidedAt,
        owner_share_tnd: ownerShareTnd(r.value, pcts),
      })),
    });
  });

  const decide = async (
    request: FastifyRequest,
    reply: FastifyReply,
    statut: 'ACCEPTE' | 'REFUSE',
  ) => {
    const parsed = decisionParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed' });
    }
    const adminId = request.user?.id ?? null;
    const { kind, id } = parsed.data;
    // The venue's owner: the decision runs the owner's own owner-scoped transaction.
    const [target] =
      kind === 'campaign'
        ? await db
            .select({
              ownerId: screenhosts.ownerId,
              venueName: screenhosts.name,
              campaignId: campaigns.id,
              campaignName: campaigns.name,
            })
            .from(campaignDispatchAllocation)
            .innerJoin(
              campaignDispatchPlan,
              eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
            )
            .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
            .innerJoin(screenhosts, eq(campaignDispatchAllocation.screenhostId, screenhosts.id))
            .where(eq(campaignDispatchAllocation.id, id))
            .limit(1)
        : await db
            .select({
              ownerId: screenhosts.ownerId,
              venueName: screenhosts.name,
              campaignId: campaigns.id,
              campaignName: campaigns.name,
            })
            .from(eventAllocations)
            .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
            .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
            .where(eq(eventAllocations.id, id))
            .limit(1);
    if (!target || target.ownerId === null) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Allocation introuvable.' });
    }
    const outcome =
      kind === 'campaign'
        ? await decideAllocation({
            allocationId: id,
            ownerId: target.ownerId,
            statut,
            actor: { kind: 'admin', userId: adminId },
          })
        : await decideEventAllocation({
            allocationId: id,
            ownerId: target.ownerId,
            statut,
            actor: { kind: 'admin', userId: adminId },
          });
    if (outcome.kind === 'not_found') {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Allocation introuvable.' });
    }
    if (outcome.kind === 'refused_final') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Ce Host a déjà refusé : le refus est définitif.',
      });
    }
    // Agent spec VF §10 + operator 2026-11-14 — the first answer is final, for the admin too
    // (stopping the campaign stays the way out of an acceptance).
    if (outcome.kind === 'already_answered') {
      return reply.status(409).send({ error: 'ALREADY_ANSWERED', message: OFFER_ALREADY_ANSWERED });
    }
    if (kind === 'campaign') {
      await afterClassicDecision(outcome.screenhostId, statut, outcome.changed, request.log);
    } else {
      await afterEventDecision(outcome.screenhostId, statut, outcome.changed, request.log);
    }
    if (outcome.changed) {
      await db.insert(notifications).values({
        userId: target.ownerId,
        type: ADMIN_DECISION_NOTICE_TYPE,
        ...adminDecisionNotice(statut, target.campaignName, target.venueName),
        campaignId: target.campaignId,
      });
      request.log.info(
        { adminId, allocationId: id, kind, statut, screenhostId: outcome.screenhostId },
        'admin answered a proposal on behalf of the host',
      );
    }
    return reply.status(200).send({ allocation_id: id, kind, statut, changed: outcome.changed });
  };

  app.post('/api/admin/host-decisions/:kind/:id/accept', adminGuard, (request, reply) =>
    decide(request, reply, 'ACCEPTE'),
  );
  app.post('/api/admin/host-decisions/:kind/:id/refuse', adminGuard, (request, reply) =>
    decide(request, reply, 'REFUSE'),
  );
};
