import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import { accounts, agentReferrals, agents, users } from '../db/schema.js';
import { env } from '../env.js';
import { PROFILE_TYPES, fromProfileType } from '../lib/profile-type.js';
import { validatePhone } from '../validation/phone.js';
import { validateTaxNumber } from '../validation/tax-number.js';

// snake_case request shape (apps/web-facing per Decision 3) — the full signup wizard profile
// (Phase 1e Commit 2 grow). role/status are NOT accepted: zod strips unknown keys and better-auth's
// input:false drops them, so they default server-side (advertiser/pending). profile_type is a
// non-privileged hint mapped to role post-create (CF-24 class-b). Required = the minimal account
// identity + terms; the rest of the profile is optional and stored when present (kept lenient to
// decouple from the reference-data-GET ordering and avoid FK-500s on partial data).
const signupBodySchema = z.object({
  email: z.email('A valid email is required'),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  contact_name: z.string().min(1).max(100),
  business_name: z.string().min(1).max(200),
  contact_phone: z.string().refine(validatePhone, 'Phone must be E.164 (e.g. +21612345678)'),
  terms_accepted: z.literal(true, { error: 'Terms must be accepted' }),
  tax_number: z.string().refine(validateTaxNumber, 'Invalid tax number format').optional(),
  profile_type: z.enum(PROFILE_TYPES).optional(),
  business_type: z.string().min(1).optional(),
  business_sector_id: z.uuid().optional(),
  street_address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  postal_code: z
    .string()
    .regex(/^\d{4}$/, 'Postal code must be 4 digits')
    .optional(),
  governorate_id: z.uuid().optional(),
  fonction: z.string().optional(),
  zone: z.string().optional(),
  agent_toodooh: z.string().optional(),
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
    const {
      email,
      password,
      contact_name,
      business_name,
      contact_phone,
      tax_number,
      profile_type,
      business_type,
      business_sector_id,
      street_address,
      city,
      postal_code,
      governorate_id,
      fonction,
      zone,
      agent_toodooh,
    } = parsed.data;
    // terms_accepted is enforced `true` by the schema (z.literal); the acceptance time is
    // server-stamped below, never taken from the client.

    // tax_number is ours (UNIQUE) — pre-check for a clean 409, but ONLY when provided: it is
    // optional now (owners have no matricule at signup) and the nullable UNIQUE column allows many
    // nulls. (Email dupes are masked by anti-enumeration → generic 201, no EMAIL_TAKEN.)
    if (tax_number) {
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
    }

    try {
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name: contact_name,
          businessName: business_name,
          contactPhone: contact_phone,
          ...(tax_number ? { taxNumber: tax_number } : {}),
          // Post-verify redirect target (Phase-1f F3). Absolute → passes better-auth's
          // originCheck (WEB_ORIGIN is trusted); the FE /verify-email page reads ?error=.
          callbackURL: `${env.WEB_ORIGIN}/verify-email`,
        },
      });

      // Write the rest of the profile + the mapped role in ONE post-create update. role is
      // input:false (server-controlled), so it can't ride signUpEmail input; profile_type (a
      // validated, non-privileged hint) maps to it here. DUPLICATE-SAFE: on a duplicate email
      // better-auth returns a SYNTHETIC, non-persisted user (anti-enumeration) whose id is not in
      // the DB — and is not even a uuid, so `where id = result.user.id` would THROW on the uuid cast
      // rather than no-op. So re-fetch by email and apply the write only when the persisted row's id
      // matches the returned id: a duplicate's synthetic id won't match, so the existing account is
      // left untouched (verified by the duplicate-no-op test).
      const [persisted] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      if (persisted && persisted.id === result.user.id) {
        const updates: Partial<typeof users.$inferInsert> = { termsAcceptedAt: new Date() };
        if (profile_type) {
          const { role, businessTypeOverride } = fromProfileType(profile_type);
          updates.role = role;
          if (businessTypeOverride) updates.businessType = businessTypeOverride;
        }
        if (business_type && updates.businessType === undefined)
          updates.businessType = business_type;
        if (business_sector_id !== undefined) updates.businessSectorId = business_sector_id;
        if (street_address !== undefined) updates.streetAddress = street_address;
        if (city !== undefined) updates.city = city;
        if (postal_code !== undefined) updates.postalCode = postal_code;
        if (governorate_id !== undefined) updates.governorateId = governorate_id;
        if (fonction !== undefined) updates.fonction = fonction;
        if (zone !== undefined) updates.zone = zone;
        if (agent_toodooh !== undefined) updates.agentCode = agent_toodooh;
        await db.update(users).set(updates).where(eq(users.id, persisted.id));

        // Agent referral linkage (P1 Commit 3). Resolve the entered code (trim+uppercase) against
        // agents.code; on a ROLE-COMPATIBLE match, normalize the link into agent_referrals. The
        // raw `users.agent_code` write above still happens regardless — agent_referrals is the
        // structured attribution, agent_code is the raw audit field. A non-match or an
        // incompatible role links NOTHING (signup still 201). Absent agent_toodooh → no lookup.
        // This sits INSIDE the synthetic-id guard, so a duplicate-email signup never links.
        if (agent_toodooh !== undefined) {
          const resolvedCode = agent_toodooh.trim().toUpperCase();
          const [agent] = await db
            .select({ agentUserId: agents.userId, agentRole: users.role })
            .from(agents)
            .innerJoin(users, eq(users.id, agents.userId))
            .where(eq(agents.code, resolvedCode))
            .limit(1);
          if (agent) {
            // The referred user's MAPPED role (server-controlled): profile_type maps via
            // fromProfileType; absent profile_type defaults to advertiser (the DB default applied
            // above). screenhost_agent ↔ individual_owner/fleet_owner; screencast_agent ↔
            // advertiser (which subsumes 'agency' = advertiser + business_type='agency').
            const referredRole = profile_type ? fromProfileType(profile_type).role : 'advertiser';
            const compatible =
              (agent.agentRole === 'screenhost_agent' &&
                (referredRole === 'individual_owner' || referredRole === 'fleet_owner')) ||
              (agent.agentRole === 'screencast_agent' && referredRole === 'advertiser');
            if (compatible) {
              await db.insert(agentReferrals).values({
                agentUserId: agent.agentUserId,
                referredUserId: persisted.id,
                agentCodeUsed: agent_toodooh, // raw entered value (audit trail, pre-normalization)
              });
            }
          }
        }
      }

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
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again.',
      });
    }
  });
};
