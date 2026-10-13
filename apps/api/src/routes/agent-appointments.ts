import { addMonths, format, parseISO } from 'date-fns';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { agentAppointmentObjectives, agents } from '../db/schema.js';
import {
  SLOT_HOURS,
  type TransitionResult,
  affiliateRespond,
  agentAccept,
  agentCalendar,
  agentPropose,
  appointmentsOf,
  cancelAppointment,
  objectivesFor,
  referentOf,
  requestAppointment,
  setAvailability,
} from '../lib/agent-appointments.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

import { agentCgeGate } from './agent-account.js';

// AGT-5 (agent specs v1.0 §7) — « Mon calendrier » for the agent, « Prendre rendez-vous » for its
// affiliates (Screencasters, Screenhost owners) and the hub's list of appointment reasons.

const affiliateGuard = {
  preHandler: [requireAuth, requireRole('advertiser', 'individual_owner', 'fleet_owner')],
};
const agentGuard = {
  preHandler: [requireAuth, requireRole('screenhost_agent', 'screencast_agent'), agentCgeGate],
};
const staffGuard = { preHandler: [requireAuth, requireRole('admin', 'superadmin')] };

const idParam = z.object({ id: z.uuid() });
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const slot = { day: z.iso.date(), hour: z.number().int().min(0).max(23) };
const requestSchema = z.object({
  objective_id: z.uuid(),
  ...slot,
  message: z.string().trim().max(2000).nullable().optional(),
});
const availabilitySchema = z.object({
  days: z.array(z.iso.date()).min(1).max(62),
  available: z.boolean(),
});
const objectiveSchema = z.object({
  agent_role: z.enum(['screenhost_agent', 'screencast_agent']),
  label: z.string().trim().min(1).max(120),
  position: z.number().int().min(0).max(999).optional(),
});
const objectivePatch = z
  .object({
    label: z.string().trim().min(1).max(120),
    position: z.number().int().min(0).max(999),
    active: z.boolean(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Empty body');

const invalid = (reply: FastifyReply, issues: z.core.$ZodIssue[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

const SLOT_MESSAGES: Record<string, string> = {
  SLOT_TAKEN: 'Ce créneau n’est plus disponible.',
  DAY_UNAVAILABLE: 'Votre agent n’est pas disponible ce jour-là.',
  PAST_SLOT: 'Ce créneau est passé.',
  NOT_A_SLOT: 'Choisissez un créneau proposé.',
  NO_REFERENT: 'Aucun agent référent.',
  BAD_OBJECTIVE: 'Choisissez un objectif.',
  BAD_STATE: 'Ce rendez-vous a déjà été traité.',
  NOT_FOUND: 'Rendez-vous introuvable.',
};

const sendTransition = (reply: FastifyReply, r: TransitionResult) =>
  r.ok
    ? reply.status(200).send({ ok: true })
    : reply
        .status(r.error === 'NOT_FOUND' ? 404 : 409)
        .send({ error: r.error, message: SLOT_MESSAGES[r.error] ?? r.error });

const monthRange = (month: string) => {
  const from = `${month}-01`;
  return { from, to: format(addMonths(parseISO(from), 1), 'yyyy-MM-dd') };
};

export const agentAppointmentRoutes: FastifyPluginAsync = async (app) => {
  // ── affiliate side ──────────────────────────────────────────────────────────────────────

  // GET /api/appointments/referent — the referring agent (photo, first and last name) and the
  // reasons, or { agent: null } → the Toodooh team path.
  app.get('/api/appointments/referent', affiliateGuard, async (request, reply) => {
    const ref = await referentOf(request.user?.id ?? '');
    if (!ref)
      return reply.status(200).send({ agent: null, objectives: [], slot_hours: SLOT_HOURS });
    const [a] = await db.select().from(agents).where(eq(agents.userId, ref.agentUserId)).limit(1);
    const photo = a?.photoKey ? await storage.getPresignedUrl({ key: a.photoKey }) : null;
    return reply.status(200).send({
      agent: {
        id: ref.agentUserId,
        first_name: a?.firstName ?? null,
        last_name: a?.lastName ?? null,
        photo_url: photo && !('error' in photo) ? photo.url : null,
      },
      objectives: await objectivesFor(ref.agentRole),
      slot_hours: SLOT_HOURS,
    });
  });

  // GET /api/appointments/availability?month=YYYY-MM — the referent's unavailable days and
  // taken slots that month (never who holds them).
  app.get('/api/appointments/availability', affiliateGuard, async (request, reply) => {
    const q = monthQuery.safeParse(request.query ?? {});
    if (!q.success) return invalid(reply, q.error.issues);
    const ref = await referentOf(request.user?.id ?? '');
    if (!ref) return reply.status(404).send({ error: 'NO_REFERENT', message: 'No agent.' });
    const { from, to } = monthRange(q.data.month);
    return reply.status(200).send(await agentCalendar(ref.agentUserId, from, to));
  });

  // POST /api/appointments — « Prendre rendez-vous »: the request is En attente.
  app.post('/api/appointments', affiliateGuard, async (request, reply) => {
    const body = requestSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const r = await requestAppointment(request.user?.id ?? '', {
      objectiveId: body.data.objective_id,
      day: body.data.day,
      hour: body.data.hour,
      message: body.data.message?.trim() || null,
    });
    if (!r.ok) {
      return reply
        .status(r.error === 'NO_REFERENT' ? 404 : 409)
        .send({ error: r.error, message: SLOT_MESSAGES[r.error] ?? r.error });
    }
    return reply.status(201).send({ id: r.appointment.id, status: r.appointment.status });
  });

  // GET /api/appointments/mine — the affiliate's requests and their status.
  app.get('/api/appointments/mine', affiliateGuard, async (request, reply) => {
    return reply
      .status(200)
      .send({ appointments: await appointmentsOf('affilie', request.user?.id ?? '') });
  });

  // POST /api/appointments/:id/respond { accept } — answer the agent's counter-proposal.
  app.post('/api/appointments/:id/respond', affiliateGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const body = z.object({ accept: z.boolean() }).safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    return sendTransition(
      reply,
      await affiliateRespond(request.user?.id ?? '', params.data.id, body.data.accept),
    );
  });

  // POST /api/appointments/:id/cancel
  app.post('/api/appointments/:id/cancel', affiliateGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    return sendTransition(
      reply,
      await cancelAppointment('affilie', request.user?.id ?? '', params.data.id),
    );
  });

  // ── agent side ──────────────────────────────────────────────────────────────────────────

  // GET /api/agent/calendar?month=YYYY-MM — unavailable days and the month's appointment days.
  app.get('/api/agent/calendar', agentGuard, async (request, reply) => {
    const q = monthQuery.safeParse(request.query ?? {});
    if (!q.success) return invalid(reply, q.error.issues);
    const { from, to } = monthRange(q.data.month);
    const cal = await agentCalendar(request.user?.id ?? '', from, to);
    return reply.status(200).send({ unavailable: cal.unavailable, slot_hours: SLOT_HOURS });
  });

  // PUT /api/agent/availability { days, available } — immediate; past days are ignored.
  app.put('/api/agent/availability', agentGuard, async (request, reply) => {
    const body = availabilitySchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    return reply
      .status(200)
      .send(await setAvailability(request.user?.id ?? '', body.data.days, body.data.available));
  });

  // GET /api/agent/appointments — every appointment of the agent (À venir / Passés client-side).
  app.get('/api/agent/appointments', agentGuard, async (request, reply) => {
    return reply
      .status(200)
      .send({ appointments: await appointmentsOf('agent', request.user?.id ?? '') });
  });

  app.post('/api/agent/appointments/:id/accept', agentGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    return sendTransition(reply, await agentAccept(request.user?.id ?? '', params.data.id));
  });

  app.post('/api/agent/appointments/:id/propose', agentGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const body = z.object(slot).safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    return sendTransition(
      reply,
      await agentPropose(request.user?.id ?? '', params.data.id, body.data.day, body.data.hour),
    );
  });

  app.post('/api/agent/appointments/:id/cancel', agentGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    return sendTransition(
      reply,
      await cancelAppointment('agent', request.user?.id ?? '', params.data.id),
    );
  });

  // ── hub: the appointment reasons ───────────────────────────────────────────────────────

  app.get('/api/admin/agent-appointment-objectives', staffGuard, async (_request, reply) => {
    const rows = await db
      .select()
      .from(agentAppointmentObjectives)
      .orderBy(asc(agentAppointmentObjectives.agentRole), asc(agentAppointmentObjectives.position));
    return reply.status(200).send({
      objectives: rows.map((o) => ({
        id: o.id,
        agent_role: o.agentRole,
        label: o.label,
        position: o.position,
        active: o.active,
      })),
    });
  });

  app.post('/api/admin/agent-appointment-objectives', staffGuard, async (request, reply) => {
    const body = objectiveSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const [row] = await db
      .insert(agentAppointmentObjectives)
      .values({
        agentRole: body.data.agent_role,
        label: body.data.label,
        position: body.data.position ?? 50,
      })
      .returning();
    return reply.status(201).send({ id: row?.id });
  });

  app.patch('/api/admin/agent-appointment-objectives/:id', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const body = objectivePatch.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const done = await db
      .update(agentAppointmentObjectives)
      .set(body.data)
      .where(eq(agentAppointmentObjectives.id, params.data.id))
      .returning({ id: agentAppointmentObjectives.id });
    if (done.length === 0) return reply.status(404).send({ error: 'NOT_FOUND', message: '—' });
    return reply.status(200).send({ ok: true });
  });
};
