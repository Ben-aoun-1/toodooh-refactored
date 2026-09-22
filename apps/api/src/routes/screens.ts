import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { screenhosts, screens } from '../db/schema.js';
import { ensureOwnerHasScreen } from '../lib/screens.js';
import { requireDeviceAuth } from '../middleware/require-device-auth.js';

// TV-app screen endpoints (MAP M1 commit 2) — device-bearer-guarded. The app's flow:
// sign in (device-auth) → list "my" screens → the installer picks the one this TV is →
// pair, optionally sending the TV's GPS fix.
const idParamSchema = z.object({ id: z.uuid() });
const pairBodySchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const screensRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/screens/mine — every screen across the caller's screenhosts, in the TV app's
  // shape: [{id, name, location, status, is_online}]. location = screenhost name + city;
  // is_online is a hardcoded false in M1 (a real liveness signal derives from last_seen_at
  // in a later slice).
  app.get('/api/screens/mine', { preHandler: requireDeviceAuth }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Lane 5 — the device read must never be empty for an owner who has a venue: an
    // individual_owner whose signup left screen_count at 0 gets no screens at approval, so
    // self-heal one "Écran 1" here so the TV they're signing in from has something to open +
    // pair. Idempotent: a no-op once any screen exists. (See lib/screens ensureOwnerHasScreen.)
    await ensureOwnerHasScreen(userId);

    const rows = await db
      .select({
        id: screens.id,
        name: screens.name,
        isActive: screens.isActive,
        hostName: screenhosts.name,
        hostCity: screenhosts.city,
      })
      .from(screens)
      .innerJoin(screenhosts, eq(screens.screenhostId, screenhosts.id))
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(asc(screenhosts.name), asc(screens.name));

    return reply.status(200).send(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        location: r.hostCity ? `${r.hostName} — ${r.hostCity}` : r.hostName,
        status: r.isActive ? 'active' : 'inactive',
        is_online: false,
      })),
    );
  });

  // POST /api/screens/:id/pair — owner-scoped pairing + the GPS-LINK RULE (Kais): the TV's
  // coordinates are written to the PARENT SCREENHOST only when its latitude AND longitude
  // are both still NULL — first TV wins, per screenhost; later pairs NEVER overwrite, and
  // re-pairing is idempotent (paired_at/last_seen_at refresh, nothing else moves).
  app.post('/api/screens/:id/pair', { preHandler: requireDeviceAuth }, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedBody = pairBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    // Owner scoping at the JOIN: a foreign screen id is indistinguishable from a missing one.
    const [row] = await db
      .select({ screenId: screens.id, screenhostId: screenhosts.id })
      .from(screens)
      .innerJoin(screenhosts, eq(screens.screenhostId, screenhosts.id))
      .where(and(eq(screens.id, parsedParams.data.id), eq(screenhosts.ownerId, userId)))
      .limit(1);
    if (!row) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screen.' });
    }

    // The row can vanish between the SELECT above and this UPDATE: an owner or admin lowering the
    // declared count (SCR-DECL1, lib/screens.ts) deletes never-installed rows while holding their
    // lock, so this UPDATE waits and then matches nothing. That is the same answer as a missing
    // screen, never a « paired » for an id that no longer exists.
    const now = new Date();
    const paired = await db
      .update(screens)
      .set({ pairedAt: now, lastSeenAt: now })
      .where(eq(screens.id, row.screenId))
      .returning({ id: screens.id });
    if (paired.length === 0) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such screen.' });
    }

    // GPS link — guarded UPDATE: the WHERE re-checks both-NULL so two concurrent first
    // pairs cannot both win (the second matches no row).
    const { latitude, longitude } = parsedBody.data;
    let locationLinked = false;
    if (latitude !== undefined && longitude !== undefined) {
      const linked = await db
        .update(screenhosts)
        .set({ latitude: String(latitude), longitude: String(longitude) })
        .where(
          and(
            eq(screenhosts.id, row.screenhostId),
            isNull(screenhosts.latitude),
            isNull(screenhosts.longitude),
          ),
        )
        .returning({ id: screenhosts.id });
      locationLinked = linked.length > 0;
    }

    return reply.status(200).send({ paired: true, location_linked: locationLinked });
  });
};
