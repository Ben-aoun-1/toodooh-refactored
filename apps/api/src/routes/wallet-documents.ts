import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type MonthlyInvoice, monthlyInvoices, walletAdjustments } from '../db/schema.js';
import { adjustmentView } from '../lib/wallet-adjustments.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// FCT2 — the screencaster's money documents (US-FCT-11..12): the MONTHLY consolidated invoices
// (list + stored-PDF download, the monthly-report serving posture — through the api, owner-auth,
// never presigned) and the wallet-adjustment history (the third ledger row type). The per-recharge
// « Récapitulatif de commande » stays in routes/recharges.ts.

const idParamSchema = z.object({ id: z.uuid() });

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation failed', fields: [{ field, reason }] });

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

const invoiceView = (row: MonthlyInvoice) => ({
  id: row.id,
  month: row.month,
  total_ht: Number(row.totalHt),
  tva_tnd: Number(row.tvaTnd),
  total_ttc: Number(row.totalTtc),
  reference: row.reference,
  created_at: row.createdAt,
});

export const walletDocumentsRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // GET /api/wallet/adjustments — the caller's adjustment history, newest first (amount signed,
  // reason included — the screencaster sees why; the admin id stays internal).
  app.get('/api/wallet/adjustments', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const rows = await db
      .select()
      .from(walletAdjustments)
      .where(eq(walletAdjustments.advertiserId, userId))
      .orderBy(desc(walletAdjustments.createdAt));
    return reply.status(200).send(rows.map(adjustmentView));
  });

  // GET /api/wallet/invoices — the caller's monthly consolidated invoices, newest month first.
  app.get('/api/wallet/invoices', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const rows = await db
      .select()
      .from(monthlyInvoices)
      .where(eq(monthlyInvoices.advertiserId, userId))
      .orderBy(desc(monthlyInvoices.month));
    return reply.status(200).send(rows.map(invoiceView));
  });

  // GET /api/wallet/invoices/:id/pdf — stream the STORED invoice PDF (byte-stable fiscal
  // document). A foreign invoice is indistinguishable from a missing one — one identical 404.
  app.get('/api/wallet/invoices/:id/pdf', advertiserGuard, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params);
    if (!parsed.success) return invalidField(reply, 'id', 'must be a uuid');
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const [row] = await db
      .select({ pdfKey: monthlyInvoices.pdfKey, reference: monthlyInvoices.reference })
      .from(monthlyInvoices)
      .where(and(eq(monthlyInvoices.id, parsed.data.id), eq(monthlyInvoices.advertiserId, userId)))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such invoice.' });
    const result = await storage.download({ key: row.pdfKey });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not fetch the invoice. Please retry.',
      });
    }
    return reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="facture-${row.reference}.pdf"`)
      .send(result.body);
  });
};
