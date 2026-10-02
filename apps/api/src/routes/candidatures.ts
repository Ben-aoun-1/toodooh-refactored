import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import { emailSender } from '../auth/auth.js';
import { env } from '../env.js';
import {
  CANDIDATURE_MAX_CV_BYTES,
  candidatureEmail,
  candidatureFieldsSchema,
  cvFilename,
  cvMime,
  sniffCv,
} from '../lib/candidature.js';
import { clientIp } from '../lib/client-ip.js';

// NEWLANDING-1 (ruling 2A) — POST /api/candidatures: the landing's « Carrières » application forms.
// multipart: the text fields + ONE `cv` file (PDF/Word ≤ 5 MB, type sniffed from its bytes). The
// application is emailed with the CV attached to HR_MAILBOX; nothing is stored. Public, so it is
// rate-limited per visitor and the recipient is never taken from the request (lib/candidature).

const MAX_PER_HOUR = 5;
const MAX_FIELD_BYTES = 6000;

const invalid = (field: string, message: string) => ({
  error: 'INVALID_INPUT',
  message,
  fields: [{ field, reason: message }],
});

export const candidaturesRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: MAX_PER_HOUR,
    timeWindow: '1 hour',
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Trop de candidatures envoyées. Réessayez plus tard.',
    }),
  });
  await app.register(multipart, {
    limits: {
      fileSize: CANDIDATURE_MAX_CV_BYTES,
      files: 1,
      fields: 12,
      fieldSize: MAX_FIELD_BYTES,
    },
  });

  app.post('/api/candidatures', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply
        .status(415)
        .send({ error: 'UNSUPPORTED_MEDIA_TYPE', message: 'multipart attendu.' });
    }
    const fields: Record<string, string> = {};
    let cv: { bytes: Buffer; filename: string } | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'cv') {
            await part.toBuffer();
            continue;
          }
          const bytes = await part.toBuffer(); // throws past the fileSize limit
          cv = { bytes, filename: part.filename };
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }
    } catch {
      return reply.status(413).send(invalid('cv', 'Le CV dépasse 5 Mo.'));
    }

    const parsed = candidatureFieldsSchema.safeParse(fields);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? 'form');
      return reply.status(400).send(invalid(field, 'Champ manquant ou invalide.'));
    }
    if (!cv || cv.bytes.length === 0)
      return reply.status(400).send(invalid('cv', 'Ajoutez votre CV.'));
    const kind = sniffCv(cv.bytes, cv.filename);
    if (!kind) {
      return reply.status(400).send(invalid('cv', 'Le CV doit être au format PDF ou Word.'));
    }

    const mail = candidatureEmail(parsed.data);
    const result = await emailSender.send({
      to: env.HR_MAILBOX,
      replyTo: parsed.data.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [
        {
          filename: cvFilename(parsed.data.name, kind),
          content: cv.bytes,
          contentType: cvMime(kind),
        },
      ],
    });
    if ('error' in result) {
      request.log.warn({ error: result.error }, 'candidature email failed');
      return reply
        .status(502)
        .send({ error: 'EMAIL_FAILED', message: 'L’envoi n’a pas abouti. Réessayez plus tard.' });
    }
    return reply.status(201).send({ ok: true });
  });
};
