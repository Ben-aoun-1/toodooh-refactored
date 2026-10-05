import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { emailSender } from '../auth/auth.js';
import { env } from '../env.js';
import { clientIp } from '../lib/client-ip.js';
import { contactEmail, contactFieldsSchema } from '../lib/contact-message.js';

// LAND-FB1 — POST /api/contact: the landing's contact form and « Prendre rendez-vous » requests,
// emailed to CONTACT_MAILBOX with the visitor as reply-to. Public, so rate-limited per visitor;
// the recipient is never taken from the request (lib/contact-message).

const MAX_PER_HOUR = 5;

export const contactRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: MAX_PER_HOUR,
    timeWindow: '1 hour',
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Trop de messages envoyés. Réessayez plus tard.',
    }),
  });

  app.post('/api/contact', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const parsed = contactFieldsSchema.safeParse(request.body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? 'form');
      const message = 'Champ manquant ou invalide.';
      return reply
        .status(400)
        .send({ error: 'INVALID_INPUT', message, fields: [{ field, reason: message }] });
    }

    const mail = contactEmail(parsed.data);
    const result = await emailSender.send({
      to: env.CONTACT_MAILBOX,
      replyTo: parsed.data.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if ('error' in result) {
      request.log.warn({ error: result.error }, 'contact email failed');
      return reply
        .status(502)
        .send({ error: 'EMAIL_FAILED', message: 'L’envoi n’a pas abouti. Réessayez plus tard.' });
    }
    return reply.status(201).send({ ok: true });
  });
};
