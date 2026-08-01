import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  notifications,
  screenhostFactureActions,
  screenhostFactures,
  screenhostVersements,
  screenhosts,
  users,
} from '../db/schema.js';
import { ttcFromHt } from '../lib/facture.js';
import { monthLabelFr } from '../lib/report/monthly-job.js';
import { maskedPayoutLabel } from '../lib/versement-mode.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

import { factureDesignation } from './owner-statements.js';

// REV3 — admin « Factures Screenhost » (US-REV-7..11). The moderation surface for the supplier
// invoices REV2 emits, following the admin-recharges idiom exactly: every route is
// [requireAuth, requireAdmin]; the transition predicate is re-encoded in the UPDATE's WHERE so a
// decision is ATOMIC and two concurrent clicks cannot both win; a lost race re-reads and 409s.
//
// THE STATUS PILL LIVES HERE AND ONLY HERE. §5 forbids a status on an OWNER surface — the admin is
// the sole exception, and the admin wire is the only one that carries `status`.
//
// THE TRANSITION MATRIX. Four actions, each legal from exactly one status. Anything else is a 409
// with a French message — never a silent no-op, and never a "fix it up" branch:
//
//   valider        en_verification → en_paiement   + WRITES the versement + trace + notification
//   refuser        en_verification → refusee       + motif (REQUIRED) + trace + notification
//   marquer-payee  en_paiement     → payee         + trace + notification. WRITES NOTHING to
//                                                    screenhost_versements — the money already
//                                                    moved at validation; this records that it
//                                                    cleared. Pinned by test.
//   paper          emise (never deposited) → payee + WRITES the versement + trace + notification
//
// THE PAPER PATH exists because a facture can be handed over physically and never travel through
// the deposit flow at all. It is ONE action doing what valider+marquer-payee do together, and it is
// guarded on `deposited_at IS NULL`: a facture that WAS deposited must go through the normal
// review, or the admin would be paying a document nobody verified.

const idParamSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({
  statut: z.enum(['emise', 'en_verification', 'en_paiement', 'refusee', 'payee']).optional(),
});
// Trimmed + non-empty: « » is not a motif. The owner reads this string in their notification.
const refuserBodySchema = z.object({ motif: z.string().trim().min(1).max(2000) });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

const notFound = (reply: FastifyReply) =>
  reply.status(404).send({ error: 'NOT_FOUND', message: 'No such facture.' });

/** The 409 every out-of-matrix call returns. French — it reaches the admin UI verbatim. */
const outOfMatrix = (reply: FastifyReply, message: string, currentStatus: string) =>
  reply.status(409).send({ error: 'CONFLICT', message, statusCode: 409, currentStatus });

export const adminFacturesRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  /** The row every action needs: the facture, its venue, and the OWNER whose account gets paid. */
  const loadFacture = async (id: string) => {
    const [row] = await db
      .select({
        id: screenhostFactures.id,
        reference: screenhostFactures.reference,
        month: screenhostFactures.month,
        totalShTnd: screenhostFactures.totalShTnd,
        status: screenhostFactures.status,
        depositedAt: screenhostFactures.depositedAt,
        signedFileKey: screenhostFactures.signedFileKey,
        venueName: screenhosts.name,
        ownerId: screenhosts.ownerId,
      })
      .from(screenhostFactures)
      .innerJoin(screenhosts, eq(screenhosts.id, screenhostFactures.screenhostId))
      .where(eq(screenhostFactures.id, id))
      .limit(1);
    return row;
  };

  /**
   * Build the versement's four FROZEN fields from what is true right now.
   *
   * The masked label is computed HERE, at write time, from the owner's CURRENT coordinates — that
   * single call is what freezes it. Nothing downstream ever recomputes it.
   */
  const buildVersement = async (
    facture: NonNullable<Awaited<ReturnType<typeof loadFacture>>>,
    adminId: string,
  ) => {
    const ownerId = facture.ownerId;
    if (!ownerId) return null;
    const [owner] = await db
      .select({ rib: users.bankRib, iban: users.bankIban })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    return {
      factureId: facture.id,
      userId: ownerId,
      designation: factureDesignation(facture.month),
      // Montant = the facture's TTC, not its HT: the versement is what Toodooh PAYS, and the
      // facture claims TTC. Derived through the same ttcFromHt the document itself used.
      montantTtc: ttcFromHt(Number(facture.totalShTnd)).toFixed(4),
      modeLabelMasked: maskedPayoutLabel(owner?.rib, owner?.iban),
      createdBy: adminId,
    };
  };

  // GET /api/admin/screenhost-factures[?statut=] — every facture, newest month first, with the
  // status the pill renders. Admin-only: this is the one wire that carries `status`.
  app.get('/api/admin/screenhost-factures', adminGuard, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return invalidField(
        reply,
        'statut',
        'must be emise, en_verification, en_paiement, refusee or payee',
      );
    }
    const { statut } = parsed.data;
    const rows = await db
      .select({
        id: screenhostFactures.id,
        reference: screenhostFactures.reference,
        screenhost_id: screenhostFactures.screenhostId,
        screenhost_name: screenhosts.name,
        month: screenhostFactures.month,
        total_sh_tnd: screenhostFactures.totalShTnd,
        status: screenhostFactures.status,
        refusal_motif: screenhostFactures.refusalMotif,
        deposited_at: screenhostFactures.depositedAt,
        created_at: screenhostFactures.createdAt,
      })
      .from(screenhostFactures)
      .innerJoin(screenhosts, eq(screenhosts.id, screenhostFactures.screenhostId))
      .where(statut ? eq(screenhostFactures.status, statut) : undefined)
      .orderBy(desc(screenhostFactures.month), desc(screenhostFactures.createdAt));
    return reply.status(200).send(
      rows.map((r) => ({
        ...r,
        total_sh_tnd: Number(r.total_sh_tnd),
        // The admin table's « Montant » column is the TTC the owner will be paid.
        montant_ttc: ttcFromHt(Number(r.total_sh_tnd)),
        designation: factureDesignation(r.month),
        deposited_at: r.deposited_at ? r.deposited_at.toISOString() : null,
      })),
    );
  });

  // GET /api/admin/screenhost-factures/:id/signed-url — « Voir »: a short-TTL presigned view of the
  // SIGNED document the owner deposited (the admin-recharges document-url posture, 300 s). A
  // facture with no deposit is a plain 404 — there is nothing to look at.
  app.get('/api/admin/screenhost-factures/:id/signed-url', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const [row] = await db
      .select({ signedFileKey: screenhostFactures.signedFileKey })
      .from(screenhostFactures)
      .where(eq(screenhostFactures.id, parsed.data.id))
      .limit(1);
    if (!row || row.signedFileKey === null) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such document.' });
    }
    const result = await storage.getPresignedUrl({ key: row.signedFileKey, expiresInSeconds: 300 });
    if ('error' in result) {
      return reply
        .status(502)
        .send({ error: 'STORAGE_ERROR', message: 'Could not generate a document URL. Retry.' });
    }
    return reply.status(200).send({ url: result.url });
  });

  // POST …/valider — en_verification ONLY → en_paiement, AND writes the versement line.
  //
  // The whole thing is one transaction: the status flip, the versement, the trace and the
  // notification land together or not at all. A half-applied validation would either pay an owner
  // with no record or record a payment that never moved.
  app.post('/api/admin/screenhost-factures/:id/valider', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const adminId = request.user?.id;
    if (!adminId) return sendUnauthenticated(reply);

    const facture = await loadFacture(parsed.data.id);
    if (!facture) return notFound(reply);
    if (facture.status !== 'en_verification') {
      return outOfMatrix(
        reply,
        'Seule une facture en vérification peut être validée.',
        facture.status,
      );
    }
    const versement = await buildVersement(facture, adminId);
    if (!versement) {
      return outOfMatrix(reply, 'Cette facture n’a pas de propriétaire à payer.', facture.status);
    }

    const done = await db.transaction(async (tx) => {
      const [flipped] = await tx
        .update(screenhostFactures)
        .set({ status: 'en_paiement' })
        .where(
          and(
            eq(screenhostFactures.id, facture.id),
            eq(screenhostFactures.status, 'en_verification'),
          ),
        )
        .returning();
      if (!flipped) return null;
      await tx.insert(screenhostVersements).values(versement);
      await tx.insert(screenhostFactureActions).values({
        factureId: facture.id,
        adminId,
        action: 'valider',
      });
      await tx.insert(notifications).values({
        userId: versement.userId,
        type: 'screenhost_facture_validated',
        title: 'Facture validée',
        body: `Votre facture de ${monthLabelFr(facture.month)} pour « ${facture.venueName} » a été validée. Le versement est en cours de paiement.`,
      });
      return flipped;
    });
    if (!done) {
      const current = await loadFacture(facture.id);
      return outOfMatrix(
        reply,
        'Seule une facture en vérification peut être validée.',
        current?.status ?? facture.status,
      );
    }
    return reply.status(200).send({ id: facture.id, status: 'en_paiement' });
  });

  // POST …/refuser {motif} — en_verification ONLY → refusee. The motif is REQUIRED (400 without)
  // and reaches the owner verbatim in their notification: a refusal the owner cannot act on is a
  // dead end, and « refusée » with no reason is exactly that.
  app.post('/api/admin/screenhost-factures/:id/refuser', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsedBody = refuserBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) return invalidField(reply, 'motif', 'un motif est requis');
    const adminId = request.user?.id;
    if (!adminId) return sendUnauthenticated(reply);

    const facture = await loadFacture(parsed.data.id);
    if (!facture) return notFound(reply);
    if (facture.status !== 'en_verification') {
      return outOfMatrix(
        reply,
        'Seule une facture en vérification peut être refusée.',
        facture.status,
      );
    }
    const { motif } = parsedBody.data;

    const done = await db.transaction(async (tx) => {
      const [flipped] = await tx
        .update(screenhostFactures)
        .set({ status: 'refusee', refusalMotif: motif })
        .where(
          and(
            eq(screenhostFactures.id, facture.id),
            eq(screenhostFactures.status, 'en_verification'),
          ),
        )
        .returning();
      if (!flipped) return null;
      await tx
        .insert(screenhostFactureActions)
        .values({ factureId: facture.id, adminId, action: 'refuser', motif });
      if (facture.ownerId) {
        await tx.insert(notifications).values({
          userId: facture.ownerId,
          type: 'screenhost_facture_refused',
          title: 'Facture refusée',
          body: `Votre facture de ${monthLabelFr(facture.month)} pour « ${facture.venueName} » a été refusée. Motif : ${motif}. Vous pouvez déposer une nouvelle facture signée.`,
        });
      }
      return flipped;
    });
    if (!done) {
      const current = await loadFacture(facture.id);
      return outOfMatrix(
        reply,
        'Seule une facture en vérification peut être refusée.',
        current?.status ?? facture.status,
      );
    }
    return reply.status(200).send({ id: facture.id, status: 'refusee' });
  });

  // POST …/marquer-payee — en_paiement ONLY → payee.
  //
  // IT MUST NOT TOUCH screenhost_versements. The versement was written at validation; this action
  // records that the transfer cleared, not that a second payment happened. Writing (or editing) a
  // line here would double the owner's history for one facture. Pinned by test.
  app.post(
    '/api/admin/screenhost-factures/:id/marquer-payee',
    adminGuard,
    async (request, reply) => {
      const parsed = idParamSchema.safeParse(request.params);
      if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
      const adminId = request.user?.id;
      if (!adminId) return sendUnauthenticated(reply);

      const facture = await loadFacture(parsed.data.id);
      if (!facture) return notFound(reply);
      if (facture.status !== 'en_paiement') {
        return outOfMatrix(
          reply,
          'Seule une facture en cours de paiement peut être marquée payée.',
          facture.status,
        );
      }

      const done = await db.transaction(async (tx) => {
        const [flipped] = await tx
          .update(screenhostFactures)
          .set({ status: 'payee' })
          .where(
            and(
              eq(screenhostFactures.id, facture.id),
              eq(screenhostFactures.status, 'en_paiement'),
            ),
          )
          .returning();
        if (!flipped) return null;
        await tx.insert(screenhostFactureActions).values({
          factureId: facture.id,
          adminId,
          action: 'marquer_payee',
        });
        if (facture.ownerId) {
          await tx.insert(notifications).values({
            userId: facture.ownerId,
            type: 'screenhost_facture_paid',
            title: 'Facture payée',
            body: `Votre facture de ${monthLabelFr(facture.month)} pour « ${facture.venueName} » a été payée.`,
          });
        }
        return flipped;
      });
      if (!done) {
        const current = await loadFacture(facture.id);
        return outOfMatrix(
          reply,
          'Seule une facture en cours de paiement peut être marquée payée.',
          current?.status ?? facture.status,
        );
      }
      return reply.status(200).send({ id: facture.id, status: 'payee' });
    },
  );

  // POST …/paper — THE PAPER PATH. emise AND never deposited → payee in ONE action, writing the
  // versement the normal route would have written at validation.
  //
  // The `deposited_at IS NULL` guard is the point: a facture the owner DID deposit has a document
  // waiting to be checked, and paying it through here would skip the check entirely.
  app.post('/api/admin/screenhost-factures/:id/paper', adminGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const adminId = request.user?.id;
    if (!adminId) return sendUnauthenticated(reply);

    const facture = await loadFacture(parsed.data.id);
    if (!facture) return notFound(reply);
    if (facture.status !== 'emise') {
      return outOfMatrix(
        reply,
        'Seule une facture émise peut être réglée en main propre.',
        facture.status,
      );
    }
    if (facture.depositedAt !== null) {
      return outOfMatrix(
        reply,
        'Cette facture a déjà été déposée : elle doit suivre la vérification.',
        facture.status,
      );
    }
    const versement = await buildVersement(facture, adminId);
    if (!versement) {
      return outOfMatrix(reply, 'Cette facture n’a pas de propriétaire à payer.', facture.status);
    }

    const done = await db.transaction(async (tx) => {
      const [flipped] = await tx
        .update(screenhostFactures)
        .set({ status: 'payee' })
        .where(
          and(
            eq(screenhostFactures.id, facture.id),
            eq(screenhostFactures.status, 'emise'),
            isNull(screenhostFactures.depositedAt),
          ),
        )
        .returning();
      if (!flipped) return null;
      await tx.insert(screenhostVersements).values(versement);
      await tx.insert(screenhostFactureActions).values({
        factureId: facture.id,
        adminId,
        action: 'paper_payee',
      });
      await tx.insert(notifications).values({
        userId: versement.userId,
        type: 'screenhost_facture_paid',
        title: 'Facture payée',
        body: `Votre facture de ${monthLabelFr(facture.month)} pour « ${facture.venueName} » a été payée.`,
      });
      return flipped;
    });
    if (!done) {
      const current = await loadFacture(facture.id);
      return outOfMatrix(
        reply,
        'Seule une facture émise peut être réglée en main propre.',
        current?.status ?? facture.status,
      );
    }
    return reply.status(200).send({ id: facture.id, status: 'payee' });
  });
};
