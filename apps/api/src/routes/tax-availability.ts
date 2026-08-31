import rateLimit from '@fastify/rate-limit';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { normalizeTaxNumber, validateTaxNumber } from '../validation/tax-number.js';

// Signup-wizard tax-number (matricule fiscal) pre-check (Kais QA3). Same shape and ruling as
// email-availability: the wizard may tell the user outright whether a matricule is already
// registered so the collision surfaces BEFORE the last step (Kais: "Contrôle Matricule fiscal
// doit se faire avant la dernière étape") instead of as a transient toast at submit. A matricule
// is semi-public business data and the control is explicitly requested, so revealing "taken" is
// accepted; the endpoint stays rate-limited so bulk harvesting remains expensive.
//
// The lookup MUST agree with the signup route's 409 pre-check so the inline verdict and the submit
// verdict never disagree — both now compare the NORMALISED value (SIGN-3). Comparing raw spellings
// let the same matricule slip past this check under different separators: `1234567/A/M/M/000` and
// `1234567AMM000` are one matricule, and signup stores the canonical form.

const MAX_PER_MINUTE = 10;

const bodySchema = z.object({
  tax_number: z.string().refine(validateTaxNumber, 'Invalid tax number format'),
});

export const taxAvailabilityRoute: FastifyPluginAsync = async (app) => {
  // Registered inside this plugin so the per-IP limiter hooks stay within this encapsulation
  // context (rate-limits ONLY this route), mirroring email-availability exactly. In-memory store:
  // per instance, resets on restart — fine for a wizard pre-check, not an auth gate.
  await app.register(rateLimit, {
    max: MAX_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Trop de tentatives. Réessayez dans une minute.',
    }),
  });

  app.post('/api/signup/tax-availability', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.taxNumber, normalizeTaxNumber(parsed.data.tax_number)))
      .limit(1);

    return reply.status(200).send({ available: !row });
  });
};
