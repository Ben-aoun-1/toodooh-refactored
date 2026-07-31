import multipart from '@fastify/multipart';
import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { notifications, screenhostFactures, screenhosts } from '../db/schema.js';
import { MAX_JUSTIFICATIF_BYTES, signedFactureKey } from '../lib/facture-deposit.js';
import { factureLinesFor } from '../lib/facture-lines.js';
import { declaredMatchesSniffed, sniffContainer } from '../lib/media-probe.js';
import { monthLabelFr } from '../lib/report/monthly-job.js';
import { requireActiveAccount, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// REV2 — the owner's « Mes factures ». Supersedes FCT2's « Relevés de reversement »: same monthly
// per-venue rows written by the billing sweep, but the document is a FACTURE the screenhost issues
// TO Toodooh, and the owner now sends it back signed.
//
// THE OWNER WIRE CARRIES NO STATUS. The lifecycle exists as data (emise → en_verification here;
// the rest is REV3's admin surface) but §5 is explicit that a screenhost learns about status
// through NOTIFICATIONS, never from a line in a list. Nothing in these projections exposes it, and
// a test pins that — adding `status` to a select here would be the regression.

const idParamSchema = z.object({ id: z.uuid() });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

/** « Facture <Mois> <Année> » — the designation the list and the popup both show. */
export const factureDesignation = (month: string): string => `Facture ${monthLabelFr(month)}`;

export const ownerStatementsRoutes: FastifyPluginAsync = async (app) => {
  // Framework-level guard: busboy stops at fileSize, so an oversized deposit is never fully
  // buffered (the house multipart pattern — file-only, fields:0).
  await app.register(multipart, {
    limits: { fileSize: MAX_JUSTIFICATIF_BYTES, files: 1, fields: 0 },
  });

  const ownerGuard = { preHandler: [requireAuth, requireActiveAccount] };

  // GET /api/screenhosts/statements — every facture across the caller's venues, newest month
  // first. NOTE the deliberate absence of `status` in the projection (see the header).
  app.get('/api/screenhosts/statements', ownerGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const rows = await db
      .select({
        id: screenhostFactures.id,
        screenhost_id: screenhostFactures.screenhostId,
        screenhost_name: screenhosts.name,
        month: screenhostFactures.month,
        total_sh_tnd: screenhostFactures.totalShTnd,
        reference: screenhostFactures.reference,
        created_at: screenhostFactures.createdAt,
        deposited_at: screenhostFactures.depositedAt,
      })
      .from(screenhostFactures)
      .innerJoin(screenhosts, eq(screenhosts.id, screenhostFactures.screenhostId))
      .where(eq(screenhosts.ownerId, userId))
      .orderBy(desc(screenhostFactures.month), desc(screenhostFactures.createdAt));
    return reply.status(200).send(
      rows.map((r) => ({
        ...r,
        total_sh_tnd: Number(r.total_sh_tnd),
        designation: factureDesignation(r.month),
        deposited_at: r.deposited_at ? r.deposited_at.toISOString() : null,
      })),
    );
  });

  // GET /api/screenhosts/statements/:id — ONE facture, with its per-source revenue lines.
  //
  // WHY THE LINES ARE HERE AND NOT ON THE LIST. The detail screen offers « Imprimer », which
  // renders that screen as the printable — so it is a signable artifact exactly like the stored
  // PDF, and the two must show the same lines. They do, structurally: `factureLinesFor` is the
  // single computation home the sweep's PDF builder also calls. The LIST wire is deliberately
  // untouched — a list row needs a total, not a breakdown, and re-aggregating per row would be a
  // query per line for nothing.
  //
  // `total_sh_tnd` stays the STORED figure, not the re-derived sum: it is what the emitted document
  // says, and the facture is the document. A test pins the two equal.
  //
  // Still NO status (see the header). The projection is the list's, plus `lines`.
  app.get('/api/screenhosts/statements/:id', ownerGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .select({
        id: screenhostFactures.id,
        screenhost_id: screenhostFactures.screenhostId,
        screenhost_name: screenhosts.name,
        month: screenhostFactures.month,
        total_sh_tnd: screenhostFactures.totalShTnd,
        reference: screenhostFactures.reference,
        created_at: screenhostFactures.createdAt,
        deposited_at: screenhostFactures.depositedAt,
        ownerId: screenhosts.ownerId,
      })
      .from(screenhostFactures)
      .innerJoin(screenhosts, eq(screenhosts.id, screenhostFactures.screenhostId))
      .where(eq(screenhostFactures.id, parsed.data.id))
      .limit(1);
    // A foreign facture is indistinguishable from a missing one — one identical 404.
    if (!row || row.ownerId !== userId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such facture.' });
    }

    const lines = await factureLinesFor(row.screenhost_id, row.month);
    return reply.status(200).send({
      id: row.id,
      screenhost_id: row.screenhost_id,
      screenhost_name: row.screenhost_name,
      month: row.month,
      reference: row.reference,
      created_at: row.created_at,
      total_sh_tnd: Number(row.total_sh_tnd),
      designation: factureDesignation(row.month),
      deposited_at: row.deposited_at ? row.deposited_at.toISOString() : null,
      lines: lines.map((l) => ({ source: l.source, amount_ht_tnd: l.amountHtTnd })),
    });
  });

  // GET /api/screenhosts/statements/:id/pdf — stream the stored facture. Ownership rides the join:
  // a foreign facture is indistinguishable from a missing one — one identical 404.
  app.get('/api/screenhosts/statements/:id/pdf', ownerGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .select({
        pdfKey: screenhostFactures.pdfKey,
        reference: screenhostFactures.reference,
        ownerId: screenhosts.ownerId,
      })
      .from(screenhostFactures)
      .innerJoin(screenhosts, eq(screenhosts.id, screenhostFactures.screenhostId))
      .where(eq(screenhostFactures.id, parsed.data.id))
      .limit(1);
    if (!row || row.ownerId !== userId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such facture.' });
    }
    const result = await storage.download({ key: row.pdfKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not fetch the facture. Please retry.',
      });
    }
    return reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="facture-${row.reference}.pdf"`)
      .send(result.body);
  });

  // POST /api/screenhosts/statements/:id/signed-deposit — the owner returns the signed, stamped
  // document. Multipart, the justificatif sniffing/caps idiom.
  //
  // A RE-DEPOSIT REPLACES: the key is derived from the facture id, so the object is overwritten in
  // place and exactly ONE file ever exists per facture — « le dernier fichier déposé remplace le
  // précédent », which is the rule the UI states.
  app.post('/api/screenhosts/statements/:id/signed-deposit', ownerGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .select({
        id: screenhostFactures.id,
        status: screenhostFactures.status,
        ownerId: screenhosts.ownerId,
        venueName: screenhosts.name,
        month: screenhostFactures.month,
      })
      .from(screenhostFactures)
      .innerJoin(screenhosts, eq(screenhosts.id, screenhostFactures.screenhostId))
      .where(eq(screenhostFactures.id, parsed.data.id))
      .limit(1);
    if (!row || row.ownerId !== userId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such facture.' });
    }
    // A facture already paid is closed: re-depositing against it would silently reopen a settled
    // document. Refusals are 409 (the recharge-moderation idiom), never a silent no-op.
    if (row.status === 'payee') {
      return reply.status(409).send({
        error: 'FACTURE_CLOSED',
        message: 'Cette facture est déjà payée et n’accepte plus de dépôt.',
      });
    }

    const data = await request.file({ limits: { fileSize: MAX_JUSTIFICATIF_BYTES } });
    if (!data) return invalidField(reply, 'file', 'a signed document is required');
    const body = await data.toBuffer();
    if (body.length === 0) return invalidField(reply, 'file', 'the file is empty');

    // Byte-sniff, never trust the declared type (the CF-M2/CF-SH1 posture).
    const sniffed = sniffContainer(body);
    if (!sniffed || !declaredMatchesSniffed(data.mimetype, sniffed)) {
      return invalidField(reply, 'file', 'unsupported or mismatched file type');
    }

    const key = signedFactureKey(row.id);
    const uploaded = await storage.upload({ key, body, contentType: data.mimetype });
    if ('error' in uploaded) {
      return reply
        .status(502)
        .send({ error: 'STORAGE_ERROR', message: 'Le dépôt a échoué. Merci de réessayer.' });
    }

    await db
      .update(screenhostFactures)
      .set({
        signedFileKey: key,
        signedFileMime: data.mimetype,
        depositedAt: new Date(),
        // The ONE transition this lane performs. Everything past this belongs to REV3.
        status: 'en_verification',
      })
      .where(eq(screenhostFactures.id, row.id));

    await db.insert(notifications).values({
      userId,
      type: 'screenhost_facture_deposited',
      title: 'Facture signée reçue',
      body: `Votre facture de ${monthLabelFr(row.month)} pour « ${row.venueName} » a bien été reçue.`,
    });

    return reply.status(200).send({ id: row.id, deposited: true });
  });
};
