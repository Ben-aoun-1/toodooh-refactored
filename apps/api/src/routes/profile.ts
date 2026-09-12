import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { businessSectors, governorates, users } from '../db/schema.js';
import { snapshotBankState, writeBankAudit } from '../lib/bank-audit.js';
import { IBAN_ERROR, RIB_ERROR, validateIbanTn, validateRib } from '../lib/bank-validation.js';
import { requireAuth } from '../middleware/require-auth.js';
import { companySizeSchema } from '../validation/company-size.js';
import { validatePhone } from '../validation/phone.js';
import { normalizeTaxNumber, validateTaxNumber } from '../validation/tax-number.js';

// Section-scoped partial update of the authenticated user's business fields. All fields
// optional; at least one required (empty PATCH → 400). Deferred owner-extras
// (number_of_screens/number_of_rooms) are stripped by zod (.strip default) — the frontend sends
// them; we ignore, not error. `company_size` is STORED since SIZE-PERSIST1 (0069): one of the two
// scales' literals, or null to clear. role/status are NOT in this schema (admin-controlled).
const businessPatchSchema = z
  .object({
    business_name: z.string().min(1).max(200).optional(),
    // nullable: an owner can clear a matricule they don't have (audit §7.2); the
    // refine validates only non-null values (.nullable() short-circuits on null).
    tax_number: z
      .string()
      .refine(validateTaxNumber, 'Invalid tax number format')
      .nullable()
      .optional(),
    business_sector_id: z.uuid().optional(),
    business_type: z.enum(['local', 'national', 'agency', 'event_organizer']).optional(),
    company_size: companySizeSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

// Responsable sub-form (frontend-backend-contract §3.9). contact_name maps to better-auth's
// logical `name` (column contact_name); fonction is nullable (the FE sends `|| null`, no
// maxlength) — capped defensively. contact_phone reuses the signup E.164 validator (plan §2.7).
const contactPatchSchema = z
  .object({
    contact_name: z.string().min(1).max(100).optional(),
    contact_phone: z
      .string()
      .refine(validatePhone, 'Phone must be E.164 (e.g. +21612345678)')
      .optional(),
    fonction: z.string().max(100).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

// Adresse sub-form. postal_code mirrors the DB CHECK (^\d{4}$) for a clean 400 (plan §2.8);
// governorate_id is FK-pre-checked (plan §2.9); zone is free text, nullable (plan §2.1, §2.4).
const addressPatchSchema = z
  .object({
    street_address: z.string().min(1).max(300).optional(),
    city: z.string().min(1).max(100).optional(),
    postal_code: z
      .string()
      .regex(/^\d{4}$/, 'Postal code must be 4 digits')
      .optional(),
    governorate_id: z.uuid().optional(),
    zone: z.string().max(100).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

// Bank sub-form (QA-fix lane — migrated off the dead Supabase business_profiles surface).
// TN formats per the commit-1 ruling: RIB = exactly 20 digits; IBAN = "TN" + 22 digits
// (24 chars — the 2 check digits are NOT pinned). Fields stay optional; format applies
// when present. The bank document itself rides POST /api/profile/documents/bank.
const bankPatchSchema = z
  .object({
    bank_account_holder: z.string().min(1).max(200).optional(),
    // REV1 — the regexes moved to lib/bank-validation.ts (ONE home, shared with the unit matrix);
    // the French message is what the owner actually reads on « Mes Revenus ».
    bank_rib: z.string().refine(validateRib, RIB_ERROR).optional(),
    bank_iban: z.string().refine(validateIbanTn, IBAN_ERROR).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

// Notifications sub-form — the three notify_* booleans (columns shipped Commit 3).
const notificationsPatchSchema = z
  .object({
    notify_news_updates: z.boolean().optional(),
    notify_reminders_events: z.boolean().optional(),
    notify_promotions_offers: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.patch('/api/profile/business', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = businessPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;

    // Q3: pre-check the FK so a bad business_sector_id is a clean 400, not a DB FK
    // error surfacing as a 500 (mirrors signup's tax_number pre-check).
    if (data.business_sector_id !== undefined) {
      const [sector] = await db
        .select({ id: businessSectors.id })
        .from(businessSectors)
        .where(eq(businessSectors.id, data.business_sector_id))
        .limit(1);
      if (!sector) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'business_sector_id', reason: 'unknown business sector' }],
        });
      }
    }

    // Map snake_case wire → drizzle camelCase columns (only supplied keys).
    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.business_name !== undefined) patch.businessName = data.business_name;
    // SIGN-3 — INPUT only: a supplied matricule is validated + normalised; an ABSENT one is never
    // looked at, so editing any other field on a legacy profile is untouched by the new format.
    if (data.tax_number !== undefined) {
      patch.taxNumber = data.tax_number === null ? null : normalizeTaxNumber(data.tax_number);
    }
    if (data.business_sector_id !== undefined) patch.businessSectorId = data.business_sector_id;
    if (data.business_type !== undefined) patch.businessType = data.business_type;
    if (data.company_size !== undefined) patch.companySize = data.company_size;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      businessName: updated?.businessName ?? null,
      taxNumber: updated?.taxNumber ?? null,
      businessSectorId: updated?.businessSectorId ?? null,
      businessType: updated?.businessType ?? null,
      companySize: updated?.companySize ?? null,
    });
  });

  app.patch('/api/profile/contact', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = contactPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;
    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.contact_name !== undefined) patch.contactName = data.contact_name;
    if (data.contact_phone !== undefined) patch.contactPhone = data.contact_phone;
    if (data.fonction !== undefined) patch.fonction = data.fonction;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      contactName: updated?.contactName ?? null,
      contactPhone: updated?.contactPhone ?? null,
      fonction: updated?.fonction ?? null,
    });
  });

  app.patch('/api/profile/address', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = addressPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;

    // FK pre-check → clean 400 (Commit-3 Q3 pattern); governorate_id is required-when-present.
    if (data.governorate_id !== undefined) {
      const [gov] = await db
        .select({ id: governorates.id })
        .from(governorates)
        .where(eq(governorates.id, data.governorate_id))
        .limit(1);
      if (!gov) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'governorate_id', reason: 'unknown governorate' }],
        });
      }
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.street_address !== undefined) patch.streetAddress = data.street_address;
    if (data.city !== undefined) patch.city = data.city;
    if (data.postal_code !== undefined) patch.postalCode = data.postal_code;
    if (data.governorate_id !== undefined) patch.governorateId = data.governorate_id;
    if (data.zone !== undefined) patch.zone = data.zone;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      streetAddress: updated?.streetAddress ?? null,
      city: updated?.city ?? null,
      postalCode: updated?.postalCode ?? null,
      governorateId: updated?.governorateId ?? null,
      zone: updated?.zone ?? null,
    });
  });

  app.patch('/api/profile/notifications', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = notificationsPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;
    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.notify_news_updates !== undefined) patch.notifyNewsUpdates = data.notify_news_updates;
    if (data.notify_reminders_events !== undefined)
      patch.notifyRemindersEvents = data.notify_reminders_events;
    if (data.notify_promotions_offers !== undefined)
      patch.notifyPromotionsOffers = data.notify_promotions_offers;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      notifyNewsUpdates: updated?.notifyNewsUpdates ?? null,
      notifyRemindersEvents: updated?.notifyRemindersEvents ?? null,
      notifyPromotionsOffers: updated?.notifyPromotionsOffers ?? null,
    });
  });

  app.patch('/api/profile/bank', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = bankPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;
    const patch: Partial<typeof users.$inferInsert> = {
      // Server-stamped audit marker (money-adjacent) — never a client-supplied timestamp.
      // It answers WHEN; user_bank_details_audit (REV1) answers WHAT and BY WHOM.
      bankDetailsUpdatedAt: new Date(),
    };
    if (data.bank_account_holder !== undefined) patch.bankAccountHolder = data.bank_account_holder;
    if (data.bank_rib !== undefined) patch.bankRib = data.bank_rib;
    if (data.bank_iban !== undefined) patch.bankIban = data.bank_iban;

    // REV1 — snapshot, write, snapshot, audit, in ONE transaction: an audit row that could be lost
    // while the coordinates moved would be worse than no trail at all, because it would read as
    // "never changed". The document id is untouched here; it rides the upload route's own audit.
    const updated = await db.transaction(async (tx) => {
      const before = await snapshotBankState(tx, userId);
      const [row] = await tx.update(users).set(patch).where(eq(users.id, userId)).returning();
      const after = await snapshotBankState(tx, userId);
      await writeBankAudit(tx, { userId, changedBy: userId, before, after });
      return row;
    });

    return reply.status(200).send({
      bankAccountHolder: updated?.bankAccountHolder ?? null,
      bankRib: updated?.bankRib ?? null,
      bankIban: updated?.bankIban ?? null,
    });
  });

  // POST /api/profile/resubmit — N3 Scenario 1 completion. A REJECTED account corrects its documents
  // (via the existing /api/profile/documents + /api/profile/bank surfaces, both requireAuth-only) and
  // resubmits for review. Allowed ONLY when the account is currently rejected — checked against the DB,
  // not the session token (which could be stale). Returns to a PRISTINE pending: the whole validation
  // trio (validatedBy/validatedAt/validationNotes) + rejectionTopics are cleared so re-review starts
  // fresh. A non-rejected caller is a 409 no-op (idempotent-safe). onboarding_completed is untouched.
  app.post('/api/profile/resubmit', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [existing] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!existing) {
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Account lookup failed.' });
    }
    if (existing.status !== 'rejected') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Only a rejected account can be resubmitted for review.',
        statusCode: 409,
        requestId: request.id,
        currentStatus: existing.status,
      });
    }
    const [updated] = await db
      .update(users)
      .set({
        status: 'pending',
        validatedBy: null,
        validatedAt: null,
        validationNotes: null,
        rejectionTopics: null,
      })
      .where(eq(users.id, userId))
      .returning();
    return reply.status(200).send({ status: updated?.status ?? 'pending' });
  });
};
