import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { agentPayouts, agents, users } from '../db/schema.js';
import { agentRibState } from '../lib/agent-sheet.js';
import {
  MONTH_RE,
  agentWallet,
  markAgentPayoutPaid,
  prepareAgentPayouts,
} from '../lib/agent-wallet.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

import { agentCgeGate } from './agent-account.js';

// AGT-3 (agent specs v1.0 §10) — the agent's wallet and payouts: the agent reads his balance and
// « Mes versements » and, as a Screencaster agent, uploads the month's invoice (ruling Q5 A); the
// hub prepares a month, reads the queue, opens the invoice and marks a payout done.

const agentGuard = {
  preHandler: [requireAuth, requireRole('screenhost_agent', 'screencast_agent'), agentCgeGate],
};
const staffGuard = { preHandler: [requireAuth, requireRole('admin', 'superadmin')] };
const idParam = z.object({ id: z.uuid() });
const monthSchema = z.object({ month: z.string().regex(MONTH_RE) });
const paidSchema = z.object({ transfer_date: z.iso.date() });
const INVOICE_MAX_BYTES = 10 * 1024 * 1024;

const invalid = (reply: FastifyReply, issues: z.core.$ZodIssue[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

const payoutView = (p: typeof agentPayouts.$inferSelect) => ({
  id: p.id,
  month: p.month,
  amount_tnd: Number(p.amountTnd),
  status: p.status,
  transfer_date: p.transferDate,
  invoice_file_name: p.invoiceFileName,
  invoice_uploaded_at: p.invoiceUploadedAt?.toISOString() ?? null,
  prepared_at: p.preparedAt.toISOString(),
  paid_at: p.paidAt?.toISOString() ?? null,
});

export const agentWalletRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: { fileSize: INVOICE_MAX_BYTES, files: 1, fields: 0 },
  });

  // GET /api/agent/wallet — Revenu actuel / cumulés / prévisionnel + « Mes versements ».
  app.get('/api/agent/wallet', agentGuard, async (request, reply) => {
    const id = request.user?.id ?? '';
    const payouts = await db
      .select()
      .from(agentPayouts)
      .where(eq(agentPayouts.agentUserId, id))
      .orderBy(desc(agentPayouts.month));
    return reply.status(200).send({
      ...(await agentWallet(id)),
      invoice_required: request.user?.role === 'screencast_agent',
      payouts: payouts.map(payoutView),
    });
  });

  // POST /api/agent/payouts/:id/invoice (multipart PDF) — the Screencaster agent's invoice for
  // a payout still in preparation; a new upload replaces the previous one.
  app.post(
    '/api/agent/payouts/:id/invoice',
    { preHandler: [...agentGuard.preHandler, requireRole('screencast_agent')] },
    async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return invalid(reply, params.error.issues);
      const [payout] = await db
        .select()
        .from(agentPayouts)
        .where(
          and(
            eq(agentPayouts.id, params.data.id),
            eq(agentPayouts.agentUserId, request.user?.id ?? ''),
          ),
        )
        .limit(1);
      if (!payout) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No payout.' });
      if (payout.status !== 'en_preparation') {
        return reply.status(409).send({ error: 'ALREADY_PAID', message: 'Payout already done.' });
      }
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'file', reason: 'a file is required' }],
        });
      }
      let body: Buffer;
      try {
        body = await data.toBuffer();
      } catch {
        return reply.status(413).send({ error: 'PAYLOAD_TOO_LARGE', message: 'File too large.' });
      }
      if (data.mimetype !== 'application/pdf' || body.subarray(0, 5).toString() !== '%PDF-') {
        return reply
          .status(400)
          .send({ error: 'NOT_A_PDF', message: 'La facture doit être un PDF.' });
      }
      const key = `agent-invoices/${payout.agentUserId}/${payout.month}-${randomUUID()}.pdf`;
      const up = await storage.upload({ key, body, contentType: 'application/pdf' });
      if ('error' in up)
        return reply.status(502).send({ error: 'STORAGE_ERROR', message: 'Storage.' });
      const [row] = await db
        .update(agentPayouts)
        .set({ invoiceKey: key, invoiceFileName: data.filename, invoiceUploadedAt: new Date() })
        .where(eq(agentPayouts.id, payout.id))
        .returning();
      return reply.status(200).send(row ? payoutView(row) : null);
    },
  );

  // GET /api/admin/agent-payouts?month=YYYY-MM — the month's payouts with the agent and RIB state.
  app.get('/api/admin/agent-payouts', staffGuard, async (request, reply) => {
    const q = monthSchema.safeParse(request.query ?? {});
    if (!q.success) return invalid(reply, q.error.issues);
    const rows = await db
      .select({ payout: agentPayouts, user: users, code: agents.code })
      .from(agentPayouts)
      .innerJoin(users, eq(users.id, agentPayouts.agentUserId))
      .innerJoin(agents, eq(agents.userId, agentPayouts.agentUserId))
      .where(eq(agentPayouts.month, q.data.month))
      .orderBy(users.contactName);
    const payouts = await Promise.all(
      rows.map(async (r) => ({
        ...payoutView(r.payout),
        agent_id: r.user.id,
        agent_name: r.user.contactName,
        agent_code: r.code,
        role: r.user.role,
        rib_validated: (await agentRibState(r.user.id)).validated,
        invoice_required: r.user.role === 'screencast_agent',
      })),
    );
    return reply.status(200).send({ payouts });
  });

  // POST /api/admin/agent-payouts/prepare { month } — prepare the month (idempotent per agent).
  app.post('/api/admin/agent-payouts/prepare', staffGuard, async (request, reply) => {
    const body = monthSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const result = await prepareAgentPayouts(body.data.month, request.user?.id ?? null);
    return reply.status(200).send(result);
  });

  // POST /api/admin/agent-payouts/:id/paid { transfer_date } — the transfer went out.
  app.post('/api/admin/agent-payouts/:id/paid', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const body = paidSchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply, body.error.issues);
    const result = await markAgentPayoutPaid(
      params.data.id,
      request.user?.id ?? null,
      body.data.transfer_date,
    );
    if (!result.ok) {
      const status = result.error === 'NOT_FOUND' ? 404 : 409;
      return reply.status(status).send({ error: result.error, message: result.error });
    }
    return reply.status(200).send({ ok: true });
  });

  // GET /api/admin/agent-payouts/:id/invoice-url — a short-lived link to the agent's invoice.
  app.get('/api/admin/agent-payouts/:id/invoice-url', staffGuard, async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return invalid(reply, params.error.issues);
    const [p] = await db
      .select({ key: agentPayouts.invoiceKey })
      .from(agentPayouts)
      .where(eq(agentPayouts.id, params.data.id))
      .limit(1);
    if (!p?.key) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No invoice.' });
    const url = await storage.getPresignedUrl({ key: p.key });
    if ('error' in url)
      return reply.status(502).send({ error: 'STORAGE_ERROR', message: 'Storage.' });
    return reply.status(200).send({ url: url.url });
  });
};
