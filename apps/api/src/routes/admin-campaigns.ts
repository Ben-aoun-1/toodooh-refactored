import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  type Campaign,
  campaignReconciliation,
  campaigns,
  creatives,
  eventAllocations,
  screenhosts,
  users,
} from '../db/schema.js';
import { activateCampaign } from '../lib/activation-service.js';
import { campaignEligibleHosts } from '../lib/campaign-eligible-hosts.js';
import { campaignCpmRates, cpmForCampaign } from '../lib/dispatch/config.js';
import { measureEventDelivery } from '../lib/event-playout/settlement.js';
import { pushPlaylistToCampaignVenues } from '../lib/playout/push.js';
import { walletSpendable } from '../lib/recharges.js';
import { userLabel } from '../lib/user-label.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

import { planView } from './campaign-dispatch.js';

// Admin campaign moderation (ACTIVATION WIRING — the keystone). The submit flow leaves a campaign
// status='pending'; nothing yet flips it to 'active', and L-playout GATES playout on status='active'.
// This wires the admin approval that, given an approved creative + a funded advertiser, ACTIVATES the
// campaign AND dispatches it (reusing runDispatch — the engine is never duplicated), so the whole
// chain (dispatch → playout → proof-of-play) finally runs end-to-end. Mirrors the admin recharge /
// creative review: every route is [requireAuth, requireAdmin]; a non-admin 403s, a missing campaign
// 404s; transitions are pending→x only and the UPDATE's WHERE status='pending' makes them atomic.
//
// V1 manual money model: activation gates on walletBalance >= budget but does NOT debit — the debit
// is L-redisp's at reconciliation (it bills actual aired impressions). The seam stays open here.
//
// DERIVED ACTIVATION: the engine inputs are NO LONGER admin-supplied. Approve = activate derives them
// from the campaign + config so the operator only ever clicks Approve:
//   cpm     = the campaign's OWN CPM by type (event_cpm_tnd for an 'event' campaign, else
//             standard_cpm_tnd) — CPM-1/CPM-3: its own copy (its screencaster's), not the config
//   i_cible = ⌊requested_budget·1000 / cpm⌋        (the advertiser's indicative ask → target impressions)
//   s       = the linked creative's duration_seconds (the spot length actually airing)
//   t       = derived INSIDE runDispatch (E1: tForDuration(s, tiers) — the VF attention index;
//             CPM-2: the campaign's OWN tiers, in effect when it was CREATED, not today's)
// budget (the funding gate) = requested_budget, the advertiser's stated ask.

const idParamSchema = z.object({ id: z.uuid() });
// EV5 RIDER (chartered at EV4 ratification) — the queue filter reached only four statuses, so a
// DISPATCHED positioning (À venir until its window day, then Terminée once settled) was
// unreachable in the examen. Both stored statuses join the allowlist; the web adds their options.
const listQuerySchema = z.object({
  status: z.enum(['draft', 'pending', 'upcoming', 'active', 'completed', 'rejected']).optional(),
});
const rejectBodySchema = z.object({ reason: z.string().trim().min(1).max(2000) });

// cpmForCampaign moved to lib/dispatch/config.ts (E5) — the C_max ceiling must price identically.

// Derived I_cible from the indicative budget at the given CPM, or null when un-derivable (no budget /
// non-positive budget). ⌊budget·1000 / cpm⌋; a sub-CPM budget floors to 0 → null (not deliverable).
const deriveICible = (requestedBudget: number | null, cpm: number): number | null => {
  if (requestedBudget === null || requestedBudget <= 0 || cpm <= 0) return null;
  const iCible = Math.floor((requestedBudget * 1000) / cpm);
  return iCible >= 1 ? iCible : null;
};

const invalidField = (reply: FastifyReply, field: string, reason: string) =>
  reply
    .status(400)
    .send({ error: 'INVALID_INPUT', message: 'Validation échouée', fields: [{ field, reason }] });

// 409 for a campaign that is not pending (can't activate/reject a draft/active/rejected one). Carries
// the current status so the admin UI shows "already active/rejected" instead of a blind retry.
const sendNotPending = (
  reply: FastifyReply,
  request: FastifyRequest,
  status: string,
  verb: string,
) =>
  reply.status(409).send({
    error: 'CONFLICT',
    // CF-HF3 — French; `verb` is now the French participle ('activée' / 'rejetée').
    message: `Seule une campagne en attente peut être ${verb} (statut actuel : ${status}).`,
    statusCode: 409,
    requestId: request.id,
    currentStatus: status,
  });

// ADM-FIX1 — every payload that carries `advertiser_id` now carries the NAME beside it
// (lib/user-label: business_name, else contact_name). The admin queue printed a truncated uuid
// where the operator expects an annonceur; the id stays for support, as a secondary line.
const adminCampaignView = (
  row: Campaign,
  contentValidationStatus: string | null,
  advertiserLabel: string,
) => ({
  id: row.id,
  advertiser_id: row.advertiserId,
  advertiser_label: advertiserLabel,
  name: row.name,
  campaign_type: row.campaignType,
  status: row.status,
  start_date: row.startDate,
  end_date: row.endDate,
  description: row.description,
  requested_budget: row.requestedBudget === null ? null : Number(row.requestedBudget),
  creative_id: row.creativeId,
  // EV4 — the examen forks its detail panel on the BINDING (allocations table for positionings).
  event_id: row.eventId,
  content_validation_status: contentValidationStatus,
  submitted_at: row.submittedAt,
  activated_at: row.activatedAt,
  activated_by: row.activatedBy,
  rejected_at: row.rejectedAt,
  reject_reason: row.rejectReason,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

// loadPlan moved into the activation core (lib/activation-service) with the rest of the chain.

export const adminCampaignsRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  // GET /api/admin/campaigns[?status=] — the review queue (newest first): each campaign + its derived
  // content_validation_status (the linked creative's approval) + the advertiser's wallet balance +
  // the DERIVED pricing the operator approves (cpm_tnd by type, derived_i_cible = ⌊budget·1000/cpm⌋).
  // derived_i_cible is null when the campaign has no usable budget — the queue shows it can't activate.
  app.get('/api/admin/campaigns', adminGuard, async (request, reply) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return invalidField(
        reply,
        'status',
        'must be draft, pending, upcoming, active, completed or rejected',
      );
    }
    const { status } = parsedQuery.data;
    // The users join is INNER on purpose and cannot drop a row: campaigns.advertiser_id is NOT NULL
    // and references users.id, so every campaign has exactly one advertiser.
    const rows = await db
      .select({
        campaign: campaigns,
        contentValidationStatus: creatives.validationStatus,
        advertiserBusinessName: users.businessName,
        advertiserContactName: users.contactName,
        advertiserEmail: users.email,
      })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .innerJoin(users, eq(campaigns.advertiserId, users.id))
      .where(status ? eq(campaigns.status, status) : undefined)
      .orderBy(desc(campaigns.createdAt));
    const out = await Promise.all(
      rows.map(async (r) => {
        // CPM-1 — the campaign's OWN CPM (CPM-3: its screencaster's, the copy it carries), the
        // one its activation will derive I_cible at — never the global default.
        const cpm = cpmForCampaign(r.campaign.campaignType, campaignCpmRates(r.campaign));
        const requestedBudget =
          r.campaign.requestedBudget === null ? null : Number(r.campaign.requestedBudget);
        return {
          ...adminCampaignView(
            r.campaign,
            r.contentValidationStatus,
            userLabel({
              id: r.campaign.advertiserId,
              businessName: r.advertiserBusinessName,
              contactName: r.advertiserContactName,
              email: r.advertiserEmail,
            }),
          ),
          // FIX2 amendment — the queue shows THE FIGURE THE ACTIVATION GATE ENFORCES: spendable
          // excluding this campaign's own engagement. Total balance invited approving campaigns
          // the gate then rejects.
          wallet_balance_tnd: (
            await walletSpendable(r.campaign.advertiserId, { excludeCampaignId: r.campaign.id })
          ).spendable_tnd,
          cpm_tnd: cpm,
          derived_i_cible: deriveICible(requestedBudget, cpm),
        };
      }),
    );
    return reply.status(200).send(out);
  });

  // POST /api/admin/campaigns/:id/activate (NO body) — the keystone. Gate (pending + approved
  // creative) → DERIVE the engine inputs (cpm/i_cible/s/t) from the campaign + config → gate funded →
  // dispatch; activate only on a deliverable plan.
  app.post('/api/admin/campaigns/:id/activate', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const adminId = request.user?.id;
    if (!adminId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const { id } = parsedParams.data;

    const [row] = await db
      .select({
        campaign: campaigns,
        contentValidationStatus: creatives.validationStatus,
        creativeDurationSeconds: creatives.durationSeconds,
        // ADM-FIX1 — the advertiser's name rides the read the route already does (no extra query).
        advertiserBusinessName: users.businessName,
        advertiserContactName: users.contactName,
        advertiserEmail: users.email,
      })
      .from(campaigns)
      .leftJoin(creatives, eq(campaigns.creativeId, creatives.id))
      .innerJoin(users, eq(campaigns.advertiserId, users.id))
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!row)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    const { campaign, contentValidationStatus, creativeDurationSeconds } = row;
    const advertiserLabel = userLabel({
      id: campaign.advertiserId,
      businessName: row.advertiserBusinessName,
      contactName: row.advertiserContactName,
      email: row.advertiserEmail,
    });

    // CF-SK1 — the gate chain, dispatch and the date-routed flip now live in the shared
    // activation core (lib/activation-service); this route keeps its HTTP shell and maps the
    // outcomes back to the exact bodies it always returned (behavior byte-unchanged).
    const outcome = await activateCampaign({
      campaign,
      contentValidationStatus,
      creativeDurationSeconds,
      activatedBy: adminId,
      fromStatus: 'pending',
    });

    // CF-HF3 (Mejri item 6) — the messages below reach the operator's toast VERBATIM
    // (CampaignReviewQueue renders getErrorMessage): French, precise. The `reason` codes are the
    // wire contract and stay untouched. Item 4's fix rides here too: the old content_not_approved
    // sentence "(or no creative is linked)" conflated TWO states — a campaign with NO creative
    // and one whose creative awaits moderation now get DISTINCT French messages (the gate itself
    // was always type-agnostic — an approved IMAGE activates like a video, pinned in tests).
    if (outcome.status === 'WRONG_STATUS') {
      return sendNotPending(reply, request, outcome.currentStatus, 'activée');
    }
    if (outcome.status === 'NOT_ACTIVATABLE') {
      if (outcome.reason === 'content_not_approved') {
        return reply.status(422).send({
          error: 'NOT_ACTIVATABLE',
          reason: 'content_not_approved',
          message:
            outcome.contentValidationStatus === null
              ? "Aucun spot n'est associé à cette campagne."
              : "Le spot lié n'est pas encore approuvé par la modération.",
          content_validation_status: outcome.contentValidationStatus,
        });
      }
      if (outcome.reason === 'no_budget') {
        return reply.status(422).send({
          error: 'NOT_ACTIVATABLE',
          reason: 'no_budget',
          message: "La campagne n'a pas de budget indicatif pour dériver un objectif.",
          requested_budget: outcome.requestedBudget,
        });
      }
      if (outcome.reason === 'no_duration') {
        return reply.status(422).send({
          error: 'NOT_ACTIVATABLE',
          reason: 'no_duration',
          message: "Le spot lié n'a pas de durée de diffusion (longueur du spot).",
          duration_seconds: outcome.durationSeconds,
        });
      }
      if (outcome.reason === 'budget_too_low') {
        return reply.status(422).send({
          error: 'NOT_ACTIVATABLE',
          reason: 'budget_too_low',
          message:
            'Le budget indicatif est inférieur à une unité CPM — aucune impression ciblable.',
          requested_budget: outcome.requestedBudget,
          cpm_tnd: outcome.cpmTnd,
        });
      }
      return reply.status(422).send({
        error: 'NOT_ACTIVATABLE',
        reason: 'insufficient_balance',
        message: "Le solde de l'annonceur est inférieur au budget de la campagne.",
        required_tnd: outcome.requiredTnd,
        available_tnd: outcome.availableTnd,
      });
    }
    if (outcome.status === 'NO_WINDOW') {
      // The useful text used to hide in fields[] behind a bare 'Validation failed' — surface it.
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'La campagne doit avoir une date de début et une date de fin.',
        fields: [{ field: 'window', reason: 'campaign requires a start_date and end_date' }],
      });
    }
    // EV4 — the event dispatch's refusals: D7 blocks the validation ATOMICALLY (nothing was
    // persisted, nothing flips); an event annulled since the panier refuses too.
    if (outcome.status === 'EVENT_NMAX_EXCEEDED') {
      return reply.status(409).send({
        error: 'EVENT_NMAX_EXCEEDED',
        message: `Le budget dépasse la limite de concentration (N_max = ${outcome.nMax} établissement${outcome.nMax > 1 ? 's' : ''}). Réduisez le budget du positionnement.`,
        n_max: outcome.nMax,
        statusCode: 409,
      });
    }
    if (outcome.status === 'EVENT_ANNULE') {
      return reply.status(409).send({
        error: 'EVENT_ANNULE',
        message: 'Cet événement est annulé — le positionnement ne peut pas être validé.',
        statusCode: 409,
      });
    }
    // CPM-3 — a CPM change raced the freeze (lib/cpm-freeze-guard.ts): nothing frozen, retryable.
    if (outcome.status === 'CPM_CHANGED') {
      return reply.status(409).send({
        error: 'CPM_CHANGED',
        message: 'Le CPM de cette campagne vient de changer — relancez l’activation.',
        statusCode: 409,
      });
    }
    if (outcome.status === 'NOT_DELIVERABLE') {
      if (outcome.reason === 'too_thin') {
        return reply.status(422).send({
          error: 'NOT_DELIVERABLE',
          reason: 'too_thin',
          message:
            "Couvrir l'objectif dépasserait la matérialité (N_min > N_max). Réduisez le budget ou élargissez le ciblage, puis réessayez.",
          n_min: outcome.nMin,
          n_max: outcome.nMax,
        });
      }
      // CF-HF4 — saturated inventory speaks differently from an empty targeting match.
      return reply.status(422).send({
        error: 'NOT_DELIVERABLE',
        reason: outcome.reason,
        message:
          outcome.reason === 'saturated'
            ? 'Inventaire momentanément saturé sur ce ciblage — réessayez avec une autre période.'
            : 'Aucun établissement éligible n’a pu être alloué. Ajustez le ciblage ou la période, puis réessayez.',
      });
    }
    if (outcome.status === 'PLAN_MISSING') {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Plan de diffusion introuvable.' });
    }

    const activated = outcome.campaign;
    // CF-HF4 — re-push the plan's venues (their playlists include the campaign the moment its
    // allocations flip ACCEPTE; today's fresh allocations are EN_ATTENTE so this is usually a
    // no-op recompute — kept for the reactivation/carry-over paths). Failure never blocks.
    try {
      await pushPlaylistToCampaignVenues(activated.id, request.log);
    } catch (err) {
      request.log.warn({ err, campaignId: activated.id }, 'playlist re-push on activate failed');
    }
    return reply.status(200).send({
      campaign: adminCampaignView(activated, contentValidationStatus, advertiserLabel),
      // EV3 — an event positioning activates with NO plan (the phasing boundary: bloc dispatch
      // is EV4); classic campaigns keep the byte-identical planView spread.
      ...(outcome.plan === null
        ? { plan: null, allocations: [] }
        : planView(outcome.plan, outcome.allocations)),
    });
  });

  // GET /api/admin/campaigns/:id/eligible-hosts — ELIG-1 (Meriam 15/09, blocking for testing):
  // the venues this campaign can reach AT ANY STATUS and why the others are out, from the REAL
  // pool assembly (standard) or the REAL event ceiling (positioning). Read-only.
  app.get('/api/admin/campaigns/:id/eligible-hosts', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const result = await campaignEligibleHosts(parsedParams.data.id);
    if (result.status === 'NOT_FOUND') {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    }
    if (result.status === 'NO_DATES') {
      return reply.status(409).send({
        error: 'NO_DATES',
        message:
          "La campagne n'a pas encore de période : les établissements éligibles dépendent des dates.",
        statusCode: 409,
      });
    }
    return reply.status(200).send(result.report);
  });

  // GET /api/admin/campaigns/:id/event-allocations — EV4: the examen's allocation table for an
  // event positioning (venues, blocs, montants, statuts). Empty for classic/undispatched rows.
  app.get('/api/admin/campaigns/:id/event-allocations', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const rows = await db
      .select({
        id: eventAllocations.id,
        screenhostId: eventAllocations.screenhostId,
        screenhostName: screenhosts.name,
        blocs: eventAllocations.blocs,
        impressionsTotal: eventAllocations.impressionsTotal,
        montantTnd: eventAllocations.montantTnd,
        statut: eventAllocations.statut,
        decidedAt: eventAllocations.decidedAt,
      })
      .from(eventAllocations)
      .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
      .where(eq(eventAllocations.campaignId, parsedParams.data.id))
      .orderBy(desc(eventAllocations.createdAt));

    // EV5 — the settlement summary rides the same read (derived per venue, nothing stored).
    const [positioning] = await db
      .select({ id: campaigns.id, eventId: campaigns.eventId })
      .from(campaigns)
      .where(eq(campaigns.id, parsedParams.data.id))
      .limit(1);
    const [settled] = await db
      .select({
        refundTnd: campaignReconciliation.refundTnd,
        spendTnd: campaignReconciliation.spendTnd,
        settledAt: campaignReconciliation.reconciledAt,
      })
      .from(campaignReconciliation)
      .where(eq(campaignReconciliation.campaignId, parsedParams.data.id))
      .limit(1);
    const measured =
      settled && positioning?.eventId
        ? await measureEventDelivery(positioning.id, positioning.eventId)
        : null;

    return reply.status(200).send({
      allocations: rows.map((r) => {
        const line = measured?.venues.find((v) => v.screenhostId === r.screenhostId) ?? null;
        return {
          id: r.id,
          screenhost_name: r.screenhostName,
          blocs_count: Array.isArray(r.blocs) ? r.blocs.length : 0,
          impressions_total: r.impressionsTotal,
          montant_tnd: Number(r.montantTnd),
          statut: r.statut,
          decided_at: r.decidedAt,
          blocs_delivered: line?.blocsDelivered ?? null,
          delivered_tnd: line?.deliveredTnd ?? null,
          refund_tnd: line?.refundTnd ?? null,
          attestation_negated: line?.attestationNegated ?? null,
        };
      }),
      settlement:
        settled === undefined
          ? null
          : {
              settled_at: settled.settledAt,
              delivered_tnd: Number(settled.spendTnd),
              refund_tnd: Number(settled.refundTnd),
            },
    });
  });

  // POST /api/admin/campaigns/:id/reject { reason } — pending → rejected; a reason is REQUIRED and is
  // surfaced to the advertiser (reject_reason). Does NOT dispatch.
  app.post('/api/admin/campaigns/:id/reject', adminGuard, async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) return invalidField(reply, 'id', 'must be a uuid');
    const parsedBody = rejectBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation échouée',
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
        .send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const { id } = parsedParams.data;
    const [existing] = await db
      .select({
        status: campaigns.status,
        advertiserId: campaigns.advertiserId,
        // ADM-FIX1 — rides the pre-check read the route already does (no extra query).
        advertiserBusinessName: users.businessName,
        advertiserContactName: users.contactName,
        advertiserEmail: users.email,
      })
      .from(campaigns)
      .innerJoin(users, eq(campaigns.advertiserId, users.id))
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!existing)
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Campagne introuvable.' });
    if (existing.status !== 'pending')
      return sendNotPending(reply, request, existing.status, 'rejetée');
    const advertiserLabel = userLabel({
      id: existing.advertiserId,
      businessName: existing.advertiserBusinessName,
      contactName: existing.advertiserContactName,
      email: existing.advertiserEmail,
    });

    const [updated] = await db
      .update(campaigns)
      .set({ status: 'rejected', rejectedAt: new Date(), rejectReason: parsedBody.data.reason })
      .where(and(eq(campaigns.id, id), eq(campaigns.status, 'pending')))
      .returning();
    if (!updated) {
      const [current] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);
      return sendNotPending(reply, request, current?.status ?? existing.status, 'rejetée');
    }
    return reply.status(200).send(adminCampaignView(updated, null, advertiserLabel));
  });
};
