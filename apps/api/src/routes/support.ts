import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { emailSender } from '../auth/auth.js';
import { db } from '../db/client.js';
import { supportMessages } from '../db/schema.js';
import { env } from '../env.js';
import { accountLabel, notifyAdmins } from '../lib/admin-notifications.js';
import { requireAuth } from '../middleware/require-auth.js';

// SUP-1 (Mejri 11/09 point 8) — POST /api/support: the « Support » and « Prendre rendez-vous »
// forms finally land somewhere. Any authenticated role (advertiser, owner, agent). The row is the
// record; the admin bell (admin_support_message) is the alert; a copy goes to SUPPORT_MAILBOX when
// ops have created it (best effort, never fails the 201).

const bodySchema = z
  .object({
    kind: z.enum(['support', 'appointment']),
    objective: z.string().trim().min(1).max(120),
    other_detail: z.string().trim().max(500).optional(),
    message: z.string().trim().max(2000).optional(),
    appointment_date: z.iso.date().optional(),
  })
  .refine((b) => b.objective.toLowerCase() !== 'autre' || (b.other_detail ?? '').length > 0, {
    message: 'other_detail is required when the objective is « Autre »',
    path: ['other_detail'],
  })
  .refine((b) => (b.kind === 'appointment') === (b.appointment_date !== undefined), {
    message: 'appointment_date is required for an appointment and forbidden otherwise',
    path: ['appointment_date'],
  });

export const supportRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/support', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({
          field: i.path.join('.') || 'body',
          reason: i.message,
        })),
      });
    }
    const b = parsed.data;
    const [row] = await db
      .insert(supportMessages)
      .values({
        userId,
        kind: b.kind,
        objective: b.objective,
        otherDetail: b.other_detail ?? null,
        message: b.message || null,
        appointmentDate: b.appointment_date ?? null,
      })
      .returning();
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Enregistrement impossible.' });
    }

    const who = await accountLabel(userId);
    const isAppointment = b.kind === 'appointment';
    await notifyAdmins(db, {
      type: 'admin_support_message',
      title: isAppointment ? 'Nouvelle demande de rendez-vous' : 'Nouveau message au support',
      body: isAppointment
        ? `${who} souhaite un rendez-vous le ${b.appointment_date} (${b.objective}).`
        : `${who} a écrit au support (${b.objective}).`,
    }).catch((err: unknown) => request.log.warn({ err }, 'admin notice failed (support)'));

    if (env.SUPPORT_MAILBOX) {
      const text = [
        `De : ${who} (user ${userId})`,
        `Type : ${isAppointment ? 'rendez-vous' : 'support'}`,
        `Objectif : ${b.objective}${b.other_detail ? ` — ${b.other_detail}` : ''}`,
        isAppointment ? `Date souhaitée : ${b.appointment_date}` : null,
        '',
        b.message || '(sans message)',
      ]
        .filter((l): l is string => l !== null)
        .join('\n');
      const result = await emailSender.send({
        to: env.SUPPORT_MAILBOX,
        subject: `[Toodooh support] ${isAppointment ? 'Rendez-vous' : 'Message'} — ${b.objective}`,
        html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${text.replace(/</g, '&lt;')}</pre>`,
        text,
      });
      if ('error' in result)
        request.log.warn({ error: result.error }, 'support mailbox copy failed');
    }

    return reply
      .status(201)
      .send({
        id: row.id,
        kind: row.kind,
        status: row.status,
        created_at: row.createdAt.toISOString(),
      });
  });
};
