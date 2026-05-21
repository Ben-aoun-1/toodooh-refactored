import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import { accounts, users } from '../db/schema.js';
import { validatePhone } from '../validation/phone.js';
import { validateTaxNumber } from '../validation/tax-number.js';

// snake_case request shape (apps/web-facing per Decision 3). role/status are
// NOT accepted — zod strips unknown keys and better-auth's input:false drops
// them anyway, so they default server-side (advertiser/pending).
const signupBodySchema = z.object({
  email: z.email('A valid email is required'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  name: z.string().min(1).max(100),
  business_name: z.string().min(1).max(200),
  contact_phone: z.string().refine(validatePhone, 'Phone must be E.164 (e.g. +21612345678)'),
  tax_number: z.string().refine(validateTaxNumber, 'Invalid tax number format'),
});

// Q4 — better-auth's signup is sequential, not atomic (createUser → linkAccount
// → verification are separate calls; no injectable tx). If linkAccount throws
// after createUser, an orphan user (no credential account) can remain. Best-
// effort cleanup; the `if (acct) return` guard means a real (account-backed)
// user is never deleted, and the anti-enumeration duplicate path never reaches
// the catch (it returns success). The caller guards this so it never masks the
// original error.
const deleteOrphanUser = async (email: string): Promise<void> => {
  const normalized = email.toLowerCase();
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (!u) return;
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, u.id))
    .limit(1);
  if (acct) return; // account-backed → real user, not an orphan
  await db.delete(users).where(eq(users.id, u.id));
};

export const signupRoute: FastifyPluginAsync = async (app) => {
  app.post('/api/signup', async (request, reply) => {
    const parsed = signupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { email, password, name, business_name, contact_phone, tax_number } = parsed.data;

    // tax_number is ours (UNIQUE) — pre-check for a clean 409. (Email dupes are
    // masked by better-auth's anti-enumeration defense, so there is no
    // EMAIL_TAKEN: a duplicate email returns a generic 201, Q1.)
    const taxOwner = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.taxNumber, tax_number))
      .limit(1);
    if (taxOwner.length > 0) {
      return reply.status(409).send({
        error: 'TAX_NUMBER_TAKEN',
        message: 'A business with this tax number is already registered.',
        fields: [{ field: 'tax_number', reason: 'already registered' }],
      });
    }

    try {
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
          businessName: business_name,
          contactPhone: contact_phone,
          taxNumber: tax_number,
        },
      });
      return reply.status(201).send({
        userId: result.user.id,
        email: result.user.email,
        verificationRequired: true,
        message: 'Account created. Please check your email to verify your address.',
      });
    } catch (err) {
      // Best-effort orphan cleanup (Q4); guarded so it never masks `err`.
      await deleteOrphanUser(email).catch(() => undefined);
      if (err instanceof APIError) {
        // We pre-validated, so this is rare (e.g. a better-auth-side rule).
        return reply.status(400).send({ error: 'INVALID_INPUT', message: err.message, fields: [] });
      }
      request.log.error(err, 'signup failed');
      return reply
        .status(500)
        .send({
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred. Please try again.',
        });
    }
  });
};
