import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Recharge, notifications, recharges, users } from '../db/schema.js';
import { advertiserRechargeNotification } from '../lib/recharge-notifications.js';
import {
  adminRechargeView,
  isAdminDecidable,
  rechargeAdvertiser,
  rechargeAdvertiserById,
} from '../lib/recharges.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Admin recharge moderation (L-wallet) — the manual-payment confirmation step. An admin reconciles a
// bank transfer (or a returned signed bon, FCT1) against a recharge's reference and CONFIRMS receipt
// (→ credits the derived balance) or REJECTS/cancels it (→ a reason surfaced to the advertiser).
// Mirrors the admin creative/account review: every route is [requireAuth, requireAdmin]; a non-admin
// gets 403, a missing recharge 404. Decidable states are per-method (lib/recharges.ts
// isAdminDecidable): virement + legacy while 'pending', bon only once 'bon_returned' — and the
// UPDATE's WHERE re-encodes the SAME predicate so the transition stays ATOMIC (a re-confirm can
// never double-credit). GREEN2 (ruled) supersedes the FCT1 invisibility pin: 'bon_issued' rows
// now APPEAR in the queue as READ-ONLY « Bon émis » rows (the admin must see outstanding paper);
// they stay NON-decidable until the signed bon is deposited. Every decision notifies in French.

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'rejected', 'bon_issued', 'bon_returned']).optional(),
});
const rejectBodySchema = z.object({ reason: z.string().trim().min(1).max(2000) });

// The atomic decidable predicate — the SQL mirror of isAdminDecidable, used in the UPDATE WHERE.
// The isNull branch is load-bearing: `method <> 'bon_de_commande'` is NULL (not true) for legacy
// rows in SQL.
const decidableWhere = or(
  and(isNull(recharges.method), eq(recharges.status, 'pending')),
  and(eq(recharges.method, 'virement'), eq(recharges.status, 'pending')),
  and(eq(recharges.method, 'bon_de_commande'), eq(recharges.status, 'bon_returned')),
);

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

// 409 for a recharge that is no longer pending (already confirmed/rejected). Carries the current
// status so the admin UI can show "already confirmed/rejected" instead of a blind retry.
const sendNotPending = (reply: FastifyReply, request: FastifyRequest, row: Recharge) =>
  reply.status(409).send({
    error: 'CONFLICT',
    message: `Recharge already ${row.status}.`,
    statusCode: 409,
    requestId: request.id,
    currentStatus: row.status,
  });

export const adminRechargesRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/recharges[?status=] — the moderation queue (newest first); optional status
  // filter. GREEN2 (ruled): 'bon_issued' rows are INCLUDED — outstanding awaiting-signature
  // paper is visible, read-only (isAdminDecidable keeps confirm/reject off until deposit).
  app.get('/api/admin/recharges', adminGuard, async (request, reply) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return invalidField(
        reply,
        'status',
        'must be pending, confirmed, rejected, bon_issued or bon_returned',
      );
    }
    const { status } = parsedQuery.data;
    // RECH-ADM1 — the owner's name rides the list read (ADM-FIX1's ONE label, any account
    // status). INNER on purpose and cannot drop a row: advertiser_id is a NOT NULL FK to users.
    const rows = await db
      .select({
        recharge: recharges,
        advertiserBusinessName: users.businessName,
        advertiserContactName: users.contactName,
        advertiserEmail: users.email,
      })
      .from(recharges)
      .innerJoin(users, eq(recharges.advertiserId, users.id))
      .where(status ? eq(recharges.status, status) : undefined)
      .orderBy(desc(recharges.createdAt));
    return reply.status(200).send(
      rows.map((r) =>
        adminRechargeView(
          r.recharge,
          rechargeAdvertiser({
            id: r.recharge.advertiserId,
            businessName: r.advertiserBusinessName,
            contactName: r.advertiserContactName,
            email: r.advertiserEmail,
          }),
        ),
      ),
    );
  });

  // POST /api/admin/recharges/:id/confirm — decidable → confirmed; credits the balance (the SUM
  // over 'confirmed' credits the EXACT original amount at THIS moment — never at creation) +
  // stamps the confirm audit (confirmed_by/at). Idempotent: a second confirm 409s and never
  // double-credits. Notifies the screencaster («Créditée» / «Fonds reçus» by method).
  app.post('/api/admin/recharges/:id/confirm', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { id } = parsedParams.data;
    const [existing] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
    if (!existing)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such recharge.' });
    if (!isAdminDecidable(existing)) return sendNotPending(reply, request, existing);

    // Guard the transition in the WHERE so two concurrent confirms can't both win (atomic, no
    // double-credit). A lost race returns 0 rows → re-read + 409. The notification rides the same
    // transaction — a credited status and its French notice land (or fail) together. So does the
    // response's label read (RECH-ADM1): read after the commit, its failure 500'd a recharge that
    // was already credited; inside, a failure rolls the whole decision back and a retry is safe.
    const decided = await db.transaction(async (tx) => {
      const [flipped] = await tx
        .update(recharges)
        .set({ status: 'confirmed', confirmedBy: adminId, confirmedAt: new Date() })
        .where(and(eq(recharges.id, id), decidableWhere))
        .returning();
      if (!flipped) return undefined;
      await tx
        .insert(notifications)
        .values(
          advertiserRechargeNotification(
            flipped.method === 'bon_de_commande' ? 'funds_received' : 'credited',
            flipped,
          ),
        );
      return adminRechargeView(flipped, await rechargeAdvertiserById(flipped.advertiserId, tx));
    });
    if (!decided) {
      const [current] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
      return sendNotPending(reply, request, current ?? existing);
    }
    return reply.status(200).send(decided);
  });

  // POST /api/admin/recharges/:id/reject {reason} — decidable → rejected («Annulée» for method
  // rows); a reason is REQUIRED and is surfaced to the advertiser (reject_reason + the French
  // notification). Does NOT credit the balance. cancelled_at stamps the decision (FCT1).
  app.post('/api/admin/recharges/:id/reject', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsedBody = rejectBodySchema.safeParse(request.body ?? {});
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
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const { id } = parsedParams.data;
    const [existing] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
    if (!existing)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such recharge.' });
    if (!isAdminDecidable(existing)) return sendNotPending(reply, request, existing);

    // Same shape as confirm: the flip, its notice and the response's label read are ONE
    // transaction, so a failed read can never 500 an already-cancelled recharge (RECH-ADM1).
    const decided = await db.transaction(async (tx) => {
      const [flipped] = await tx
        .update(recharges)
        .set({ status: 'rejected', rejectReason: parsedBody.data.reason, cancelledAt: new Date() })
        .where(and(eq(recharges.id, id), decidableWhere))
        .returning();
      if (!flipped) return undefined;
      await tx.insert(notifications).values(advertiserRechargeNotification('cancelled', flipped));
      return adminRechargeView(flipped, await rechargeAdvertiserById(flipped.advertiserId, tx));
    });
    if (!decided) {
      const [current] = await db.select().from(recharges).where(eq(recharges.id, id)).limit(1);
      return sendNotPending(reply, request, current ?? existing);
    }
    return reply.status(200).send(decided);
  });

  // GET /api/admin/recharges/:id/document-url — short-TTL presigned view of a recharge's
  // justificatif (CF-M2), so the admin reviews document + amount together before deciding. Same
  // 5-minute TTL as the advertiser route; a recharge without a document is a plain 404.
  app.get('/api/admin/recharges/:id/document-url', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');

    const [row] = await db
      .select({ documentKey: recharges.documentKey })
      .from(recharges)
      .where(eq(recharges.id, parsed.data.id))
      .limit(1);
    if (!row || row.documentKey === null) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such document.' });
    }
    const result = await storage.getPresignedUrl({ key: row.documentKey, expiresInSeconds: 300 });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not generate a document URL. Please retry.',
      });
    }
    return reply.status(200).send({ url: result.url });
  });

  // FCT1 — the bon-method files for the admin review modal, same presign posture as the
  // justificatif (300 s TTL; a recharge without the object is a plain 404). bon-url = the
  // GENERATED bon (cross-check the signed copy against it); signed-bon-url = the DEPOSITED one.
  const presignRechargeKey = async (
    reply: FastifyReply,
    id: string,
    column: 'bonKey' | 'signedBonKey',
  ) => {
    const [row] = await db
      .select({ bonKey: recharges.bonKey, signedBonKey: recharges.signedBonKey })
      .from(recharges)
      .where(eq(recharges.id, id))
      .limit(1);
    const key = row?.[column] ?? null;
    if (key === null) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such document.' });
    }
    const result = await storage.getPresignedUrl({ key, expiresInSeconds: 300 });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not generate a document URL. Please retry.',
      });
    }
    return reply.status(200).send({ url: result.url });
  };

  app.get('/api/admin/recharges/:id/bon-url', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    return presignRechargeKey(reply, parsed.data.id, 'bonKey');
  });

  app.get('/api/admin/recharges/:id/signed-bon-url', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    return presignRechargeKey(reply, parsed.data.id, 'signedBonKey');
  });
};
