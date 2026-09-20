import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Creative, creatives, users } from '../db/schema.js';
import { creativeView, submittedCreativeGate } from '../lib/creatives.js';
import { userLabel, userLabelById } from '../lib/user-label.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Admin creative moderation (L-spot) — the CONTENT gate of the bifurcated approval. An admin reviews
// an advertiser's creative and flips validation_status pending → approved | rejected, stamping the
// audit trio (validated_by/at/notes). Mirrors the admin account/document review (admin.ts): every
// route is [requireAuth, requireAdmin]; a non-admin gets 403, a missing creative 404. A campaign's
// content gate is DERIVED from its linked creative's validation_status (routes/campaigns.ts) — there
// is no campaign-level validation column.

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});
// Approve may carry optional reviewer notes; reject REQUIRES a reason (surfaced to the advertiser as
// validation_notes), mirroring the account-reject contract.
const approveBodySchema = z.object({ notes: z.string().max(2000).optional() });
const rejectBodySchema = z.object({ notes: z.string().min(1).max(2000) });

// Admin view = the advertiser projection + the owner id and the moderating admin id (audit).
// ADM-FIX1 — plus the advertiser's NAME (lib/user-label): the moderation queue printed the raw
// uuid as the « Annonceur » column and again in the examen modal.
const adminCreativeView = (row: Creative, advertiserLabel: string) => ({
  ...creativeView(row),
  advertiser_id: row.advertiserId,
  advertiser_label: advertiserLabel,
  validated_by: row.validatedBy,
});

export const adminCreativesRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/creatives[?status=] — the moderation queue (newest first); optional status filter.
  app.get('/api/admin/creatives', adminGuard, async (request, reply) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: [{ field: 'status', reason: 'must be pending, approved or rejected' }],
      });
    }
    const { status } = parsedQuery.data;
    // CF-HF4 — the « submitted » gate lives in lib/creatives.ts (ADM-DSH2: the dashboard tile
    // counts through the SAME predicate, so it can never read 4 over an empty queue).
    const submittedGate = submittedCreativeGate;
    // The users join is INNER on purpose and cannot drop a row: creatives.advertiser_id is NOT NULL
    // and references users.id, so every creative has exactly one advertiser.
    const rows = await db
      .select({
        creative: creatives,
        advertiserBusinessName: users.businessName,
        advertiserContactName: users.contactName,
      })
      .from(creatives)
      .innerJoin(users, eq(creatives.advertiserId, users.id))
      .where(status ? and(eq(creatives.validationStatus, status), submittedGate) : submittedGate)
      .orderBy(desc(creatives.createdAt));
    return reply.status(200).send(
      rows.map((r) =>
        adminCreativeView(
          r.creative,
          userLabel({
            businessName: r.advertiserBusinessName,
            contactName: r.advertiserContactName,
          }),
        ),
      ),
    );
  });

  // GET /api/admin/creatives/:id/url — presign the object so the admin can review it (404 if absent).
  app.get('/api/admin/creatives/:id/url', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const [row] = await db
      .select({ storageKey: creatives.storageKey })
      .from(creatives)
      .where(eq(creatives.id, parsed.data.id))
      .limit(1);
    if (!row)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Créative introuvable.' });
    const result = await storage.getPresignedUrl({ key: row.storageKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: "Impossible de générer l'URL de la créative. Veuillez réessayer.",
      });
    }
    return reply.status(200).send({ url: result.url });
  });

  // POST /api/admin/creatives/:id/approve — flip to approved, stamp the audit trio (notes optional).
  app.post('/api/admin/creatives/:id/approve', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedBody = approveBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [updated] = await db
      .update(creatives)
      .set({
        validationStatus: 'approved',
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: parsedBody.data.notes ?? null,
      })
      .where(eq(creatives.id, parsedParams.data.id))
      .returning();
    if (!updated)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Créative introuvable.' });
    return reply
      .status(200)
      .send(adminCreativeView(updated, await userLabelById(updated.advertiserId)));
  });

  // POST /api/admin/creatives/:id/reject — flip to rejected; a reason is REQUIRED (validation_notes).
  app.post('/api/admin/creatives/:id/reject', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: [{ field: 'id', reason: 'must be a uuid' }],
      });
    }
    const parsedBody = rejectBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
        fields: parsedBody.error.issues.map((i) => ({
          field: i.path.join('.'),
          reason: i.message,
        })),
      });
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const [updated] = await db
      .update(creatives)
      .set({
        validationStatus: 'rejected',
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: parsedBody.data.notes,
      })
      .where(eq(creatives.id, parsedParams.data.id))
      .returning();
    if (!updated)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Créative introuvable.' });
    return reply
      .status(200)
      .send(adminCreativeView(updated, await userLabelById(updated.advertiserId)));
  });
};
