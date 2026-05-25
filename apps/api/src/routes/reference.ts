import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { businessSectors, governorates } from '../db/schema.js';

// Public reference-data reads — NO requireAuth. The signup wizard fetches these before any session
// exists (pre-auth), and they are non-sensitive public catalog data. Seeded tables → JSON, shaped to
// exactly what the frontend consumes (CF-24); createdAt is internal and omitted.
const audienceQuerySchema = z.object({
  audience: z.enum(['advertiser', 'owner']).optional(),
});

export const referenceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/governorates', async (_request, reply) => {
    const rows = await db
      .select({ id: governorates.id, name: governorates.name })
      .from(governorates)
      .orderBy(asc(governorates.name));
    return reply.status(200).send(rows);
  });

  // ?audience=advertiser|owner (optional) filters by the Phase-1c audience discriminator — the
  // §5.3 owner_business_sectors collapse, finally consumed. Omitted → all sectors. The audience
  // field is always returned so the client can also filter/inspect.
  app.get('/api/business-sectors', async (request, reply) => {
    const parsed = audienceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'audience must be advertiser or owner',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { audience } = parsed.data;
    const rows = await db
      .select({
        id: businessSectors.id,
        name: businessSectors.name,
        audience: businessSectors.audience,
        display_order: businessSectors.displayOrder,
      })
      .from(businessSectors)
      .where(audience ? eq(businessSectors.audience, audience) : undefined)
      .orderBy(asc(businessSectors.displayOrder));
    return reply.status(200).send(rows);
  });
};
