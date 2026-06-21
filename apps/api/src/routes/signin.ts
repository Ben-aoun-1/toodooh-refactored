import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { toProfileType } from '../lib/profile-type.js';
import { requireAuth } from '../middleware/require-auth.js';

const signinBodySchema = z.object({
  email: z.email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

// better-auth's signInEmail/signOut set/clear the session cookie via setSessionCookie/
// deleteSessionCookie; with returnHeaders:true the Set-Cookie comes back on `headers`. Forward
// each cookie onto the Fastify reply (getSetCookie returns the array — avoids the Headers.forEach
// comma-join footgun for multiple cookies).
const forwardSetCookie = (reply: FastifyReply, headers: Headers): void => {
  for (const cookie of headers.getSetCookie()) void reply.header('set-cookie', cookie);
};

export const signinRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/signin', async (request, reply) => {
    const parsed = signinBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { email, password } = parsed.data;

    // Local fn so Awaited<ReturnType<...>> captures the returnHeaders:true overload shape.
    const signIn = () =>
      auth.api.signInEmail({
        body: { email, password },
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
    let result: Awaited<ReturnType<typeof signIn>>;
    try {
      result = await signIn();
    } catch (err) {
      if (err instanceof APIError) {
        if (err.statusCode === 403) {
          return reply.status(403).send({
            error: 'EMAIL_NOT_VERIFIED',
            message: 'Please verify your email address before signing in.',
          });
        }
        // 401 INVALID_EMAIL_OR_PASSWORD — generic; wrong email and wrong password are identical
        // (no enumeration). Rare internal auth failures fold here too (don't leak internals).
        return reply.status(401).send({
          error: 'INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect.',
        });
      }
      request.log.error(err, 'signin failed');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again.',
      });
    }

    forwardSetCookie(reply, result.headers);

    // businessType + onboardingCompleted are columns, not better-auth additionalFields, so they
    // are not on result.response.user — read the full routing set from the users row (§2.4).
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        validationNotes: users.validationNotes,
        onboardingCompleted: users.onboardingCompleted,
        businessType: users.businessType,
        contactName: users.contactName,
      })
      .from(users)
      .where(eq(users.id, result.response.user.id))
      .limit(1);
    if (!row) {
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Account lookup failed.' });
    }

    return reply.status(200).send({
      user: {
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        // N3: the rejection reason rides the signin response so the FE status screen can show it
        // immediately on login (rejection gates the app, not authentication).
        validation_notes: row.validationNotes,
        onboarding_completed: row.onboardingCompleted,
        business_type: row.businessType,
        profile_type: toProfileType(row.role, row.businessType),
        contact_name: row.contactName,
      },
    });
  });

  app.post('/api/signout', { preHandler: requireAuth }, async (request, reply) => {
    const result = await auth.api.signOut({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    forwardSetCookie(reply, result.headers);
    return reply.status(200).send({ success: true });
  });
};
