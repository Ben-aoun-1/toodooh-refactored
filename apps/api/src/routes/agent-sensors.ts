import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { screenhosts } from '../db/schema.js';
import {
  type AssignError,
  agentVenues,
  assignHubSensor,
  assignmentView,
  fetchHubSensors,
  sensorCards,
  sensorTotals,
  sensorVenueDetail,
} from '../lib/agent-sensors.js';
import { decryptWifiPassword } from '../lib/wifi-crypto.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

import { agentCgeGate } from './agent-account.js';

// Agent Screenhost spec VF §12 « Suivi des capteurs » and §14 « Assigner un capteur », inside
// Toodooh (operator 2026-11-14). Screenhost agents only; every venue is checked against the
// agent's own live affiliations before anything about it is read, revealed or assigned.

const guard = { preHandler: [requireAuth, requireRole('screenhost_agent'), agentCgeGate] };
const idParam = z.object({ id: z.uuid() });
const HUB_DOWN = {
  error: 'HUB_UNAVAILABLE',
  message: 'Les capteurs sont momentanément indisponibles. Réessayez dans quelques minutes.',
};

const ASSIGN_MESSAGES: Record<AssignError, string> = {
  HUB_UNAVAILABLE: HUB_DOWN.message,
  AGENT_NOT_FOUND: 'Votre compte n’est pas encore relié aux capteurs. Contactez l’équipe Toodooh.',
  DEVICE_NOT_FOUND: 'Capteur introuvable.',
  PLACE_NOT_FOUND:
    'Ce Screenhost n’est pas encore validé par Toodooh : le capteur pourra lui être assigné après sa validation.',
  NOT_YOUR_DEVICE: 'Ce capteur a été préparé par un autre agent.',
};

export const agentSensorRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/agent/sensors — the counters and one card per equipped venue.
  app.get('/api/agent/sensors', guard, async (request, reply) => {
    const agentId = request.user?.id ?? '';
    const hub = await fetchHubSensors(agentId);
    if (!hub) return reply.status(503).send(HUB_DOWN);
    const cards = sensorCards(await agentVenues(agentId), hub);
    return reply.status(200).send({ totals: sensorTotals(cards), venues: cards });
  });

  // GET /api/agent/sensors/assignment — the agent's prepared sensors and his venues.
  app.get('/api/agent/sensors/assignment', guard, async (request, reply) => {
    const agentId = request.user?.id ?? '';
    const hub = await fetchHubSensors(agentId);
    if (!hub) return reply.status(503).send(HUB_DOWN);
    return reply.status(200).send(assignmentView(await agentVenues(agentId), hub));
  });

  // POST /api/agent/sensors/assignment { device_id, screenhost_id } — assign (or move) a sensor.
  app.post('/api/agent/sensors/assignment', guard, async (request, reply) => {
    const body = z
      .object({ device_id: z.string().min(1).max(64), screenhost_id: z.uuid() })
      .safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'Validation failed' });
    }
    const agentId = request.user?.id ?? '';
    const venue = (await agentVenues(agentId)).find(
      (v) => v.screenhost_id === body.data.screenhost_id,
    );
    if (!venue) {
      return reply
        .status(404)
        .send({ error: 'NOT_FOUND', message: 'Ce Screenhost ne fait pas partie de vos affiliés.' });
    }
    const r = await assignHubSensor(agentId, body.data.device_id, venue.screenhost_id);
    if (!r.ok) {
      const status =
        r.error === 'HUB_UNAVAILABLE' ? 503 : r.error === 'NOT_YOUR_DEVICE' ? 403 : 404;
      return reply.status(status).send({ error: r.error, message: ASSIGN_MESSAGES[r.error] });
    }
    request.log.info(
      { agentId, deviceId: body.data.device_id, screenhostId: venue.screenhost_id },
      'agent assigned a sensor',
    );
    return reply.status(200).send({ ok: true, sensor: r.device.label, screenhost: venue.name });
  });

  // GET /api/agent/sensors/:id — the window of one equipped venue.
  app.get('/api/agent/sensors/:id', guard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const agentId = request.user?.id ?? '';
    const hub = await fetchHubSensors(agentId);
    if (!hub) return reply.status(503).send(HUB_DOWN);
    const card = sensorCards(await agentVenues(agentId), hub).find(
      (c) => c.screenhost_id === params.data.id,
    );
    if (!card) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Screenhost introuvable.' });
    }
    return reply.status(200).send(await sensorVenueDetail(card, hub));
  });

  // POST /api/agent/sensors/:id/wifi-password — « Afficher » / « Copier »: the venue's Wi-Fi
  // password, decrypted on demand for the venue's own agent, and logged.
  app.post('/api/agent/sensors/:id/wifi-password', guard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'INVALID_INPUT', message: 'id' });
    const agentId = request.user?.id ?? '';
    const venue = (await agentVenues(agentId)).find((v) => v.screenhost_id === params.data.id);
    if (!venue) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Screenhost introuvable.' });
    }
    const [row] = await db
      .select({ pwd: screenhosts.wifiPasswordEncrypted })
      .from(screenhosts)
      .where(eq(screenhosts.id, venue.screenhost_id))
      .limit(1);
    request.log.info({ agentId, screenhostId: venue.screenhost_id }, 'agent read a wifi password');
    return reply.status(200).send({ password: row?.pwd ? decryptWifiPassword(row.pwd) : null });
  });
};
