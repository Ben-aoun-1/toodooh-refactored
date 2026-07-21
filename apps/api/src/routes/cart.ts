import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { cartItems, campaigns, creatives } from '../db/schema.js';
import { MIN_CAMPAIGN_BUDGET_TND } from '../lib/campaign-budget.js';
import { computeCampaignCmax } from '../lib/campaign-cmax.js';
import { startDateViolation } from '../lib/campaign-dates.js';
import { getDispatchConfig } from '../lib/dispatch/config.js';
import { walletBalance } from '../lib/recharges.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

import { type CampaignRow, campaignSelection, campaignView } from './campaigns.js';

// CF-C1 (spec §1.10–1.14) — the panier: finished DRAFT campaigns queued for ONE
// « Confirmer et lancer ». Adding requires a COMPLETE draft (dates + floor, creative, budget in
// [100, live C_max]); removing keeps the draft (« conserver en brouillon »); confirm revalidates
// EVERY item against live state + the solde, then flips them all draft → pending in ONE
// transaction with the cart rows cleared. NO MONEY MOVES HERE: the activation funding gate
// (balance ≥ budget at admin activation) and the settlement debit (reconciliation) are UNCHANGED
// — the cart only sequences the submits. Every read/write is owner-scoped (foreign ≡ missing 404).

const addBodySchema = z.object({ campaign_id: z.uuid() });
const campaignIdParamSchema = z.object({ campaign_id: z.uuid() });

const sendUnauthenticated = (reply: FastifyReply) =>
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });

// One row shape for the gate: the campaign + its creative duration (the C_max spot length).
interface GateRow {
  campaign: CampaignRow & { advertiserId: string };
  creativeDurationSeconds: number | null;
}

/**
 * The completeness gate shared by add and confirm — returns the PRECISE machine reason, or null
 * when the campaign is launchable. Mirrors the submit gates (CF-S1 dates, CF-Q2 floor, CF-U3
 * budget minimum, E5 ceiling) so the cart can never hold a promise the submit would refuse.
 */
const cartGateReason = async (row: GateRow, leadWorkingDays: number): Promise<string | null> => {
  const c = row.campaign;
  if (c.status !== 'draft') return 'NOT_DRAFT';
  if (!c.startDate || !c.endDate) return 'MISSING_DATES';
  if (startDateViolation(c.startDate, new Date(), leadWorkingDays)) return 'INVALID_START_DATE';
  if (
    c.creativeId === null ||
    row.creativeDurationSeconds === null ||
    row.creativeDurationSeconds <= 0
  ) {
    return 'MISSING_CREATIVE';
  }
  if (c.requestedBudget === null || Number(c.requestedBudget) <= 0) return 'MISSING_BUDGET';
  if (Number(c.requestedBudget) < MIN_CAMPAIGN_BUDGET_TND) return 'BUDGET_BELOW_MINIMUM';
  const cmax = await computeCampaignCmax(
    { id: c.id, startDate: c.startDate, endDate: c.endDate, campaignType: c.campaignType },
    row.creativeDurationSeconds,
  );
  if (Number(c.requestedBudget) > cmax.cMaxTnd) return 'BUDGET_EXCEEDS_CMAX';
  return null;
};

const loadGateRow = async (campaignId: string, userId: string): Promise<GateRow | null> => {
  const [row] = await db
    .select({
      campaign: { ...campaignSelection, advertiserId: campaigns.advertiserId },
      creativeDurationSeconds: creatives.durationSeconds,
    })
    .from(campaigns)
    .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.advertiserId, userId)))
    .limit(1);
  return row ?? null;
};

export const cartRoutes: FastifyPluginAsync = async (app) => {
  const advertiserGuard = { preHandler: [requireAuth, requireAdvertiser] };

  // POST /api/cart/items {campaign_id} — add a COMPLETE draft to the panier. Idempotent: a
  // re-add of an already-carted campaign is a 200 (the cart holds one row per campaign).
  app.post('/api/cart/items', advertiserGuard, async (request, reply) => {
    const parsed = addBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'campaign_id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const row = await loadGateRow(parsed.data.campaign_id, userId);
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such campaign.' });

    const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
    const reason = await cartGateReason(row, lead);
    if (reason !== null) {
      return reply.status(400).send({
        error: reason,
        message: 'The campaign is not ready for the cart.',
      });
    }

    // Idempotent add: the UNIQUE(campaign_id) makes the second insert a no-op.
    await db
      .insert(cartItems)
      .values({ userId, campaignId: row.campaign.id })
      .onConflictDoNothing();
    const [item] = await db
      .select({ campaignId: cartItems.campaignId, addedAt: cartItems.addedAt })
      .from(cartItems)
      .where(eq(cartItems.campaignId, row.campaign.id))
      .limit(1);
    return reply
      .status(200)
      .send({ campaign_id: item?.campaignId, added_at: item?.addedAt ?? null });
  });

  // DELETE /api/cart/items/:campaign_id — « conserver en brouillon »: the item leaves the cart,
  // the campaign STAYS a draft (and re-exposes to the CF-S2 deletion tick).
  app.delete('/api/cart/items/:campaign_id', advertiserGuard, async (request, reply) => {
    const parsed = campaignIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'campaign_id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const [removed] = await db
      .delete(cartItems)
      .where(and(eq(cartItems.campaignId, parsed.data.campaign_id), eq(cartItems.userId, userId)))
      .returning({ campaignId: cartItems.campaignId });
    if (!removed) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'No such cart item.' });
    }
    return reply.status(200).send({ removed: true, campaign_id: removed.campaignId });
  });

  // GET /api/cart — the caller's items joined with the campaign projection, plus the HT total.
  app.get('/api/cart', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    const rows = await db
      .select({
        campaign: campaignSelection,
        addedAt: cartItems.addedAt,
        contentValidationStatus: creatives.validationStatus,
      })
      .from(cartItems)
      .innerJoin(campaigns, eq(cartItems.campaignId, campaigns.id))
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .where(eq(cartItems.userId, userId))
      .orderBy(cartItems.addedAt);
    const items = rows.map((r) => ({
      ...campaignView(r.campaign as CampaignRow, r.contentValidationStatus),
      added_at: r.addedAt,
    }));
    const totalHt = rows.reduce(
      (sum, r) =>
        sum + (r.campaign.requestedBudget === null ? 0 : Number(r.campaign.requestedBudget)),
      0,
    );
    return reply.status(200).send({ items, total_ht: totalHt, count: items.length });
  });

  // POST /api/cart/confirm — ONE confirm launches them all (spec §1.12/§1.13): revalidate EVERY
  // item against LIVE state (the same gates as add — dates/floor, budget floor, C_max), then the
  // solde (walletBalance ≥ Σ budgets HT). ANY failure → 400 with per-item reasons and the cart
  // INTACT. Success → ONE transaction flips every campaign draft → pending (submittedAt stamped,
  // any rejection audit shed — the resubmit convention) and clears the cart rows. NO money moves:
  // the activation funding gate and the settlement debit are UNCHANGED — the cart only sequences
  // the submits.
  app.post('/api/cart/confirm', advertiserGuard, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const carted = await db
      .select({ campaignId: cartItems.campaignId })
      .from(cartItems)
      .where(eq(cartItems.userId, userId))
      .orderBy(cartItems.addedAt);
    if (carted.length === 0) {
      return reply.status(400).send({ error: 'CART_EMPTY', message: 'The cart is empty.' });
    }

    const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
    const failures: { campaign_id: string; reason: string }[] = [];
    let requiredHt = 0;
    for (const { campaignId } of carted) {
      const row = await loadGateRow(campaignId, userId);
      if (!row) {
        failures.push({ campaign_id: campaignId, reason: 'NOT_FOUND' });
        continue;
      }
      const reason = await cartGateReason(row, lead);
      if (reason !== null) failures.push({ campaign_id: campaignId, reason });
      else requiredHt += Number(row.campaign.requestedBudget ?? 0);
    }
    if (failures.length > 0) {
      return reply.status(400).send({
        error: 'CART_CONFIRM_FAILED',
        message: 'One or more cart items are no longer launchable.',
        items: failures,
      });
    }

    // The solde gate (HT — the wallet credits HT; TVA lives on the facture, not the balance).
    const balance = (await walletBalance(userId)).balance_tnd;
    if (balance < requiredHt) {
      return reply.status(400).send({
        error: 'CART_CONFIRM_FAILED',
        message: 'Insufficient balance to launch the cart.',
        items: [],
        solde: { balance, required: requiredHt },
      });
    }

    const campaignIds = carted.map((c) => c.campaignId);
    const confirmed = await db
      .transaction(async (tx) => {
        const updated = await tx
          .update(campaigns)
          .set({ status: 'pending', submittedAt: new Date(), rejectedAt: null, rejectReason: null })
          .where(
            and(
              inArray(campaigns.id, campaignIds),
              eq(campaigns.advertiserId, userId),
              eq(campaigns.status, 'draft'),
            ),
          )
          .returning(campaignSelection);
        if (updated.length !== campaignIds.length) {
          // A mid-flight race (an item flipped between revalidation and here): all-or-nothing.
          throw new Error('CART_CONFIRM_RACE');
        }
        await tx.delete(cartItems).where(eq(cartItems.userId, userId));
        return updated;
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === 'CART_CONFIRM_RACE') return null;
        throw err;
      });
    if (confirmed === null) {
      return reply.status(400).send({
        error: 'CART_CONFIRM_FAILED',
        message: 'One or more cart items changed during the confirm. Nothing was launched.',
        items: [],
      });
    }
    return reply
      .status(200)
      .send({ confirmed: confirmed.map((row) => campaignView(row as CampaignRow)) });
  });
};
