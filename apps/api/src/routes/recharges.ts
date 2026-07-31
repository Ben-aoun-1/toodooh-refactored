import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Recharge, notifications, recharges, users } from '../db/schema.js';
import { renderBonDeCommandePdf } from '../lib/bon-de-commande.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { renderFacturePdf, resolveFactureBankDetails } from '../lib/facture.js';
import { declaredMatchesSniffed, sniffContainer } from '../lib/media-probe.js';
import {
  advertiserRechargeNotification,
  adminRechargeNotifications,
  listAdminIds,
} from '../lib/recharge-notifications.js';
import {
  JUSTIFICATIF_MIME_TO_EXT,
  MAX_JUSTIFICATIF_BYTES,
  MAX_RECHARGE_TND,
  MIN_RECHARGE_TND,
  bonKey,
  isUniqueViolation,
  isValidAmount,
  justificatifKey,
  makeMethodReference,
  rechargeView,
  signedBonKey,
  walletBalance,
} from '../lib/recharges.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// Advertiser wallet surface (L-wallet) — a screencaster (advertiser role) tops up MANUALLY (no
// online gateway). FCT1 (recharge parcours v2) replaces the generic POST with TWO method-explicit
// creations:
//   POST /api/recharges/virement  — amount (≥ 500) + a MANDATORY justificatif file → 'pending'
//                                   («En attente de réception»); admins are notified (actionable).
//   POST /api/recharges/bon       — amount (≥ 500) → renders + STORES the bon de commande PDF →
//                                   'bon_issued' («Bon émis», screencaster-only — no admin
//                                   notification, excluded from the admin queue); the signed bon
//                                   comes back via POST /:id/signed-bon → 'bon_returned'.
// An admin then confirms receipt (routes/admin-recharges.ts) to credit the DERIVED balance. Every
// read/write is owner-scoped to the authenticated advertiser (a foreign recharge is
// indistinguishable from a missing one → 404). Every transition notifies the screencaster (French).
//
// CF-M2's justificatif plumbing (PENDING-only attach/replace + presign view) is kept as-found — for
// a virement row the document IS the mandatory justificatif deposited at creation.

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'rejected', 'bon_issued', 'bon_returned']).optional(),
});
// FCT1 — the virement's scalars ride the querystring (the multipart body stays file-only, the
// house fields:0 pattern); the bon's ride a JSON body (no file at creation).
const methodAmountSchema = z.object({ amount: z.coerce.number() });
const bonBodySchema = z.object({ amount: z.number() });

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

  // Drain + validate one justificatif-class upload (PDF/JPEG/PNG ≤ 10 MB, byte-sniffed — the
  // CF-SH1 posture). Shared by the CF-M2 attach route, the virement creation and the signed-bon
  // deposit; returns null when a 400/413 reply has already been sent.
  const readJustificatifUpload = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ body: Buffer; mimetype: string } | null> => {
    const data = await request.file();
    if (!data) {
      invalidField(reply, 'file', 'a file is required');
      return null;
    }
    // Drain the stream BEFORE MIME validation — avoids a hung request. The fileSize limit makes
    // toBuffer throw (throwFileSizeLimit default) on oversize → 413.
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds the ${MAX_JUSTIFICATIF_BYTES}-byte limit.`,
      });
      return null;
    }
    if (data.file.truncated) {
      reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds the ${MAX_JUSTIFICATIF_BYTES}-byte limit.`,
      });
      return null;
    }
    if (JUSTIFICATIF_MIME_TO_EXT[data.mimetype] === undefined) {
      invalidField(reply, 'file', `unsupported content type for a justificatif: ${data.mimetype}`);
      return null;
    }
    const sniffed = sniffContainer(body);
    if (!declaredMatchesSniffed(data.mimetype, sniffed)) {
      reply.status(400).send({
        error: 'MEDIA_TYPE_MISMATCH',
        message: `The file's bytes do not match the declared content type (declared ${data.mimetype}, detected ${sniffed ?? 'unrecognized'}).`,
        declared: data.mimetype,
        detected: sniffed,
      });
      return null;
    }
    return { body, mimetype: data.mimetype };
  };

  // The v2 amount gate: the shared shape rules (finite, ≤ 2 decimals, ≤ sanity max) + the FCT1
  // 500 TND floor. One reason string so both creation routes 400 identically.
  const validMethodAmount = (reply: FastifyReply, amount: number): boolean => {
    if (!isValidAmount(amount) || amount < MIN_RECHARGE_TND) {
      invalidField(
        reply,
        'amount',
        `amount must be ≥ ${MIN_RECHARGE_TND}, have at most 2 decimals, and be ≤ ${MAX_RECHARGE_TND}`,
      );
      return false;
    }
    return true;
  };

  // POST /api/recharges — RETIRED by FCT1 (was: the generic method-less creation). 410 with the
  // user-facing French reason; the two method routes below replace it. Kept registered so an
  // outdated client gets an explicit retirement, never a shapeless 404.
  app.post('/api/recharges', advertiserGuard, async (_request, reply) =>
    reply.status(410).send({
      error: 'GONE',
      message:
        "Ce mode de création de recharge n'est plus disponible. Choisissez le virement bancaire ou le bon de commande.",
    }),
  );

  // POST /api/recharges/virement?amount= (multipart file) — US-FCT-3/4: a virement demande is
  // created WITH its proof-of-transfer justificatif, MANDATORY (no file → 400, nothing stored).
  // Storage-first (no-orphan rule), then the row insert retries reference collisions. The demande
  // lands 'pending' («En attente de réception») and the admins are notified — a virement deposit
  // is immediately actionable.
  app.post('/api/recharges/virement', advertiserGuard, async (request, reply) => {
    const parsed = methodAmountSchema.safeParse(request.query);
    if (!parsed.success) return invalidField(reply, 'amount', 'amount (a number) is required');
    if (!validMethodAmount(reply, parsed.data.amount)) return reply;
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const upload = await readJustificatifUpload(request, reply);
    if (!upload) return reply;

    const id = randomUUID();
    const key = justificatifKey(id, upload.mimetype);
    const uploaded = await storage.upload({
      key,
      body: upload.body,
      contentType: upload.mimetype,
    });
    if ('error' in uploaded) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Document storage failed. Please retry.',
      });
    }

    let row: Recharge | undefined;
    for (let attempt = 0; attempt < 5 && row === undefined; attempt += 1) {
      try {
        const [inserted] = await db
          .insert(recharges)
          .values({
            id,
            advertiserId: userId,
            amountTnd: parsed.data.amount.toFixed(2),
            reference: makeMethodReference('virement'),
            method: 'virement',
            documentKey: key,
            documentMime: upload.mimetype,
            documentUploadedAt: new Date(),
          })
          .returning();
        row = inserted;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Recharge record write failed.' });
    }

    const adminIds = await listAdminIds();
    await db
      .insert(notifications)
      .values([
        advertiserRechargeNotification('virement_created', row),
        ...adminRechargeNotifications('virement_created', row, adminIds),
      ]);
    return reply.status(201).send(rechargeView(row));
  });

  // POST /api/recharges/bon {amount} — US-FCT-5/6: Toodooh GENERATES the bon de commande PDF
  // (identity + montant + BC-reference), stores it (byte-stable — the client signs this exact
  // paper) and the demande lands 'bon_issued' («Bon émis»). SCREENCASTER-ONLY: no admin
  // notification, excluded from the admin queue until the signed bon comes back. A reference
  // collision re-renders with a fresh reference (same key overwrites) and retries the insert.
  app.post('/api/recharges/bon', advertiserGuard, async (request, reply) => {
    const parsed = bonBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidField(reply, 'amount', 'amount (a number) is required');
    if (!validMethodAmount(reply, parsed.data.amount)) return reply;
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [advertiser] = await db
      .select({ contactName: users.contactName, businessName: users.businessName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!advertiser) return sendUnauthenticated(reply);

    const id = randomUUID();
    let row: Recharge | undefined;
    for (let attempt = 0; attempt < 5 && row === undefined; attempt += 1) {
      const reference = makeMethodReference('bon_de_commande');
      const pdf = await renderBonDeCommandePdf({
        reference,
        amountTnd: parsed.data.amount,
        advertiserName: advertiser.businessName ?? advertiser.contactName,
        issuedAt: new Date(),
      });
      const uploaded = await storage.upload({
        key: bonKey(id),
        body: pdf,
        contentType: 'application/pdf',
      });
      if ('error' in uploaded) {
        return reply.status(502).send({
          error: 'STORAGE_ERROR',
          message: 'Bon storage failed. Please retry.',
        });
      }
      try {
        const [inserted] = await db
          .insert(recharges)
          .values({
            id,
            advertiserId: userId,
            amountTnd: parsed.data.amount.toFixed(2),
            reference,
            method: 'bon_de_commande',
            status: 'bon_issued',
            bonKey: bonKey(id),
          })
          .returning();
        row = inserted;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Recharge record write failed.' });
    }

    // The persisted sign invite (US-FCT-6) — the popup is ephemeral, this row is not. No admin row.
    await db.insert(notifications).values(advertiserRechargeNotification('bon_issued', row));
    return reply.status(201).send(rechargeView(row));
  });

  // GET /api/recharges/bank-coordinates — Toodooh's own coordinates for the virement « Pour info »
  // block (US-FCT-3). Config-backed (dispatch_config singleton; '—' = not provisioned → the web
  // shows its placeholder line). The pricing-config posture: commercial-but-not-secret display
  // data, readable by the surface that needs it — here the advertiser recharge flow.
  app.get('/api/recharges/bank-coordinates', advertiserGuard, async (_request, reply) => {
    const cfg = await getDispatchConfig();
    return reply.status(200).send({
      rib: cfg.bankRib,
      iban: cfg.bankIban,
      bic: cfg.bankBic,
      domiciliation: cfg.bankDomiciliation,
    });
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

  // GET /api/recharges/:id/facture — stream the « Récapitulatif de commande » PDF (owner-scoped;
  // 404 on a foreign/missing id). FCT2 relabeled it from « facture » (recharges never invoice —
  // US-FCT-12; the real invoice is monthly, routes/wallet-documents.ts); the route path stays for
  // wire compat, the filename follows the new name. Deterministic on-the-fly render of the
  // recharge row + the advertiser's name + the bank coordinates (dispatch_config.bank_*, the ONE
  // home since GREEN1 removed the FACTURE_BANK_* env fallback).
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
      bank: resolveFactureBankDetails(await getDispatchConfig()),
    });
    return reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="recapitulatif-${row.reference}.pdf"`)
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

    const upload = await readJustificatifUpload(request, reply);
    if (!upload) return reply;

    const key = justificatifKey(row.id, upload.mimetype);
    const uploaded = await storage.upload({
      key,
      body: upload.body,
      contentType: upload.mimetype,
    });
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
      .set({ documentKey: key, documentMime: upload.mimetype, documentUploadedAt: new Date() })
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

  // GET /api/recharges/:id/bon — stream the STORED bon de commande PDF through the api (the
  // monthly-report serving posture: generated documents stay on a private prefix, owner-auth in
  // the route; presigning is reserved for user-uploaded objects). A foreign recharge, a missing
  // one and one without a bon (virement/legacy) are INDISTINGUISHABLE — one identical 404.
  app.get('/api/recharges/:id/bon', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .select({ bonKey: recharges.bonKey, reference: recharges.reference })
      .from(recharges)
      .where(and(eq(recharges.id, parsed.data.id), eq(recharges.advertiserId, userId)))
      .limit(1);
    if (!row || row.bonKey === null) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such document.' });
    }
    const result = await storage.download({ key: row.bonKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not fetch the bon. Please retry.',
      });
    }
    return reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="bon-commande-${row.reference}.pdf"`)
      .send(result.body);
  });

  // POST /api/recharges/:id/signed-bon — US-FCT-7: the screencaster deposits the SIGNED bon
  // (same accepted set as the justificatif: PDF/JPEG/PNG ≤ 10 MB, byte-sniffed). Only an issued
  // bon accepts a deposit ('bon_issued' → 'bon_returned', guarded in the WHERE — a lost race
  // 409s and drops the fresh object). The transition NOW makes the demande admin-visible and
  // actionable: the admins are notified alongside the screencaster, atomically with the flip.
  app.post('/api/recharges/:id/signed-bon', advertiserGuard, async (request, reply) => {
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
    if (row.method !== 'bon_de_commande') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'Not a bon de commande recharge.',
        statusCode: 409,
        requestId: request.id,
        currentStatus: row.status,
      });
    }
    if (row.status !== 'bon_issued') return sendNotPending(reply, request, row);

    const upload = await readJustificatifUpload(request, reply);
    if (!upload) return reply;

    const key = signedBonKey(row.id, upload.mimetype);
    const uploaded = await storage.upload({
      key,
      body: upload.body,
      contentType: upload.mimetype,
    });
    if ('error' in uploaded) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Document storage failed. Please retry.',
      });
    }

    const adminIds = await listAdminIds();
    const updated = await db.transaction(async (tx) => {
      const [flipped] = await tx
        .update(recharges)
        .set({
          signedBonKey: key,
          signedBonMime: upload.mimetype,
          signedBonDepositedAt: new Date(),
          status: 'bon_returned',
        })
        .where(
          and(
            eq(recharges.id, row.id),
            eq(recharges.advertiserId, userId),
            eq(recharges.status, 'bon_issued'),
          ),
        )
        .returning();
      if (!flipped) return undefined;
      await tx
        .insert(notifications)
        .values([
          advertiserRechargeNotification('bon_returned', flipped),
          ...adminRechargeNotifications('bon_returned', flipped, adminIds),
        ]);
      return flipped;
    });
    if (!updated) {
      // The bon got decided/deposited mid-upload: drop the fresh object unless it IS the
      // referenced key (the justificatif-route race posture).
      if (row.signedBonKey !== key) await storage.delete({ key }).catch(() => undefined);
      const [current] = await db.select().from(recharges).where(eq(recharges.id, row.id)).limit(1);
      return sendNotPending(reply, request, current ?? row);
    }
    return reply.status(200).send(rechargeView(updated));
  });
};
