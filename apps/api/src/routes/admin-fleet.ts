import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  type FleetScreen,
  type FleetScreenDetail,
  loadFleet,
  loadFleetScreen,
} from '../lib/fleet/load.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// FLEET-1 (operator 18/11, phase 1) — « Parc d'écrans »: GET /api/admin/fleet (every active
// screen, its state now and its day so far) and GET /api/admin/fleet/screens/:id (one screen hour
// by hour and campaign by campaign). Admin only, reads only. The figures: lib/fleet.

const idParamSchema = z.object({ id: z.uuid() });

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const screenView = (s: FleetScreen) => ({
  id: s.id,
  name: s.name,
  venue: s.venue,
  status: s.status,
  connected: s.connected,
  last_seen_at: iso(s.lastSeenAt),
  paired_at: iso(s.pairedAt),
  open_now: s.openNow,
  match_now: s.matchNow,
  now: { planned_reps: s.now.plannedReps, campaigns: s.now.campaigns },
  last_proof: s.lastProof
    ? { at: s.lastProof.at.toISOString(), campaign_name: s.lastProof.campaignName }
    : null,
  today: {
    planned_total: s.today.plannedTotal,
    planned_so_far: s.today.plannedSoFar,
    aired: s.today.aired,
  },
});

const detailView = (s: FleetScreenDetail) => ({
  ...screenView(s),
  hours: s.hours.map((h) => ({
    hour: h.hour,
    planned: h.planned,
    aired: h.aired,
    blackout_minutes: h.blackoutMinutes,
    campaigns: h.campaigns,
  })),
  campaigns: s.campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    start_date: c.startDate,
    end_date: c.endDate,
    planned_today: c.plannedToday,
    aired_today: c.airedToday,
    aired_total: c.airedTotal,
    last_proof_at: iso(c.lastProofAt),
  })),
});

export const adminFleetRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/fleet', adminGuard, async (_request, reply) => {
    const now = new Date();
    const fleet = await loadFleet(now);
    return reply
      .status(200)
      .send({ computed_at: now.toISOString(), screens: fleet.map(screenView) });
  });

  app.get('/api/admin/fleet/screens/:id', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const now = new Date();
    const detail = await loadFleetScreen(parsed.data.id, now);
    if (!detail) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screen.' });
    return reply.status(200).send({ computed_at: now.toISOString(), ...detailView(detail) });
  });
};
