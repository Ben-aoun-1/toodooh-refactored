import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { type Campaign, cartItems, campaigns, creatives, events } from '../db/schema.js';
import { finalizeActivation, prepareActivation } from '../lib/activation-service.js';
import { accountLabel, notifyAdmins } from '../lib/admin-notifications.js';
import { isBelowCampaignMinimum } from '../lib/campaign-budget.js';
import { computeCampaignCmax } from '../lib/campaign-cmax.js';
import { startDateViolation } from '../lib/campaign-dates.js';
import { demoAirsAt, demoDelayMinutes, isDemoUser } from '../lib/demo.js';
import { campaignCpmRates, getDispatchConfig } from '../lib/dispatch/config.js';
import { checkEventMinutes } from '../lib/event-minutes-gate.js';
import { positioningPlaysPerMinute } from '../lib/event-pricing/spot.js';
import { pushPlaylistToAllConnected } from '../lib/playout/push.js';
import { walletSpendable } from '../lib/recharges.js';
import { ctaCartBlock } from '../lib/spot-cta.js';
import { dropTypicalWeekFreeze, freezeTypicalWeek } from '../lib/typical-week-freeze.js';
import { requireAdvertiser } from '../middleware/require-advertiser.js';
import { requireAuth } from '../middleware/require-auth.js';

import { type CampaignRow, campaignSelection, campaignView } from './campaigns.js';
import { eventView } from './events.js';

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
  reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });

// One row shape for the gate: the campaign + its creative duration (the C_max spot length).
// CPM-2 — plus the campaign's own T tiers (the C_max prices at them, never the live config).
interface GateRow {
  campaign: CampaignRow & { advertiserId: string; t10s: string; t20s: string; t30s: string };
  creativeDurationSeconds: number | null;
  /** CF-SK1 — 'approved' ⇒ this item SKIPS review and activates at confirm (ruling #9). */
  contentValidationStatus: string | null;
}

/**
 * The completeness gate shared by add and confirm — returns the PRECISE machine reason, or null
 * when the campaign is launchable. Mirrors the submit gates (CF-S1 dates, CF-Q2 floor, CF-U3
 * budget minimum, E5 ceiling) so the cart can never hold a promise the submit would refuse.
 */
/** The screencaster's start-date rule (DEMO-1: a demo account may start today, sells no event). */
interface CartRule {
  lead: number;
  demo: boolean;
}

const cartRuleFor = async (userId: string): Promise<CartRule> => ({
  lead: (await getDispatchConfig()).campaignLeadWorkingDays,
  demo: await isDemoUser(db, userId),
});

/** QR-CTA1 — the campaign's call-to-action verdict for the cart (lib/spot-cta.ts). */
const ctaCartBlockFor = async (campaignId: string): Promise<string | null> => {
  const [row] = await db
    .select({
      ctaUrl: campaigns.ctaUrl,
      ctaStatus: campaigns.ctaStatus,
      ctaSourceCreativeId: campaigns.ctaSourceCreativeId,
      creativeId: campaigns.creativeId,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return row ? ctaCartBlock(row) : null;
};

const cartGateReason = async (row: GateRow, rule: CartRule): Promise<string | null> => {
  const c = row.campaign;
  // EV3 — a POSITIONING is an event-BOUND row (event_id set): the binding, not the type string,
  // is the discriminator (a legacy 'event'-typed row without a binding stays fully classic).
  const isEvent = c.eventId !== null;
  if (c.status !== 'draft') return 'NOT_DRAFT';
  if (!c.startDate || !c.endDate) return 'MISSING_DATES';
  // EV3 — an event positioning's dates are the SNAPSHOTTED diffusion window (the kickoff is the
  // truth, not the advertiser's choice): the J+2 working-day floor does not apply. The too-late
  // guard is the lifecycle's (past-kickoff drafts are auto-deleted).
  // DEMO-1 — a demo account shows the classic network only: no event positioning.
  if (isEvent && rule.demo) return 'DEMO_EVENTS_UNAVAILABLE';
  if (!isEvent && startDateViolation(c.startDate, new Date(), rule.lead, rule.demo))
    return 'INVALID_START_DATE';
  if (
    c.creativeId === null ||
    row.creativeDurationSeconds === null ||
    row.creativeDurationSeconds <= 0
  ) {
    return 'MISSING_CREATIVE';
  }
  // QR-CTA1 — a call to action whose QR copy could not be made would never air: refused until the
  // screencaster re-saves the link or changes the spot (a copy still being made is fine — the
  // playout gate holds the campaign until it is ready).
  const ctaBlock = await ctaCartBlockFor(c.id);
  if (ctaBlock) return ctaBlock;
  if (c.requestedBudget === null || Number(c.requestedBudget) <= 0) return 'MISSING_BUDGET';
  // EVT-MIN1 — a positioning is sized in minutes (minimum 1, ruling 4A): no 100 TND floor.
  if (isEvent && c.eventMinutes === null) return 'MISSING_BUDGET';
  if (!isEvent && isBelowCampaignMinimum(Number(c.requestedBudget))) {
    return 'BUDGET_BELOW_MINIMUM';
  }
  if (isEvent && c.eventId !== null) {
    // EV3 — the event ceiling (EV2 pricing, CPM_evt): the classic C_max never prices a
    // positioning (the engine boundary — computeCampaignCmax REFUSES bound rows outright).
    // CPM-1 — priced at the positioning's OWN event CPM (CPM-3: its screencaster's, realigned
    // while it is a draft not yet frozen).
    // EVT-MIN1 — its minutes must still be free (lib/event-minutes-gate — the PATCH's own check).
    const verdict = await checkEventMinutes(
      c.eventId,
      c.eventMinutes ?? 0,
      campaignCpmRates(c).eventCpmTnd,
      await positioningPlaysPerMinute(c.creativeId),
    );
    if (!verdict.ok && verdict.reason === 'SPOT_REQUIRED') return 'MISSING_CREATIVE';
    if (!verdict.ok)
      return verdict.reason === 'EVENT_ANNULE' ? 'EVENT_ANNULE' : 'BUDGET_EXCEEDS_CMAX';
    return null;
  }
  const cmax = await computeCampaignCmax(
    {
      id: c.id,
      startDate: c.startDate,
      endDate: c.endDate,
      campaignType: c.campaignType,
      eventId: c.eventId,
      standardCpmTnd: c.standardCpmTnd,
      eventCpmTnd: c.eventCpmTnd,
      t10s: c.t10s,
      t20s: c.t20s,
      t30s: c.t30s,
    },
    row.creativeDurationSeconds,
  );
  if (Number(c.requestedBudget) > cmax.cMaxTnd) return 'BUDGET_EXCEEDS_CMAX';
  return null;
};

const loadGateRow = async (campaignId: string, userId: string): Promise<GateRow | null> => {
  const [row] = await db
    .select({
      campaign: {
        ...campaignSelection,
        advertiserId: campaigns.advertiserId,
        t10s: campaigns.t10s,
        t20s: campaigns.t20s,
        t30s: campaigns.t30s,
      },
      creativeDurationSeconds: creatives.durationSeconds,
      contentValidationStatus: creatives.validationStatus,
    })
    .from(campaigns)
    .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.advertiserId, userId)))
    .limit(1);
  return row ?? null;
};

/** DEMO-1 — approve the spots of a demo account's carted campaigns (no admin review, Q3 A). */
const approveDemoSpots = async (campaignIds: string[], userId: string): Promise<void> => {
  if (campaignIds.length === 0) return;
  const linked = await db
    .select({ creativeId: campaigns.creativeId })
    .from(campaigns)
    .where(and(inArray(campaigns.id, campaignIds), eq(campaigns.advertiserId, userId)));
  const ids = linked.flatMap((l) => (l.creativeId === null ? [] : [l.creativeId]));
  if (ids.length === 0) return;
  await db
    .update(creatives)
    .set({
      validationStatus: 'approved',
      validatedAt: new Date(),
      validationNotes: 'Démo — validé automatiquement',
    })
    .where(and(inArray(creatives.id, ids), eq(creatives.validationStatus, 'pending')));
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
        message: 'Validation échouée',
        fields: [{ field: 'campaign_id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);

    const row = await loadGateRow(parsed.data.campaign_id, userId);
    if (!row)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });

    const reason = await cartGateReason(row, await cartRuleFor(userId));
    if (reason !== null) {
      return reply.status(400).send({
        error: reason,
        message: "La campagne n'est pas prête pour le panier.",
      });
    }

    // Idempotent add: the UNIQUE(campaign_id) makes the second insert a no-op. TW-SNAP (Z-A) — a
    // NEW add freezes the campaign's typical week in the same transaction (a re-add of a campaign
    // still in the cart keeps its freeze; one removed and added again re-freezes, Q1 B). Events
    // price on A_max, not on the typical week: out of scope.
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(cartItems)
        .values({ userId, campaignId: row.campaign.id })
        .onConflictDoNothing()
        .returning({ campaignId: cartItems.campaignId });
      if (inserted.length > 0 && row.campaign.eventId === null) {
        await freezeTypicalWeek(tx, row.campaign.id);
      }
    });
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
        message: 'Validation échouée',
        fields: [{ field: 'campaign_id', reason: 'must be a uuid' }],
      });
    }
    const userId = request.user?.id;
    if (!userId) return sendUnauthenticated(reply);
    // TW-SNAP — back to a plain draft: its freeze goes too (the next add takes a new one, Q1 B).
    const removed = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(cartItems)
        .where(and(eq(cartItems.campaignId, parsed.data.campaign_id), eq(cartItems.userId, userId)))
        .returning({ campaignId: cartItems.campaignId });
      if (row) await dropTypicalWeekFreeze(tx, row.campaignId);
      return row;
    });
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
        event: events,
      })
      .from(cartItems)
      .innerJoin(campaigns, eq(cartItems.campaignId, campaigns.id))
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .leftJoin(events, eq(campaigns.eventId, events.id))
      .where(eq(cartItems.userId, userId))
      .orderBy(cartItems.addedAt);
    const now = new Date();
    const items = rows.map((r) => ({
      ...campaignView(r.campaign as CampaignRow, r.contentValidationStatus),
      added_at: r.addedAt,
      // EV3 — the panier's ÉVÉNEMENTS section needs the match + its derived window; null for
      // classic campaigns (the web splits the two sections on this).
      event: r.event === null ? null : eventView(r.event, now),
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

    const rule = await cartRuleFor(userId);
    const failures: { campaign_id: string; reason: string }[] = [];
    let requiredHt = 0;
    for (const { campaignId } of carted) {
      const row = await loadGateRow(campaignId, userId);
      if (!row) {
        failures.push({ campaign_id: campaignId, reason: 'NOT_FOUND' });
        continue;
      }
      const reason = await cartGateReason(row, rule);
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
    // FIX2 (Option A ruling) — the gate reads SPENDABLE (balance − engaged unsettled budgets):
    // a second confirm can no longer commit funds the first one already spoke for. `balance`
    // stays on the wire (the total) with `spendable` alongside — disponible vs demandé.
    const wallet = await walletSpendable(userId);
    if (wallet.spendable_tnd < requiredHt) {
      return reply.status(400).send({
        error: 'CART_CONFIRM_FAILED',
        message: 'Insufficient spendable balance to launch the cart.',
        items: [],
        solde: {
          balance: wallet.balance_tnd,
          spendable: wallet.spendable_tnd,
          required: requiredHt,
        },
      });
    }

    // CF-SK1 (ruling #9) — the SKIP fork: an item whose spot is ALREADY APPROVED needs no
    // admin review, so it launches at confirm (draft → upcoming/active, date-routed, via the
    // SAME activation core the admin route runs, activated_by NULL = system). Items whose spot
    // is pending/rejected take the normal draft → pending path and wait for the admin.
    //
    // TWO PHASES (the CF-SK1 amendment, ratified): PREPARE freezes (or RESUMES) every skip
    // item's plan first — no flips; then ONE transaction flips everything (skip items →
    // upcoming/active AND review items → pending) and clears the cart. A dispatch failure on
    // ANY skip item therefore fails the WHOLE confirm with NO visible state change (the CF-C1
    // atomic ruling): the cart stays intact and nothing flips anywhere. The only residue of a
    // partial failure is an EARLIER item's frozen plan (irrevocable by design, invisible to the
    // advertiser) — and the retry RESUMES it: runDispatch short-circuits to ALREADY_DISPATCHED
    // (no re-pool, no duplicate owner notifications — those were inserted inside the one-shot
    // freeze tx) and the gate re-prices fairly because computeCampaignCmax excludes the
    // campaign's OWN allocations from the engagement netting.
    // DEMO-1 (ruled Q3 A) — a demo account skips the admin review: its spots are approved here,
    // so every item takes the SKIP path below and launches at confirm.
    if (rule.demo)
      await approveDemoSpots(
        carted.map((c) => c.campaignId),
        userId,
      );

    const skipItems: {
      campaignId: string;
      row: NonNullable<Awaited<ReturnType<typeof loadGateRow>>>;
    }[] = [];
    const reviewIds: string[] = [];
    for (const { campaignId } of carted) {
      const row = await loadGateRow(campaignId, userId);
      if (!row) continue; // revalidation above already proved every item loads
      if (row.contentValidationStatus === 'approved') skipItems.push({ campaignId, row });
      else reviewIds.push(campaignId);
    }

    // PHASE 1 — prepare (gate → dispatch/resume → plan loaded). No status flips yet.
    const preparedSkips: { full: Campaign }[] = [];
    for (const { campaignId, row } of skipItems) {
      const [full] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
      if (!full) {
        return reply.status(400).send({
          error: 'CART_CONFIRM_FAILED',
          message: 'One or more cart items are no longer launchable.',
          items: [{ campaign_id: campaignId, reason: 'NOT_FOUND' }],
        });
      }
      const prepared = await prepareActivation({
        campaign: full,
        contentValidationStatus: row.contentValidationStatus,
        creativeDurationSeconds: row.creativeDurationSeconds,
        fromStatus: 'draft',
      });
      if (prepared.status !== 'READY') {
        // EV4 — the event dispatch's refusals ride the same per-item vocabulary; so does CPM-3's
        // retryable CPM_CHANGED (a CPM change raced this freeze — nothing frozen, re-confirm).
        const reason =
          prepared.status === 'NOT_DELIVERABLE'
            ? prepared.reason === 'too_thin'
              ? 'TOO_THIN'
              : prepared.reason === 'saturated'
                ? 'INVENTORY_SATURATED'
                : 'NO_ELIGIBLE'
            : prepared.status === 'NOT_ACTIVATABLE'
              ? prepared.reason.toUpperCase()
              : prepared.status;
        return reply.status(400).send({
          error: 'CART_CONFIRM_FAILED',
          message: 'One or more cart items could not be launched.',
          items: [{ campaign_id: campaignId, reason }],
        });
      }
      preparedSkips.push({ full });
    }

    // DEMO-1 (ruled Q3 A) — the on-air instant: confirm + the admin's delay.
    const confirmedAt = new Date();
    const delay = rule.demo ? await demoDelayMinutes() : 0;

    // PHASE 2 — ONE transaction: every flip (skip AND review) + the cart clear, all-or-nothing.
    const result = await db
      .transaction(async (tx) => {
        const launched: CampaignRow[] = [];
        for (const { full } of preparedSkips) {
          const flipped = await finalizeActivation(tx, full, {
            activatedBy: null, // system activation — the spot was already cleared by the admin
            fromStatus: 'draft',
          });
          if ('currentStatus' in flipped) throw new Error('CART_CONFIRM_RACE');
          if (rule.demo && full.startDate !== null) {
            await tx
              .update(campaigns)
              .set({ airsAt: demoAirsAt(confirmedAt, delay, full.startDate) })
              .where(eq(campaigns.id, full.id));
          }
          launched.push(flipped.activated as CampaignRow);
        }
        let updated: CampaignRow[] = [];
        if (reviewIds.length > 0) {
          updated = (await tx
            .update(campaigns)
            .set({
              status: 'pending',
              submittedAt: new Date(),
              rejectedAt: null,
              rejectReason: null,
            })
            .where(
              and(
                inArray(campaigns.id, reviewIds),
                eq(campaigns.advertiserId, userId),
                eq(campaigns.status, 'draft'),
              ),
            )
            .returning(campaignSelection)) as CampaignRow[];
          if (updated.length !== reviewIds.length) {
            // A mid-flight race (an item flipped between revalidation and here): all-or-nothing.
            throw new Error('CART_CONFIRM_RACE');
          }
        }
        await tx.delete(cartItems).where(eq(cartItems.userId, userId));
        return { launched, updated };
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === 'CART_CONFIRM_RACE') return null;
        throw err;
      });
    if (result === null) {
      return reply.status(400).send({
        error: 'CART_CONFIRM_FAILED',
        message: 'One or more cart items changed during the confirm. Nothing was launched.',
        items: [],
      });
    }
    // ADM-BELL1 — ONE aggregated notice for the batch that landed in the validation queue.
    if (result.updated.length > 0) {
      const n = result.updated.length;
      await notifyAdmins(db, {
        type: 'admin_campaign_pending',
        title: n === 1 ? 'Nouvelle campagne à valider' : `${n} campagnes à valider`,
        body:
          n === 1
            ? `La campagne « ${result.updated[0]?.name ?? ''} » de ${await accountLabel(userId)} attend votre validation.`
            : `${n} campagnes de ${await accountLabel(userId)} attendent votre validation.`,
        campaignId: n === 1 ? (result.updated[0]?.id ?? null) : null,
      }).catch((err: unknown) => request.log.warn({ err }, 'admin notice failed (cart)'));
    }
    if (result.launched.some((row) => row.campaignType === 'event')) {
      // EVT-STOP — an event positioning launched at confirm (sold): the network's blackout set may have changed, so every
      // connected venue re-pushes (classic entries carry the windows). Failure never blocks.
      await pushPlaylistToAllConnected(request.log).catch((err: unknown) =>
        request.log.warn({ err }, 'network playlist re-push failed'),
      );
    }
    // The response splits the two outcomes so the FE can word the mixed toast (CF-SK1).
    return reply.status(200).send({
      confirmed: [...result.launched, ...result.updated].map((row) => campaignView(row)),
      launched: result.launched.map((row) => campaignView(row)),
      pending_review: result.updated.map((row) => campaignView(row)),
    });
  });
};
