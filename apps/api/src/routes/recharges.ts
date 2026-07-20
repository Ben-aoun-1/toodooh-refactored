import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Recharge, recharges, users } from '../db/schema.js';
import { env } from '../env.js';
import { factureBankDetailsFromEnv, renderFacturePdf } from '../lib/facture.js';
import { declaredMatchesSniffed, sniffContainer } from '../lib/media-probe.js';
import {
  JUSTIFICATIF_MIME_TO_EXT,
  MAX_JUSTIFICATIF_BYTES,
  MAX_RECHARGE_TND,
  isValidAmount,
  justificatifKey,
  makeReference,
  rechargeView,
  walletBalance,
} from '../lib/recharges.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Advertiser wallet surface (L-wallet) — a screencaster (advertiser role) tops up by BANK TRANSFER
// (no online gateway). POST creates a PENDING recharge + a facture reference; an admin later confirms
// receipt (routes/admin-recharges.ts) to credit the DERIVED balance. Every read/write is owner-scoped
// to the authenticated advertiser (a foreign recharge is indistinguishable from a missing one → 404).
//
// CF-M2 adds the OPTIONAL justificatif de virement: the advertiser uploads the bank-transfer proof
// with — or after — the recharge request (PENDING only), and the admin reviews document + amount
// together before validating. The document never gates the confirm (doc-less confirms stay allowed).

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'rejected']).optional(),
});
const createBodySchema = z.object({ amount: z.number() });

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

// 409 for a justificatif upload against a decided recharge — mirrors the admin moderation 409
// (currentStatus included so the UI can say "already confirmed/rejected" instead of blind-retrying).
const sendNotPending = (reply: FastifyReply, request: FastifyRequest, row: Recharge) =>
  reply.status(409).send({
    error: 'CONFLICT',
    message: `Recharge already ${row.status}.`,
    statusCode: 409,
    requestId: request.id,
    currentStatus: row.status,
  });

export const rechargesRoutes: FastifyPluginAsync = async (app) => {
  // Framework-level guard: busboy stops at fileSize, so an oversized justificatif is never fully
  // buffered (the house multipart pattern — file-only, fields:0).
  await app.register(multipart, {
    limits: { fileSize: MAX_JUSTIFICATIF_BYTES, files: 1, fields: 0 },
  });

  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // POST /api/recharges {amount} → 201 PENDING recharge + a FCT- reference (the facture becomes
  // downloadable via GET /api/recharges/:id/facture). The reference is derived from the new id.
  app.post('/api/recharges', advertiserGuard, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidField(reply, 'amount', 'amount (a number) is required');
    const { amount } = parsed.data;
    if (!isValidAmount(amount)) {
      return invalidField(
        reply,
        'amount',
        `amount must be > 0, have at most 2 decimals, and be ≤ ${MAX_RECHARGE_TND}`,
      );
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const id = randomUUID();
    const reference = makeReference(id);
    const [row] = await db
      .insert(recharges)
      .values({ id, advertiserId: userId, amountTnd: amount.toFixed(2), reference })
      .returning();
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Recharge record write failed.' });
    }
    return reply.status(201).send(rechargeView(row));
  });

  // GET /api/recharges/mine[?status=] — the caller's own recharges, newest first.
  app.get('/api/recharges/mine', advertiserGuard, async (request, reply) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return invalidField(reply, 'status', 'must be pending, confirmed or rejected');
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const { status } = parsedQuery.data;
    const rows = await db
      .select()
      .from(recharges)
      .where(
        status
          ? and(eq(recharges.advertiserId, userId), eq(recharges.status, status))
          : eq(recharges.advertiserId, userId),
      )
      .orderBy(desc(recharges.createdAt));
    return reply.status(200).send(rows.map(rechargeView));
  });

  // GET /api/wallet/balance — the DERIVED confirmed balance (credited − debited; debited deferred).
  app.get('/api/wallet/balance', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    return reply.status(200).send(await walletBalance(userId));
  });

  // GET /api/recharges/:id/facture — stream the invoice PDF (owner-scoped; 404 on a foreign/missing
  // id). The facture is a deterministic render of the recharge row + the advertiser's name + our
  // static bank coordinates (env), so it is generated on-the-fly — no stored object to orphan.
  app.get('/api/recharges/:id/facture', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const [row] = await db
      .select({
        reference: recharges.reference,
        amountTnd: recharges.amountTnd,
        createdAt: recharges.createdAt,
        contactName: users.contactName,
        businessName: users.businessName,
      })
      .from(recharges)
      .innerJoin(users, eq(users.id, recharges.advertiserId))
      .where(and(eq(recharges.id, parsed.data.id), eq(recharges.advertiserId, userId)))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such recharge.' });

    const pdf = await renderFacturePdf({
      reference: row.reference,
      amountTnd: Number(row.amountTnd),
      advertiserName: row.businessName ?? row.contactName,
      issuedAt: row.createdAt,
      bank: factureBankDetailsFromEnv(env),
    });
    return reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="facture-${row.reference}.pdf"`)
      .send(pdf);
  });

  // POST /api/recharges/:id/document — attach (or replace) the bank-transfer justificatif on a
  // PENDING recharge. Single-file multipart, PDF/JPEG/PNG ≤ 10 MB, byte-sniffed (the CF-SH1
  // posture: a declared mimetype that does not match the bytes is a 400, never stored). A decided
  // recharge 409s (the document review happens before the confirm, never after). Re-upload while
  // pending REPLACES: the columns re-stamp and the previous object is removed when its key differs
  // (a same-type re-upload overwrites the same key in place).
  app.post('/api/recharges/:id/document', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .select()
      .from(recharges)
      .where(and(eq(recharges.id, parsed.data.id), eq(recharges.advertiserId, userId)))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such recharge.' });
    if (row.status !== 'pending') return sendNotPending(reply, request, row);

    const data = await request.file();
    if (!data) return invalidField(reply, 'file', 'a file is required');

    // Drain the stream BEFORE MIME validation — avoids a hung request. The fileSize limit makes
    // toBuffer throw (throwFileSizeLimit default) on oversize → 413.
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds the ${MAX_JUSTIFICATIF_BYTES}-byte limit.`,
      });
    }
    if (data.file.truncated) {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds the ${MAX_JUSTIFICATIF_BYTES}-byte limit.`,
      });
    }
    if (JUSTIFICATIF_MIME_TO_EXT[data.mimetype] === undefined) {
      return invalidField(
        reply,
        'file',
        `unsupported content type for a justificatif: ${data.mimetype}`,
      );
    }
    const sniffed = sniffContainer(body);
    if (!declaredMatchesSniffed(data.mimetype, sniffed)) {
      return reply.status(400).send({
        error: 'MEDIA_TYPE_MISMATCH',
        message: `The file's bytes do not match the declared content type (declared ${data.mimetype}, detected ${sniffed ?? 'unrecognized'}).`,
        declared: data.mimetype,
        detected: sniffed,
      });
    }

    const key = justificatifKey(row.id, data.mimetype);
    const uploaded = await storage.upload({ key, body, contentType: data.mimetype });
    if ('error' in uploaded) {
      // Storage failed → do NOT touch the row. User retries; no orphan key reference.
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Document storage failed. Please retry.',
      });
    }

    // Guard status='pending' in the WHERE so a concurrent admin decision can't be documented after
    // the fact (mirrors the admin confirm's atomic transition). A lost race re-reads and 409s.
    const [updated] = await db
      .update(recharges)
      .set({ documentKey: key, documentMime: data.mimetype, documentUploadedAt: new Date() })
      .where(
        and(
          eq(recharges.id, row.id),
          eq(recharges.advertiserId, userId),
          eq(recharges.status, 'pending'),
        ),
      )
      .returning();
    if (!updated) {
      // The recharge got decided mid-upload: drop the fresh object (unless it IS the referenced
      // key — a same-type replace racing a confirm must not delete the document under review).
      if (row.documentKey !== key) await storage.delete({ key }).catch(() => undefined);
      const [current] = await db.select().from(recharges).where(eq(recharges.id, row.id)).limit(1);
      return sendNotPending(reply, request, current ?? row);
    }
    if (row.documentKey !== null && row.documentKey !== key) {
      // Replace across types (e.g. pdf → png): the old object is gone for good, best-effort.
      await storage.delete({ key: row.documentKey }).catch(() => undefined);
    }
    return reply.status(200).send(rechargeView(updated));
  });

  // GET /api/recharges/:id/document-url — short-TTL presigned view of the caller's justificatif
  // (the CF-O1 presign posture: fetched on demand, consumed immediately; 5 minutes outlives any
  // plausible view without leaving long-lived links around). A foreign recharge, a missing one and
  // one without a document are INDISTINGUISHABLE — one identical 404 body for all three.
  app.get('/api/recharges/:id/document-url', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .select({ documentKey: recharges.documentKey })
      .from(recharges)
      .where(and(eq(recharges.id, parsed.data.id), eq(recharges.advertiserId, userId)))
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
};
