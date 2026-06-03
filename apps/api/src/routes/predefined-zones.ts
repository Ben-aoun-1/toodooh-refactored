import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type NewPredefinedZone, type PredefinedZone, predefinedZones } from '../db/schema.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Z1 — predefined_zones cutover (reads + the 4 scalar writes). Image upload (image_url storage)
// is Z2. Reads are public (the campaign wizard fetches the catalog post-login, the admin page too —
// same non-sensitive catalog character as the reference reads); writes are admin-guarded.
const adminGuard = { preHandler: [requireAuth, requireAdmin] };

// SERIALIZER (mandatory — mirrors admin.ts toAdminUserView). Drizzle serializes a `numeric` column
// as a STRING; the wizard does Haversine + Leaflet-circle math expecting NUMBERS, so latitude/
// longitude are Number()'d here, endpoint-side. radius is an integer column → already a number,
// passes through. camelCase Drizzle props → the snake_case keys the PredefinedZone interface wants.
const toZoneRow = (row: PredefinedZone) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  radius: row.radius,
  is_active: row.isActive,
  image_url: row.imageUrl,
  is_hot: row.isHot,
  country: row.country,
  region: row.region,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const idParamSchema = z.object({ id: z.uuid() });

// Frontend shape (snake_case). latitude/longitude arrive as JSON numbers; the numeric columns store
// them as strings (String() at the Drizzle boundary), the inverse of toZoneRow's Number().
const createBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  latitude: z.number(),
  longitude: z.number(),
  radius: z.number().int().nonnegative(),
  is_active: z.boolean().optional(),
  image_url: z.string().nullish(),
  is_hot: z.boolean().optional(),
  country: z.string().nullish(),
  region: z.string().nullish(),
});
const updateBodySchema = createBodySchema.partial();
const activeBodySchema = z.object({ is_active: z.boolean() });

type CreateBody = z.infer<typeof createBodySchema>;
type UpdateBody = z.infer<typeof updateBodySchema>;

const invalidInput = (reply: FastifyReply, requestId: string, issues: z.ZodIssue[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    statusCode: 400,
    requestId,
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

// CreateBody → Drizzle insert: camelCase keys, lat/lng to string, defaulted notNull columns
// (isActive/isHot/country) omitted when not supplied so the DB default applies.
const toInsertValues = (b: CreateBody): NewPredefinedZone => ({
  name: b.name,
  description: b.description ?? null,
  latitude: String(b.latitude),
  longitude: String(b.longitude),
  radius: b.radius,
  imageUrl: b.image_url ?? null,
  region: b.region ?? null,
  ...(b.is_active !== undefined ? { isActive: b.is_active } : {}),
  ...(b.is_hot !== undefined ? { isHot: b.is_hot } : {}),
  ...(b.country != null ? { country: b.country } : {}),
});

// UpdateBody → partial Drizzle set: only keys the client supplied. country is notNull, so a null
// is ignored (the frontend never clears it); other nullables accept null.
const toUpdateValues = (b: UpdateBody): Partial<NewPredefinedZone> => {
  const set: Partial<NewPredefinedZone> = {};
  if (b.name !== undefined) set.name = b.name;
  if (b.description !== undefined) set.description = b.description ?? null;
  if (b.latitude !== undefined) set.latitude = String(b.latitude);
  if (b.longitude !== undefined) set.longitude = String(b.longitude);
  if (b.radius !== undefined) set.radius = b.radius;
  if (b.image_url !== undefined) set.imageUrl = b.image_url ?? null;
  if (b.region !== undefined) set.region = b.region ?? null;
  if (b.is_active !== undefined) set.isActive = b.is_active;
  if (b.is_hot !== undefined) set.isHot = b.is_hot;
  if (b.country != null) set.country = b.country;
  return set;
};

export const predefinedZonesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/predefined-zones — ALL rows (active + inactive: the wizard filters is_active at render,
  // the admin page needs inactive too — no server-side active filter). created_at DESC mirrors the
  // legacy getAllForAdmin ordering.
  app.get('/api/predefined-zones', async (_request, reply) => {
    const rows = await db.select().from(predefinedZones).orderBy(desc(predefinedZones.createdAt));
    return reply.status(200).send(rows.map(toZoneRow));
  });

  // POST /api/predefined-zones — create (admin).
  app.post('/api/predefined-zones', adminGuard, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply, request.id, parsed.error.issues);
    const [created] = await db
      .insert(predefinedZones)
      .values(toInsertValues(parsed.data))
      .returning();
    return reply.status(201).send(toZoneRow(created as PredefinedZone));
  });

  // PATCH /api/predefined-zones/:id — update scalar fields (admin).
  app.patch('/api/predefined-zones/:id', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidInput(reply, request.id, parsedParams.error.issues);
    const parsedBody = updateBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) return invalidInput(reply, request.id, parsedBody.error.issues);

    const [updated] = await db
      .update(predefinedZones)
      .set(toUpdateValues(parsedBody.data))
      .where(eq(predefinedZones.id, parsedParams.data.id))
      .returning();
    if (!updated) {
      return reply.status(404).send({
        error: 'ZONE_NOT_FOUND',
        message: 'No zone with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    return reply.status(200).send(toZoneRow(updated));
  });

  // PATCH /api/predefined-zones/:id/active — toggle is_active (admin). Kept distinct from the general
  // PATCH so the frontend toggleActive maps to a single-purpose endpoint (it sends only is_active).
  app.patch('/api/predefined-zones/:id/active', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidInput(reply, request.id, parsedParams.error.issues);
    const parsedBody = activeBodySchema.safeParse(request.body);
    if (!parsedBody.success) return invalidInput(reply, request.id, parsedBody.error.issues);

    const [updated] = await db
      .update(predefinedZones)
      .set({ isActive: parsedBody.data.is_active })
      .where(eq(predefinedZones.id, parsedParams.data.id))
      .returning();
    if (!updated) {
      return reply.status(404).send({
        error: 'ZONE_NOT_FOUND',
        message: 'No zone with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    return reply.status(200).send(toZoneRow(updated));
  });

  // DELETE /api/predefined-zones/:id — delete (admin). 204 on success, 404 if absent.
  app.delete('/api/predefined-zones/:id', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidInput(reply, request.id, parsedParams.error.issues);
    const [deleted] = await db
      .delete(predefinedZones)
      .where(eq(predefinedZones.id, parsedParams.data.id))
      .returning({ id: predefinedZones.id });
    if (!deleted) {
      return reply.status(404).send({
        error: 'ZONE_NOT_FOUND',
        message: 'No zone with that id.',
        statusCode: 404,
        requestId: request.id,
      });
    }
    return reply.status(204).send();
  });
};
