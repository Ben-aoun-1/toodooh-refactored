import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Establishment, establishments, governorates } from '../db/schema.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

// Slice-2 E — screenhost_agent establishment write. requireRole('screenhost_agent') reuses the A
// gate factory; admin/superadmin create AGENTS (slice A) but do NOT create establishments here. POST
// + own-list GET only (no edit/deactivate yet). No screens/affluence/sensors (all deferred).
const agentGuard = { preHandler: [requireAuth, requireRole('screenhost_agent')] };

// Drizzle serializes a `numeric` column as a STRING → Number() lat/lng so consumers get numbers (the
// wizard does Haversine/Leaflet math), mirroring predefined-zones' toZoneRow. camelCase → snake_case
// wire; only the establishment's own fields are exposed (created_by/screenhost_id are bare ids — no
// joined user details).
const toEstablishmentRow = (row: Establishment) => ({
  id: row.id,
  name: row.name,
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  screen_count: row.screenCount,
  address: row.address,
  city: row.city,
  governorate_id: row.governorateId,
  zone: row.zone,
  is_active: row.isActive,
  created_by: row.createdBy,
  screenhost_id: row.screenhostId,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

// snake_case wire. lat/lng arrive as JSON numbers, range-validated here (ruling 5: global range, no
// Tunisia bound, no dedup); the numeric columns store them as strings (String() at the Drizzle
// boundary). screen_count is free metadata, NOT screens rows — the route requires >= 1 (ruling 6).
const createBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  screen_count: z.number().int().min(1),
  address: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  governorate_id: z.uuid().optional(),
  zone: z.string().trim().min(1).optional(),
});

const invalidInput = (reply: FastifyReply, requestId: string, issues: z.ZodIssue[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    statusCode: 400,
    requestId,
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

export const establishmentsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/establishments — a screenhost_agent registers one establishment (coordinate dot +
  // screen_count metadata). Server-owned: created_by = session agent, is_active defaults true,
  // screenhost_id stays null (E neither creates nor links screenhost accounts).
  app.post('/api/establishments', agentGuard, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply, request.id, parsed.error.issues);

    const agentId = request.user?.id;
    if (!agentId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const b = parsed.data;

    // FK pre-check: a well-formed-but-unknown governorate_id → a clean 400 (not a 500 FK violation).
    if (b.governorate_id !== undefined) {
      const [gov] = await db
        .select({ id: governorates.id })
        .from(governorates)
        .where(eq(governorates.id, b.governorate_id))
        .limit(1);
      if (!gov) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          statusCode: 400,
          requestId: request.id,
          fields: [{ field: 'governorate_id', reason: 'unknown governorate' }],
        });
      }
    }

    const [created] = await db
      .insert(establishments)
      .values({
        name: b.name,
        latitude: String(b.latitude),
        longitude: String(b.longitude),
        screenCount: b.screen_count,
        address: b.address ?? null,
        city: b.city ?? null,
        governorateId: b.governorate_id ?? null,
        zone: b.zone ?? null,
        createdBy: agentId,
      })
      .returning();

    return reply.status(201).send({ establishment: toEstablishmentRow(created as Establishment) });
  });

  // GET /api/establishments — the acting agent's OWN establishments, newest first. Scoped to
  // created_by = session user, so an agent never sees another agent's rows.
  app.get('/api/establishments', agentGuard, async (request, reply) => {
    const agentId = request.user?.id;
    if (!agentId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const rows = await db
      .select()
      .from(establishments)
      .where(eq(establishments.createdBy, agentId))
      .orderBy(desc(establishments.createdAt));
    return reply.status(200).send({ establishments: rows.map(toEstablishmentRow) });
  });
};
