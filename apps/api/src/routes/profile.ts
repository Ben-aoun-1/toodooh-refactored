import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { businessSectors, governorates, users } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validatePhone } from '../validation/phone.js';
import { validateTaxNumber } from '../validation/tax-number.js';

// Section-scoped partial update of the authenticated user's business fields. All fields
// optional; at least one required (empty PATCH → 400). Deferred owner-extras
// (number_of_screens/number_of_rooms/company_size) are stripped by zod (.strip default) —
// the frontend sends them; we ignore, not error. role/status are NOT in this schema
// (admin-controlled, Phase 1f).
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
    if (data.tax_number !== undefined) patch.taxNumber = data.tax_number;
    if (data.business_sector_id !== undefined) patch.businessSectorId = data.business_sector_id;
    if (data.business_type !== undefined) patch.businessType = data.business_type;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      businessName: updated?.businessName ?? null,
      taxNumber: updated?.taxNumber ?? null,
      businessSectorId: updated?.businessSectorId ?? null,
      businessType: updated?.businessType ?? null,
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
};
