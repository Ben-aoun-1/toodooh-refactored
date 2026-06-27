import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { recharges } from '../db/schema.js';
import {
  MAX_RECHARGE_TND,
  isValidAmount,
  makeReference,
  rechargeView,
  walletBalance,
} from '../lib/recharges.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

// Advertiser wallet surface (L-wallet) — a screencaster (advertiser role) tops up by BANK TRANSFER
// (no online gateway). POST creates a PENDING recharge + a facture reference; an admin later confirms
// receipt (routes/admin-recharges.ts) to credit the DERIVED balance. Every read/write is owner-scoped
// to the authenticated advertiser (a foreign recharge is indistinguishable from a missing one → 404).

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

export const rechargesRoutes: FastifyPluginAsync = async (app) => {
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
};
