import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../db/client.js';
import { zones } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';

// CF-Z1 — the predefined-zones read the campaign wizard consumes (V1: exactly « Grand Tunis »,
// seeded by mig 0040). Read-only + authenticated: zone administration is a later surface (the
// legacy predefined_zones admin CRUD is a SEPARATE Supabase-era table, untouched here).
export const zonesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/zones', { preHandler: [requireAuth] }, async (_request, reply) => {
    const rows = await db
      .select({ id: zones.id, name: zones.name })
      .from(zones)
      .where(eq(zones.active, true))
      .orderBy(asc(zones.name));
    return reply.status(200).send(rows);
  });
};
