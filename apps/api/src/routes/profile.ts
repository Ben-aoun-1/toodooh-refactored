import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { businessSectors, users } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';
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
};
