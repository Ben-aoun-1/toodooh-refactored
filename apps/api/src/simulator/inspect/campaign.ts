import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignReconciliation,
  campaignRedispatchRounds,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  eventAllocations,
  events,
  reversementLines,
  screenhosts,
} from '../../db/schema.js';
import { computeCampaignCmax } from '../../lib/campaign-cmax.js';
import { getDispatchConfig } from '../../lib/dispatch/config.js';
import { readEngineJournal } from '../../lib/engine-journal/read.js';
import { measureEventDelivery } from '../../lib/event-playout/settlement.js';
import { parseBlocs } from '../../lib/event-playout/spots.js';
import { computeEventCmax } from '../../lib/event-pricing/pricing.js';
import { estimateCampaignImpressions } from '../../lib/impressions-estimate.js';
import { impressionsObjectif } from '../../lib/impressions-objectif.js';
import { loadDeliveredSlots } from '../../lib/reconcile/delivered-slots.js';

// SIM-6 phase 2 — THE CAMPAIGN INSPECTOR: everything the admin needs to check dispatch, redispatch
// and pricing on ONE simulated campaign (standard or event), in one read inside the sandbox.
// Nothing is recomputed here: every figure comes from the product's own function — the ceiling
// (computeCampaignCmax / computeEventCmax), the objective (impressionsObjectif), the estimate
// (estimateCampaignImpressions), the frozen plan and its allocations, the redispatch rounds, the
// engine journal (readEngineJournal), the settlement rows and, for an event, the EV5 delivery
// measure. Read-only.

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

export const inspectCampaign = async (campaignId: string) => {
  const [c] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      campaignType: campaigns.campaignType,
      eventId: campaigns.eventId,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      requestedBudget: campaigns.requestedBudget,
      standardCpmTnd: campaigns.standardCpmTnd,
      eventCpmTnd: campaigns.eventCpmTnd,
      t10s: campaigns.t10s,
      t20s: campaigns.t20s,
      t30s: campaigns.t30s,
      spotSeconds: creatives.durationSeconds,
    })
    .from(campaigns)
    .leftJoin(creatives, eq(creatives.id, campaigns.creativeId))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!c) return null;

  const config = await getDispatchConfig();
  const venueName = new Map(
    (await db.select({ id: screenhosts.id, name: screenhosts.name }).from(screenhosts)).map((v) => [
      v.id,
      v.name,
    ]),
  );
  const spotSeconds = c.spotSeconds ?? null;

  // ── pricing ────────────────────────────────────────────────────────────────
  let cMaxTnd: number | null = null;
  if (c.eventId) {
    const [ev] = await db.select().from(events).where(eq(events.id, c.eventId)).limit(1);
    if (ev) {
      cMaxTnd = (
        await computeEventCmax(
          { id: ev.id, kickoffAt: ev.kickoffAt, endsAt: ev.endsAt },
          Number(c.eventCpmTnd),
        )
      ).cMaxEvtTnd;
    }
  } else if (c.startDate && c.endDate && spotSeconds) {
    cMaxTnd = (
      await computeCampaignCmax(
        {
          id: c.id,
          startDate: c.startDate,
          endDate: c.endDate,
          campaignType: c.campaignType,
          eventId: null,
          standardCpmTnd: c.standardCpmTnd,
          eventCpmTnd: c.eventCpmTnd,
          t10s: c.t10s,
          t20s: c.t20s,
          t30s: c.t30s,
        },
        spotSeconds,
      )
    ).cMaxTnd;
  }
  const estimate = await estimateCampaignImpressions({ ...c, spotSeconds });

  // ── the frozen plan (standard) ─────────────────────────────────────────────
  const [plan] = await db
    .select()
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, c.id))
    .limit(1);
  const delivered = plan ? await loadDeliveredSlots(c.id) : new Map<string, Set<string>>();
  const allocations = plan
    ? (
        await db
          .select()
          .from(campaignDispatchAllocation)
          .where(eq(campaignDispatchAllocation.planId, plan.id))
      ).map((a) => ({
        venue: venueName.get(a.screenhostId) ?? a.screenhostId,
        screenhost_id: a.screenhostId,
        statut: a.statutAcceptation,
        r_i: a.rI,
        share: a.iiPotentiel,
        revenu_tnd: num(a.revenuPrevisionnel),
        creneaux: a.creneaux.length,
        first: a.creneaux[0] ? `${a.creneaux[0].date} ${a.creneaux[0].hour}h` : null,
        last: a.creneaux.at(-1) ? `${a.creneaux.at(-1)?.date} ${a.creneaux.at(-1)?.hour}h` : null,
        delivered_slots: delivered.get(a.screenhostId)?.size ?? 0,
      }))
    : [];

  // ── the event placement (positioning) ──────────────────────────────────────
  const eventRows = c.eventId
    ? await db.select().from(eventAllocations).where(eq(eventAllocations.campaignId, c.id))
    : [];

  // ── redispatch, journal, settlement ────────────────────────────────────────
  const rounds = await db
    .select()
    .from(campaignRedispatchRounds)
    .where(eq(campaignRedispatchRounds.campaignId, c.id))
    .orderBy(asc(campaignRedispatchRounds.roundTs));
  const journal = await readEngineJournal(c.id, { limit: 50, offset: 0 });
  const [recon] = await db
    .select()
    .from(campaignReconciliation)
    .where(eq(campaignReconciliation.campaignId, c.id))
    .limit(1);
  const payouts = await db
    .select()
    .from(campaignScreenhostPayout)
    .where(eq(campaignScreenhostPayout.campaignId, c.id));
  const lines = await db
    .select()
    .from(reversementLines)
    .where(eq(reversementLines.campaignId, c.id));
  const eventDelivery = recon && c.eventId ? await measureEventDelivery(c.id, c.eventId) : null;

  return {
    campaign: {
      id: c.id,
      name: c.name,
      status: c.status,
      kind: c.eventId ? ('event' as const) : ('standard' as const),
      start_date: c.startDate,
      end_date: c.endDate,
      budget_tnd: num(c.requestedBudget),
      spot_seconds: spotSeconds,
    },
    pricing: {
      c_max_tnd: cMaxTnd,
      objectif: impressionsObjectif(c),
      estimate,
      campaign_rates: {
        standard_cpm_tnd: Number(c.standardCpmTnd),
        event_cpm_tnd: Number(c.eventCpmTnd),
        t10s: Number(c.t10s),
        t20s: Number(c.t20s),
        t30s: Number(c.t30s),
      },
      config: {
        f_max_seconds: config.fMaxSeconds,
        r_min_efficace: config.rMinEfficace,
        seuil_diffusable: config.seuilDiffusable,
        g_mois: config.gMois,
        jours_actifs: config.joursActifs,
      },
    },
    plan: plan
      ? {
          i_cible: plan.iCible,
          cpm: Number(plan.cpm),
          s: plan.sSpotSeconds,
          t: Number(plan.tTierCoef),
          f_max_seconds: plan.fMaxSeconds,
          seuil: plan.seuilDiffusable,
          couvert: plan.couvert,
          n_min: plan.nMin,
          n_max: plan.nMax,
          n_retenus: plan.nRetenus,
          reliquat_stocke: plan.reliquatStocke,
          is_partial: plan.isPartial,
          is_too_thin: plan.isTooThin,
          dispatched_at: plan.createdAt,
          allocations,
        }
      : null,
    event_placement: c.eventId
      ? eventRows.map((e) => ({
          venue: venueName.get(e.screenhostId) ?? e.screenhostId,
          screenhost_id: e.screenhostId,
          statut: e.statut,
          blocs: parseBlocs(e.blocs).map((b) => ({ start: b.start, end: b.end })),
          impressions: e.impressionsTotal,
          montant_tnd: Number(e.montantTnd),
        }))
      : null,
    redispatch: rounds.map((r) => ({
      at: r.roundTs,
      missed_fact: r.missedFact,
      placed_fact: r.placedFact,
      reliquat_consumed_fact: r.reliquatConsumedFact,
      residual_fact: r.residualFact,
      missed_from: r.missedFrom,
      placed_to: r.placedTo,
    })),
    journal: journal?.runs ?? [],
    settlement: recon
      ? {
          status: recon.status,
          spend_tnd: Number(recon.spendTnd),
          refund_tnd: Number(recon.refundTnd),
          expected_imp: recon.expectedImp,
          delivered_imp: recon.deliveredImp,
          settled_at: recon.reconciledAt,
          payouts: payouts.map((p) => ({
            venue: venueName.get(p.screenhostId) ?? p.screenhostId,
            expected_imp: p.expectedImp,
            delivered_imp: p.deliveredImp,
            earnings_tnd: Number(p.earningsTnd),
          })),
          reversement: lines.map((l) => ({
            venue: venueName.get(l.screenhostId) ?? l.screenhostId,
            base_tnd: Number(l.baseValueTnd),
            sh_tnd: Number(l.shAmountTnd),
            toodooh_tnd: Number(l.toodoohAmountTnd),
            agent_sh_tnd: Number(l.agentShAmountTnd),
            agent_sc_tnd: Number(l.agentScAmountTnd),
          })),
          event_delivery: eventDelivery
            ? eventDelivery.venues.map((v) => ({
                venue: venueName.get(v.screenhostId) ?? v.screenhostId,
                blocs_delivered: v.blocsDelivered,
                delivered_tnd: v.deliveredTnd,
                refund_tnd: v.refundTnd,
                attestation_negated: v.attestationNegated,
              }))
            : null,
        }
      : null,
  };
};
