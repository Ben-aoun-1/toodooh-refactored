import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  broadcastCampaignVenues,
  broadcastTimeline,
  clearManualBroadcast,
  currentManualBroadcast,
  loadBroadcastSpots,
  manualBroadcastPlays,
  setManualBroadcast,
} from '../lib/playout/manual-broadcast.js';
import { pushPlaylistToAllConnected } from '../lib/playout/push.js';
import { screenRegistry } from '../lib/playout/registry.js';

// OPS-BROADCAST (operator 22/11) — the operator's « go »: announce ONE ad page to the TVs
// (POST), read it (GET), withdraw it (DELETE). The rules: lib/playout/manual-broadcast.ts.
//
// LOOPBACK ONLY: these routes answer a caller on the api's own machine (the operator, from inside
// the container) and nobody else — nginx reaches the api from another address, so no request from
// the internet can ever match, whatever headers it carries (the raw socket address is read, never
// a forwarded one).

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const isLoopback = (request: FastifyRequest): boolean =>
  LOOPBACK.has(request.raw.socket.remoteAddress ?? '');

const bodySchema = z.object({
  campaign_ids: z.array(z.uuid()).min(1).max(3),
  /** The page opens this long after the order (the TVs need the time to fetch the spots). */
  starts_in_seconds: z
    .number()
    .int()
    .min(10)
    .max(24 * 3600),
  /** 'campaign_venues' = the venues that held these campaigns; 'all' = every venue. */
  scope: z.enum(['campaign_venues', 'all']),
  /** The operator's own list of venues: when given, the page airs there and nowhere else. */
  venue_ids: z.array(z.uuid()).min(1).max(100).optional(),
});

const view = () => {
  const b = currentManualBroadcast();
  return b
    ? {
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        venues: b.venueIds ? b.venueIds.size : null,
        spots: b.spots.map((s) => ({
          campaign_id: s.campaignId,
          name: s.campaignName,
          seconds: s.durationSeconds,
          passes: b.slots.filter((slot) => slot.campaignId === s.campaignId).length,
        })),
        slots: b.slots.map((slot) => ({
          campaign_id: slot.campaignId,
          at: slot.at.toISOString(),
          seconds: slot.seconds,
        })),
      }
    : null;
};

export const internalBroadcastRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request, reply) => {
    if (!isLoopback(request)) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    }
    return undefined;
  });

  app.get('/api/internal/ops/broadcast', async (_request, reply) =>
    reply.status(200).send({
      broadcast: view(),
      connected_screens: screenRegistry.connectedScreenIds(),
      plays: manualBroadcastPlays(),
    }),
  );

  app.post('/api/internal/ops/broadcast', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed' });
    }
    const {
      campaign_ids: ids,
      starts_in_seconds: startsIn,
      scope,
      venue_ids: venues,
    } = parsed.data;
    const spots = await loadBroadcastSpots(ids);
    if (spots.length !== ids.length) {
      return reply
        .status(409)
        .send({ error: 'SPOT_MISSING', message: 'A campaign has no spot, or does not exist.' });
    }
    const start = new Date(Math.ceil((Date.now() + startsIn * 1000) / 1000) * 1000);
    const timeline = broadcastTimeline(spots, start);
    if (!timeline) return reply.status(409).send({ error: 'NO_TIMELINE', message: 'No page.' });
    setManualBroadcast({
      start,
      end: timeline.end,
      spots,
      slots: timeline.slots,
      venueIds: venues
        ? new Set(venues)
        : scope === 'all'
          ? null
          : await broadcastCampaignVenues(ids),
    });
    const sent = await pushPlaylistToAllConnected(request.log);
    request.log.info(
      { start: start.toISOString(), end: timeline.end.toISOString(), scope, sent },
      'operator broadcast announced',
    );
    return reply.status(200).send({ broadcast: view(), sockets_reached: sent });
  });

  app.delete('/api/internal/ops/broadcast', async (request, reply) => {
    clearManualBroadcast();
    const sent = await pushPlaylistToAllConnected(request.log);
    request.log.info({ sent }, 'operator broadcast withdrawn');
    return reply.status(200).send({ broadcast: null, sockets_reached: sent });
  });
};
