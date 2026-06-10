import rateLimit from '@fastify/rate-limit';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';

// Signup-wizard email pre-check (QA-fix lane). Product ruling 2026-06-10 REVERSED the
// anti-enumeration stance for THIS surface only: the wizard may tell the user outright
// whether an email is already registered (the enumeration risk is accepted), but the
// endpoint stays rate-limited so bulk harvesting remains expensive. The resend/reset
// flows keep their anti-enumeration behavior — do not generalize from this endpoint.
//
// Normalization matches better-auth + the signup route: email.toLowerCase()
// (signup.ts deleteOrphanUser / admin-accounts.ts both treat lowercase as canonical).

const MAX_PER_MINUTE = 10;

const bodySchema = z.object({ email: z.email('A valid email is required') });

export const emailAvailabilityRoute: FastifyPluginAsync = async (app) => {
  // Registered inside this plugin so the per-IP limiter hooks stay within this
  // encapsulation context (rate-limits ONLY this route — the same self-contained
  // registration pattern as profile-documents' multipart). In-memory store: per
  // instance, resets on restart — fine for a wizard pre-check, not an auth gate.
  await app.register(rateLimit, {
    max: MAX_PER_MINUTE,
    timeWindow: '1 minute',
    // Project error shape ({ error: CODE, message }), not the plugin default. statusCode
    // is REQUIRED here — the plugin reads it off the built payload for the reply status.
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Trop de tentatives. Réessayez dans une minute.',
    }),
  });

  app.post('/api/signup/email-availability', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const normalized = parsed.data.email.toLowerCase();
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);

    return reply.status(200).send({ available: !row });
  });
};
