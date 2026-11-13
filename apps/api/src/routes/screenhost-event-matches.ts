import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { campaigns, creatives, eventAllocations, events, screenhosts } from '../db/schema.js';
import { notStoppedCampaignSql } from '../lib/campaign-stopped.js';
import { EVENT_ACCEPT_REMINDER, decideEventAllocation } from '../lib/event-allocation-decision.js';
import { groupedNoticeAt, ownsVenue, pendingGroupedShareIds } from '../lib/event-host-notice.js';
import { loadOwnerSharePcts, ownerShareTnd } from '../lib/owner-share.js';
import { pushPlaylistToAllConnected, pushPlaylistToVenue } from '../lib/playout/push.js';
import { requireActiveAccount, requireAuth } from '../middleware/require-auth.js';

// Mariem 05/11/2026 — the « Soir de match » popup (lib/event-host-notice sends its notice 24 h
// before kick-off): one entry per match and venue, every spot positioned there, and one answer
// for all of them.
//   GET  /api/screenhosts/event-matches                                    the matches awaiting an answer
//   POST /api/screenhosts/event-matches/:eventId/venues/:screenhostId/accept|refuse
// Each spot is decided through lib/event-allocation-decision (ONE home): owner-scoped, a refusal
// final and re-placed on other venues, exactly as when the spots are answered one by one.

const paramsSchema = z.object({ eventId: z.uuid(), screenhostId: z.uuid() });

interface MatchSpot {
  allocation_id: string;
  campaign_id: string;
  creative: {
    kind: string;
    title: string | null;
    filename: string | null;
    duration_seconds: number | null;
  } | null;
  montant_tnd: number;
}

interface PendingMatch {
  event_id: string;
  match_name: string;
  kickoff_at: string;
  ends_at: string;
  /** When the « Soir de match » notice went out (kick-off − 24 h). */
  noticed_at: string;
  screenhost_id: string;
  screenhost_name: string;
  /** The owner's share for the match, Σ of the spots' (lib/owner-share), millime-exact. */
  total_tnd: number;
  spots: MatchSpot[];
}

const unauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

export const screenhostEventMatchRoutes: FastifyPluginAsync = async (app) => {
  const ownerGuard = { preHandler: [requireAuth, requireActiveAccount] };

  app.get('/api/screenhosts/event-matches', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return unauthenticated(reply);
    const rows = await db
      .select({
        allocationId: eventAllocations.id,
        montantTnd: eventAllocations.montantTnd,
        campaignId: campaigns.id,
        eventId: events.id,
        matchName: events.name,
        kickoffAt: events.kickoffAt,
        endsAt: events.endsAt,
        screenhostId: screenhosts.id,
        screenhostName: screenhosts.name,
        creativeKind: creatives.creativeType,
        creativeTitle: creatives.title,
        creativeFilename: creatives.originalFilename,
        creativeDuration: creatives.durationSeconds,
      })
      .from(eventAllocations)
      .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
      .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
      .innerJoin(events, eq(campaigns.eventId, events.id))
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(
        and(
          eq(screenhosts.ownerId, userId),
          eq(eventAllocations.statut, 'EN_ATTENTE'),
          eq(eventAllocations.notice, 'grouped'),
          notStoppedCampaignSql(),
        ),
      )
      .orderBy(asc(events.kickoffAt), asc(screenhosts.name), asc(eventAllocations.createdAt));
    const pcts = await loadOwnerSharePcts();
    const matches = new Map<string, PendingMatch>();
    for (const r of rows) {
      const key = `${r.eventId}:${r.screenhostId}`;
      const match = matches.get(key) ?? {
        event_id: r.eventId,
        match_name: r.matchName,
        kickoff_at: r.kickoffAt.toISOString(),
        noticed_at: groupedNoticeAt(r.kickoffAt).toISOString(),
        ends_at: r.endsAt.toISOString(),
        screenhost_id: r.screenhostId,
        screenhost_name: r.screenhostName,
        total_tnd: 0,
        spots: [],
      };
      const share = ownerShareTnd(Number(r.montantTnd), pcts);
      match.spots.push({
        allocation_id: r.allocationId,
        campaign_id: r.campaignId,
        creative: r.creativeKind
          ? {
              kind: r.creativeKind,
              title: r.creativeTitle,
              filename: r.creativeFilename,
              duration_seconds: r.creativeDuration,
            }
          : null,
        montant_tnd: share,
      });
      match.total_tnd = Math.round(match.total_tnd * 1000 + share * 1000) / 1000;
      matches.set(key, match);
    }
    return reply.status(200).send([...matches.values()]);
  });

  const decideMatch = async (
    request: FastifyRequest,
    reply: FastifyReply,
    statut: 'ACCEPTE' | 'REFUSE',
  ) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed' });
    }
    const userId = request.user?.id;
    if (!userId) return unauthenticated(reply);
    const { eventId, screenhostId } = parsed.data;
    if (!(await ownsVenue(userId, screenhostId))) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such venue.' });
    }
    // The spots the notice asked about and still awaiting an answer — the popup's list (the set
    // is fixed once the notice is sent: a later share is proposed alone).
    let decided = 0;
    for (const allocationId of await pendingGroupedShareIds(eventId, screenhostId)) {
      const outcome = await decideEventAllocation({ allocationId, ownerId: userId, statut });
      if (outcome.kind === 'ok' && outcome.changed) decided += 1;
    }
    // The per-spot route's re-pushes (FRESH-1 / EVT-STOP), once for the whole match.
    if (decided > 0 && statut === 'ACCEPTE') {
      await pushPlaylistToVenue(screenhostId, request.log).catch((err: unknown) =>
        request.log.warn({ err, screenhostId }, 'playlist re-push on match accept failed'),
      );
    }
    if (decided > 0 && statut === 'REFUSE') {
      await pushPlaylistToAllConnected(request.log).catch((err: unknown) =>
        request.log.warn({ err }, 'network playlist re-push failed'),
      );
    }
    return reply.status(200).send({
      event_id: eventId,
      screenhost_id: screenhostId,
      statut,
      decided,
      ...(statut === 'ACCEPTE' ? { reminder: EVENT_ACCEPT_REMINDER } : {}),
    });
  };

  app.post(
    '/api/screenhosts/event-matches/:eventId/venues/:screenhostId/accept',
    ownerGuard,
    (request, reply) => decideMatch(request, reply, 'ACCEPTE'),
  );
  app.post(
    '/api/screenhosts/event-matches/:eventId/venues/:screenhostId/refuse',
    ownerGuard,
    (request, reply) => decideMatch(request, reply, 'REFUSE'),
  );
};
