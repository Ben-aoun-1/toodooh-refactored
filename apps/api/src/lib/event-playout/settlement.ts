import { and, eq, inArray, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../../db/client.js';
import {
  agentReferrals,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  eventAllocations,
  eventAttestations,
  events,
  notifications,
  proofOfPlay,
  reversementLines,
  screenhosts,
} from '../../db/schema.js';
import { campaignReportReadyNotification } from '../campaign-report-notification.js';
import { getDispatchConfig } from '../dispatch/config.js';
import { fenetreDiffusion } from '../fenetre-diffusion.js';
import { computeReversement, millimesToTnd, tndToMillimes } from '../reversement/split.js';

import { parseBlocs } from './spots.js';

// EV5 — THE EVENT MONITOR + SETTLEMENT. After the diffusion window closes, each positioning is
// measured PER (venue, bloc) on the DUAL PROOF:
//
//   delivered(venue, bloc) ⇔ ≥ 1 VIDEO_ENDED proof for this positioning, from this venue, whose
//                            SERVER received_at falls inside [bloc.start, bloc.end)
//                            AND the venue carries NO respecte=false attestation for the event.
//
// The proof column is `received_at` — the SAME server-truth evidence E6's proofSlotKey uses (never
// the client event_ts); only the bucket differs: a 20-minute bloc instead of a Tunis hour, because
// the bloc IS the event's unit of delivery. An ABSENT attestation is RESPECTED (the ruled default:
// no inspection is never a sanction); a NEGATIVE one negates every bloc of that venue, whatever
// the screen reported — a screen can report VIDEO_ENDED to a wall nobody sees.
//
// MANQUEMENTS ARE LOST — divergent from the campaign engine BY SPEC: there is no rattrapage, no
// redispatch, no reliquat. The undelivered CHARGEABLE value is refunded to the advertiser.
//
// The refund uses E6's EXACT money movement (no new mechanism): the settlement writes ONE
// campaign_reconciliation row with spend_tnd = the DELIVERED chargeable value and refund_tnd = the
// undelivered part. walletBalance debits spend_tnd only, so the undelivered value is never debited
// — that IS the refund landing, and FCT-R1's monthly invoice then bills the NET automatically.
// UNIQUE(campaign_id) makes the settlement idempotent (a second run is a no-op).
//
// EV6 BOUNDARY (pinned): NO venue reversement lines and NO screenhost payouts are written here —
// this lane settles the ADVERTISER side only.

/** The per-venue settlement line, surfaced to the advertiser + admin. */
export interface EventSettlementVenueLine {
  screenhostId: string;
  blocsTotal: number;
  blocsDelivered: number;
  /** The venue's chargeable value (EV4's capped montant). */
  montantTnd: number;
  /** The delivered share of that montant (pro-rata on chargeable impressions). */
  deliveredTnd: number;
  refundTnd: number;
  /** True when a respecte=false attestation negated this venue. */
  attestationNegated: boolean;
  /** The allocation's decision state at window close (REFUSE lines carry no money). */
  statut: string;
  /** The venue's placed impressions, and the delivered share of them (bloc pro-rata). */
  impressionsTotal: number;
  impressionsDelivered: number;
}

export interface EventSettlementResult {
  status: 'SETTLED' | 'ALREADY_SETTLED' | 'WINDOW_OPEN' | 'NOT_POSITIONING' | 'NO_ALLOCATIONS';
  engagedTnd?: number;
  deliveredTnd?: number;
  refundTnd?: number;
  venues?: EventSettlementVenueLine[];
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export const EVENT_SETTLED_TITLE = 'Votre positionnement est terminé';
export const eventSettledBody = (matchName: string, refundTnd: number): string =>
  refundTnd > 0
    ? `Votre positionnement sur ${matchName} est terminé. ${refundTnd.toLocaleString('fr-FR')} TND correspondant aux blocs non diffusés vous ont été remboursés.`
    : `Votre positionnement sur ${matchName} est terminé — la diffusion a été intégralement assurée.`;

export interface EventDelivery {
  venues: EventSettlementVenueLine[];
  engagedTnd: number;
  deliveredTnd: number;
  refundTnd: number;
  expectedImp: number;
  deliveredImp: number;
}

/**
 * THE MEASUREMENT — ONE home. Reads the allocations + proofs + attestations and returns the
 * per-(venue, bloc) verdict with its money. The settlement persists the aggregate; the advertiser
 * and admin read surfaces derive their per-venue « livré / manqué » lines from this SAME function,
 * so no per-venue row has to be stored — which keeps the EV6 boundary intact (this lane writes NO
 * venue money rows at all).
 */
export const measureEventDelivery = async (
  positioningId: string,
  eventId: string,
): Promise<EventDelivery> => {
  const allocations = await db
    .select()
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, positioningId));

  // The proofs: VIDEO_ENDED for THIS positioning (video_id-as-sent = campaign id, so the
  // proof rows carry campaign_id = the positioning — written by ingest's event branch, H1).
  const proofs = await db
    .select({ screenhostId: proofOfPlay.screenhostId, receivedAt: proofOfPlay.receivedAt })
    .from(proofOfPlay)
    .where(
      and(eq(proofOfPlay.campaignId, positioningId), eq(proofOfPlay.eventType, 'VIDEO_ENDED')),
    );
  const proofsByVenue = new Map<string, number[]>();
  for (const p of proofs) {
    const list = proofsByVenue.get(p.screenhostId) ?? [];
    list.push(p.receivedAt.getTime());
    proofsByVenue.set(p.screenhostId, list);
  }

  // The attestations: only a respecte=FALSE row matters (absent = respected, the ruled default).
  const attestations = await db
    .select({ screenhostId: eventAttestations.screenhostId, respecte: eventAttestations.respecte })
    .from(eventAttestations)
    .where(
      and(
        eq(eventAttestations.eventId, eventId),
        inArray(
          eventAttestations.screenhostId,
          allocations.map((a) => a.screenhostId),
        ),
      ),
    );
  const negated = new Set(attestations.filter((a) => !a.respecte).map((a) => a.screenhostId));

  const venues: EventSettlementVenueLine[] = [];
  let engagedTnd = 0;
  let deliveredTnd = 0;
  let expectedImp = 0;
  let deliveredImp = 0;

  for (const allocation of allocations) {
    const blocs = parseBlocs(allocation.blocs);
    const montantTnd = Number(allocation.montantTnd);
    const isNegated = negated.has(allocation.screenhostId);

    // A REFUSE allocation is OUT of the accounting: it was never airable and EV4's cascade
    // already re-placed its share onto another venue (which carries its own montant). Counting
    // it would double-charge the engaged value and then refund it straight back. It stays as a
    // LINE so the advertiser sees what happened, with zero money attached.
    if (allocation.statut === 'REFUSE') {
      venues.push({
        screenhostId: allocation.screenhostId,
        blocsTotal: blocs.length,
        blocsDelivered: 0,
        montantTnd: 0,
        deliveredTnd: 0,
        refundTnd: 0,
        attestationNegated: isNegated,
        statut: allocation.statut,
        impressionsTotal: 0,
        impressionsDelivered: 0,
      });
      continue;
    }

    // ACCEPTE and EN_ATTENTE both carry engaged value the advertiser committed. An allocation
    // still EN_ATTENTE at window close never aired (the owner never decided) → fully refunded.
    engagedTnd += montantTnd;
    expectedImp += allocation.impressionsTotal;
    let deliveredBlocs = 0;
    if (allocation.statut === 'ACCEPTE' && !isNegated) {
      const venueProofs = proofsByVenue.get(allocation.screenhostId) ?? [];
      for (const bloc of blocs) {
        const start = new Date(bloc.start).getTime();
        const end = new Date(bloc.end).getTime();
        if (venueProofs.some((t) => t >= start && t < end)) deliveredBlocs += 1;
      }
    }
    // Pro-rata over the venue's CHARGEABLE value (EV4's cap): a free over-delivery bloc carries
    // no charge, so it can never generate a refund either.
    const share = blocs.length === 0 ? 0 : deliveredBlocs / blocs.length;
    const venueDelivered = round3(montantTnd * share);
    const venueDeliveredImp = Math.round(allocation.impressionsTotal * share);
    deliveredTnd += venueDelivered;
    deliveredImp += venueDeliveredImp;
    venues.push({
      screenhostId: allocation.screenhostId,
      blocsTotal: blocs.length,
      blocsDelivered: deliveredBlocs,
      montantTnd,
      deliveredTnd: venueDelivered,
      refundTnd: round3(montantTnd - venueDelivered),
      attestationNegated: isNegated,
      statut: allocation.statut,
      impressionsTotal: allocation.impressionsTotal,
      impressionsDelivered: venueDeliveredImp,
    });
  }

  engagedTnd = round3(engagedTnd);
  deliveredTnd = round3(deliveredTnd);
  return {
    venues,
    engagedTnd,
    deliveredTnd,
    refundTnd: round3(engagedTnd - deliveredTnd),
    expectedImp,
    deliveredImp,
  };
};

/**
 * Settle ONE positioning: measure every (venue, bloc), value the delivered part, refund the rest.
 * `now` is injected (the reconcile-tick idiom) so tests and the sweep drive the clock.
 */
export const settleEventPositioning = async (
  positioningId: string,
  now: Date = new Date(),
): Promise<EventSettlementResult> => {
  const [row] = await db
    .select({ campaign: campaigns, event: events })
    .from(campaigns)
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .where(eq(campaigns.id, positioningId))
    .limit(1);
  if (!row) return { status: 'NOT_POSITIONING' };

  // The window must be CLOSED (an annulé event settles through the R4 void path, not here).
  const fenetre = fenetreDiffusion(row.event.kickoffAt, row.event.endsAt);
  if (now.getTime() < fenetre.windowEnd.getTime()) return { status: 'WINDOW_OPEN' };

  const existing = await db
    .select({ id: campaignReconciliation.id })
    .from(campaignReconciliation)
    .where(eq(campaignReconciliation.campaignId, positioningId))
    .limit(1);
  if (existing.length > 0) return { status: 'ALREADY_SETTLED' };

  const measured = await measureEventDelivery(positioningId, row.event.id);
  if (measured.venues.length === 0) return { status: 'NO_ALLOCATIONS' };
  const { engagedTnd, deliveredTnd, refundTnd, expectedImp, deliveredImp, venues } = measured;

  // EV6 — the VENUE side joins the settlement: each delivering venue's DELIVERED value goes
  // through E7's rail (computeReversement, 50/44/3/3 from the live config) into reversement_lines
  // with source='event'. The rail is CALLED, never modified. The refunded/undelivered value NEVER
  // enters a base — the base IS the delivered value, so the E7 identity (Σ lines ≡ delivered)
  // holds for events by construction. A fully-refunded positioning writes NO lines at all.
  const cfg = await getDispatchConfig();
  const pcts = {
    sh: cfg.pctSh,
    toodooh: cfg.pctToodooh,
    agentSh: cfg.pctAgentSh,
    agentSc: cfg.pctAgentSc,
  };
  const paying = venues.filter((v) => v.deliveredTnd > 0);
  const splits = paying.map((v) => ({
    screenhostId: v.screenhostId,
    deliveredTnd: v.deliveredTnd,
    // The event unit is bloc VALUE in TND, so the base is the delivered money directly (the
    // campaign path's proportional form reduces to the same thing when C_cible = target × CPM).
    split: computeReversement(tndToMillimes(v.deliveredTnd), pcts),
  }));

  // Agent attribution, resolved exactly as the campaign path resolves it: the venue OWNER's
  // referring agent takes the SH agent line, the ADVERTISER's takes the SC one.
  const ownerRows = splits.length
    ? await db
        .select({ id: screenhosts.id, ownerId: screenhosts.ownerId })
        .from(screenhosts)
        .where(
          inArray(
            screenhosts.id,
            splits.map((sp) => sp.screenhostId),
          ),
        )
    : [];
  const ownerBySh = new Map(ownerRows.map((r) => [r.id, r.ownerId]));
  const referredIds = [
    ...new Set(
      [...ownerRows.map((r) => r.ownerId), row.campaign.advertiserId].filter(
        (v): v is string => v !== null,
      ),
    ),
  ];
  const referralRows = referredIds.length
    ? await db
        .select({
          agentUserId: agentReferrals.agentUserId,
          referredUserId: agentReferrals.referredUserId,
        })
        .from(agentReferrals)
        .where(inArray(agentReferrals.referredUserId, referredIds))
    : [];
  const agentByReferred = new Map(referralRows.map((r) => [r.referredUserId, r.agentUserId]));

  const inserted = await db
    .insert(campaignReconciliation)
    .values({
      campaignId: positioningId,
      expectedImp,
      deliveredImp,
      manquementImp: Math.max(0, expectedImp - deliveredImp),
      pPerteTnd: String(round4(refundTnd)),
      // E6's money movement, reused verbatim: spend_tnd is the NET debit the wallet sees, so the
      // undelivered value is never debited — that IS the refund. NO S_min floor here: the event
      // spec refunds the undelivered value directly, whatever its size.
      refundTnd: String(round4(refundTnd)),
      spendTnd: String(round4(deliveredTnd)),
      status: refundTnd > 0 ? 'partial' : 'reussie',
      reconciledBy: null,
    })
    .onConflictDoNothing()
    .returning({ id: campaignReconciliation.id });
  if (inserted.length === 0) return { status: 'ALREADY_SETTLED' };
  const reconciliationId = inserted[0]?.id ?? '';

  if (splits.length > 0) {
    // The venue payable + the four-way split, in the campaign path's own shapes.
    await db.insert(campaignScreenhostPayout).values(
      splits.map((sp) => {
        const line = venues.find((v) => v.screenhostId === sp.screenhostId);
        return {
          reconciliationId,
          campaignId: positioningId,
          screenhostId: sp.screenhostId,
          expectedImp: line?.impressionsTotal ?? 0,
          deliveredImp: line?.impressionsDelivered ?? 0,
          earningsTnd: String(millimesToTnd(sp.split.shMillimes)),
        };
      }),
    );
    await db.insert(reversementLines).values(
      splits.map((sp) => {
        const ownerId = ownerBySh.get(sp.screenhostId) ?? null;
        return {
          source: 'event',
          campaignId: positioningId,
          screenhostId: sp.screenhostId,
          baseValueTnd: String(millimesToTnd(sp.split.baseMillimes)),
          shAmountTnd: String(millimesToTnd(sp.split.shMillimes)),
          toodoohAmountTnd: String(millimesToTnd(sp.split.toodoohMillimes)),
          agentShAmountTnd: String(millimesToTnd(sp.split.agentShMillimes)),
          agentScAmountTnd: String(millimesToTnd(sp.split.agentScMillimes)),
          agentShId: ownerId === null ? null : (agentByReferred.get(ownerId) ?? null),
          agentScId: agentByReferred.get(row.campaign.advertiserId) ?? null,
          settledAt: new Date(),
        };
      }),
    );
  }

  await db.insert(notifications).values([
    {
      userId: row.campaign.advertiserId,
      type: 'event_settled',
      title: EVENT_SETTLED_TITLE,
      body: eventSettledBody(row.campaign.name, refundTnd),
      campaignId: positioningId,
    },
    // SC-P epic 2 — a positioning's clôture is a clôture: its report is ready too.
    campaignReportReadyNotification({
      id: positioningId,
      name: row.campaign.name,
      advertiserId: row.campaign.advertiserId,
    }),
  ]);

  // The positioning's lifecycle ends here (the classic completed flip is date-driven; an event's
  // window closes intra-day, so the settlement owns the flip).
  await db
    .update(campaigns)
    .set({ status: 'completed' })
    .where(and(eq(campaigns.id, positioningId), inArray(campaigns.status, ['active', 'upcoming'])));

  return { status: 'SETTLED', engagedTnd, deliveredTnd, refundTnd, venues };
};

export interface EventSettlementSweepResult {
  scanned: number;
  settled: number;
}

/**
 * The sweep: every non-annulé positioning whose window has closed and which is not yet settled.
 * Boot tick + hourly unref'd interval (the reconcile/lifecycle posture).
 */
export const runEventSettlementSweep = async (
  log: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<EventSettlementSweepResult> => {
  const candidates = await db
    .select({ id: campaigns.id, kickoffAt: events.kickoffAt, endsAt: events.endsAt })
    .from(campaigns)
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .where(
      and(
        inArray(campaigns.status, ['active', 'upcoming']),
        eq(events.annule, false),
        // Cheap pre-filter: the window ends at most 1 h after ends_at.
        lt(events.endsAt, new Date(now.getTime())),
      ),
    );
  let settled = 0;
  for (const candidate of candidates) {
    try {
      const result = await settleEventPositioning(candidate.id, now);
      if (result.status === 'SETTLED') settled += 1;
    } catch (err) {
      log.warn({ err, positioningId: candidate.id }, 'event settlement failed');
    }
  }
  if (settled > 0) {
    log.info({ scanned: candidates.length, settled }, 'event settlement sweep applied');
  }
  return { scanned: candidates.length, settled };
};

export const EVENT_SETTLEMENT_TICK_MS = 60 * 60 * 1000;

export function startEventSettlementJob(log: FastifyBaseLogger): void {
  void runEventSettlementSweep(log).catch((err: unknown) =>
    log.warn({ err }, 'event settlement boot sweep failed'),
  );
  const timer = setInterval(() => {
    void runEventSettlementSweep(log).catch((err: unknown) =>
      log.warn({ err }, 'event settlement sweep failed'),
    );
  }, EVENT_SETTLEMENT_TICK_MS);
  timer.unref();
}
