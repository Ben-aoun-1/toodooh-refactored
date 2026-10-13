import { subDays } from 'date-fns';
import { and, desc, eq, gte, inArray, isNull, lte, max, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  agentAffiliations,
  agentAttentionEvents,
  agentAttentionThresholds,
  agentShFollowupSnapshots,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  eventAllocations,
  notifications,
  proofOfPlay,
  screenhostUnavailability,
  screenhosts,
} from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';
import { parseBlocs } from './event-playout/spots.js';
import { proofInstantSql } from './playout/proof-instant.js';
import { proofSlotKey } from './reconcile/delivered-slots.js';
import { computeSps, spsComputable } from './sps-score.js';

// AGT-7 (Agent Screenhost spec v1.0 §6 « Suivi de mes Screenhosts »), one home. Once a day, for
// every venue pending activation or affiliated, the engine's sources are read into one snapshot:
// the score as the engine stored it and its four rates (lib/sps-score — the weights never leave
// the server), the offers of the last 30 days (received / accepted / refused / unanswered after
// 24 h), the missed plays by cause, the unavailable days declared, the last diffusion. The
// attention points come from the hub's thresholds; each appearance is journaled and notified once,
// a cleared one closes by itself on the next run.

const DAY_MS = 24 * 60 * 60 * 1000;

export type AttentionSignal =
  | 'refus_frequents'
  | 'sans_reponse'
  | 'ecrans_peu_actifs'
  | 'evenement_non_diffuse'
  | 'aucune_campagne_recente'
  | 'baisse_score';

export const ATTENTION_FR: Record<AttentionSignal, string> = {
  refus_frequents: 'Refus fréquents',
  sans_reponse: 'Offres sans réponse répétées',
  ecrans_peu_actifs: 'Écrans peu actifs',
  evenement_non_diffuse: 'Événement accepté non diffusé',
  aucune_campagne_recente: 'Aucune campagne récente',
  baisse_score: 'Baisse du score de priorité',
};

export interface Thresholds {
  refusPct: number;
  sansReponseCount: number;
  activitePct: number;
  evenementCount: number;
  inactiviteDays: number;
  baisseScorePoints: number;
}

export const loadThresholds = async (): Promise<Thresholds> => {
  const [t] = await db.select().from(agentAttentionThresholds).limit(1);
  return {
    refusPct: Number(t?.refusPct ?? 30),
    sansReponseCount: t?.sansReponseCount ?? 2,
    activitePct: Number(t?.activitePct ?? 70),
    evenementCount: t?.evenementCount ?? 1,
    inactiviteDays: t?.inactiviteDays ?? 30,
    baisseScorePoints: Number(t?.baisseScorePoints ?? 10),
  };
};

export interface MissedPlay {
  at: string;
  campaign: string;
  cause: 'ecran' | 'evenement';
}
export interface UnacceptedOffer {
  at: string;
  type: 'standard' | 'evenement';
  outcome: 'refusee' | 'sans_reponse';
}

export interface VenueMetrics {
  sps: number | null;
  rates: {
    acceptation: number;
    respect_evenements: number;
    activite: number;
    remplissage: number;
  } | null;
  offers: { received: number; accepted: number; refused: number; no_answer: number };
  missed: MissedPlay[];
  unavailableDays: number;
  lastDiffusionAt: Date | null;
  unaccepted: UnacceptedOffer[];
}

/** The live 30-day picture of one venue (the snapshot's source and the sheet's history). */
export const venueMetrics = async (screenhostId: string, now: Date): Promise<VenueMetrics> => {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const late = (created: Date) => now.getTime() - created.getTime() > DAY_MS;

  const [venue] = await db
    .select({ sps: screenhosts.sps })
    .from(screenhosts)
    .where(eq(screenhosts.id, screenhostId))
    .limit(1);
  const live = await computeSps(screenhostId, now);
  const computable = spsComputable(live.observations);

  // Offers of the last 30 days.
  const campaignOffers = await db
    .select({ a: campaignDispatchAllocation, name: campaigns.name, campaignId: campaigns.id })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .where(eq(campaignDispatchAllocation.screenhostId, screenhostId));
  const eventOffers = await db
    .select({ a: eventAllocations, name: campaigns.name })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(campaigns.id, eventAllocations.campaignId))
    .where(eq(eventAllocations.screenhostId, screenhostId));
  const offers = { received: 0, accepted: 0, refused: 0, no_answer: 0 };
  const unaccepted: UnacceptedOffer[] = [];
  for (const { a } of campaignOffers.filter((o) => o.a.createdAt >= since)) {
    offers.received += 1;
    if (a.statutAcceptation === 'ACCEPTE') offers.accepted += 1;
    else if (a.statutAcceptation === 'REFUSE') {
      offers.refused += 1;
      unaccepted.push({ at: a.createdAt.toISOString(), type: 'standard', outcome: 'refusee' });
    } else if (late(a.createdAt)) {
      offers.no_answer += 1;
      unaccepted.push({ at: a.createdAt.toISOString(), type: 'standard', outcome: 'sans_reponse' });
    }
  }
  for (const { a } of eventOffers.filter((o) => o.a.createdAt >= since)) {
    offers.received += 1;
    const answeredLate =
      a.decidedAt !== null && a.decidedAt.getTime() - a.createdAt.getTime() > DAY_MS;
    if (a.statut === 'ACCEPTE') offers.accepted += 1;
    if (a.statut === 'REFUSE') {
      offers.refused += 1;
      unaccepted.push({ at: a.createdAt.toISOString(), type: 'evenement', outcome: 'refusee' });
    } else if ((a.statut === 'EN_ATTENTE' && late(a.createdAt)) || answeredLate) {
      offers.no_answer += 1;
      if (a.statut === 'EN_ATTENTE') {
        unaccepted.push({
          at: a.createdAt.toISOString(),
          type: 'evenement',
          outcome: 'sans_reponse',
        });
      }
    }
  }

  // Missed plays of the last 30 days: an elapsed accepted créneau (campaign) or bloc (event)
  // without a VIDEO_ENDED proof — fully blacked-out hours are not scheduled plays.
  const proofs = await db
    .select({ campaignId: proofOfPlay.campaignId, at: proofInstantSql })
    .from(proofOfPlay)
    .where(
      and(
        eq(proofOfPlay.screenhostId, screenhostId),
        eq(proofOfPlay.eventType, 'VIDEO_ENDED'),
        gte(proofOfPlay.receivedAt, since),
      ),
    );
  const missed: MissedPlay[] = [];
  for (const { a, name, campaignId } of campaignOffers) {
    if (a.statutAcceptation !== 'ACCEPTE') continue;
    const keys = new Set(
      proofs.filter((p) => p.campaignId === campaignId).map((p) => proofSlotKey(p.at)),
    );
    for (const c of a.creneaux) {
      if ((c.blackoutMin ?? 0) >= 60) continue;
      const start = new Date(`${c.date}T${String(c.hour).padStart(2, '0')}:00:00+01:00`);
      if (start < since || start.getTime() + 3600_000 > now.getTime()) continue;
      if (!keys.has(proofSlotKey(start)))
        missed.push({ at: start.toISOString(), campaign: name, cause: 'ecran' });
    }
  }
  for (const { a, name } of eventOffers) {
    if (a.statut !== 'ACCEPTE') continue;
    const times = proofs.filter((p) => p.campaignId === a.campaignId).map((p) => p.at.getTime());
    for (const b of parseBlocs(a.blocs)) {
      const start = new Date(b.start);
      const end = new Date(b.end);
      if (start < since || end > now) continue;
      if (!times.some((t) => t >= start.getTime() && t < end.getTime())) {
        missed.push({ at: start.toISOString(), campaign: name, cause: 'evenement' });
      }
    }
  }

  const [off] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(screenhostUnavailability)
    .where(
      and(
        eq(screenhostUnavailability.screenhostId, screenhostId),
        gte(screenhostUnavailability.day, tunisDateOf(subDays(now, 29))),
        lte(screenhostUnavailability.day, tunisDateOf(now)),
      ),
    );
  const [last] = await db
    .select({ at: max(proofInstantSql) })
    .from(proofOfPlay)
    .where(
      and(eq(proofOfPlay.screenhostId, screenhostId), eq(proofOfPlay.eventType, 'VIDEO_ENDED')),
    );

  return {
    sps: computable && venue ? Number(venue.sps) : null,
    rates: computable ? live.variables : null,
    offers,
    missed: missed.sort((x, y) => y.at.localeCompare(x.at)),
    unavailableDays: off?.n ?? 0,
    lastDiffusionAt: last?.at ? new Date(last.at) : null,
    unaccepted: unaccepted.sort((x, y) => y.at.localeCompare(x.at)),
  };
};

/** The active attention points of one venue (pure). */
export const attentionSignals = (
  m: Pick<VenueMetrics, 'sps' | 'rates' | 'offers' | 'missed' | 'lastDiffusionAt'>,
  t: Thresholds,
  ctx: { activated: boolean; sps30DaysAgo: number | null; now: Date },
): AttentionSignal[] => {
  const out: AttentionSignal[] = [];
  if (m.offers.received > 0 && (m.offers.refused / m.offers.received) * 100 > t.refusPct) {
    out.push('refus_frequents');
  }
  if (m.offers.no_answer > 0 && m.offers.no_answer >= t.sansReponseCount) out.push('sans_reponse');
  if (m.rates && m.rates.activite < t.activitePct) out.push('ecrans_peu_actifs');
  if (m.missed.filter((x) => x.cause === 'evenement').length >= Math.max(1, t.evenementCount)) {
    out.push('evenement_non_diffuse');
  }
  if (
    ctx.activated &&
    (m.lastDiffusionAt === null ||
      ctx.now.getTime() - m.lastDiffusionAt.getTime() > t.inactiviteDays * DAY_MS)
  ) {
    out.push('aucune_campagne_recente');
  }
  if (
    ctx.sps30DaysAgo !== null &&
    m.sps !== null &&
    ctx.sps30DaysAgo - m.sps > t.baisseScorePoints
  ) {
    out.push('baisse_score');
  }
  return out;
};

/** The snapshot of `day` for each venue (latest at or before it). */
export const snapshotOn = async (screenhostId: string, day: string) =>
  (
    await db
      .select()
      .from(agentShFollowupSnapshots)
      .where(
        and(
          eq(agentShFollowupSnapshots.screenhostId, screenhostId),
          lte(agentShFollowupSnapshots.day, day),
        ),
      )
      .orderBy(desc(agentShFollowupSnapshots.day))
      .limit(1)
  )[0] ?? null;

/** Compute and store today's snapshot for every followed venue; journal and notify signals. */
export const runAgentShFollowupTick = async (now: Date = new Date()) => {
  const followed = await db
    .select({ aff: agentAffiliations, venue: screenhosts })
    .from(agentAffiliations)
    .innerJoin(screenhosts, eq(screenhosts.id, agentAffiliations.screenhostId))
    .where(inArray(agentAffiliations.status, ['en_attente_activation', 'en_cours']));
  const thresholds = await loadThresholds();
  const today = tunisDateOf(now);
  let appeared = 0;
  for (const { aff, venue } of followed) {
    // A venue's FIRST computation is a silent baseline: its points are journaled but not
    // notified, so deploy day (or a new affiliation) does not send every existing signal at once.
    const baseline = (await snapshotOn(venue.id, tunisDateOf(subDays(now, 1)))) === null;
    const m = await venueMetrics(venue.id, now);
    const past = await snapshotOn(venue.id, tunisDateOf(subDays(now, 30)));
    const signals = attentionSignals(m, thresholds, {
      activated: aff.status === 'en_cours',
      sps30DaysAgo: past?.sps != null ? Number(past.sps) : null,
      now,
    });
    const row = {
      screenhostId: venue.id,
      day: today,
      sps: m.sps === null ? null : String(m.sps),
      acceptation: m.rates ? String(m.rates.acceptation) : null,
      respectEvenements: m.rates ? String(m.rates.respect_evenements) : null,
      activite: m.rates ? String(m.rates.activite) : null,
      remplissage: m.rates ? String(m.rates.remplissage) : null,
      offersReceived: m.offers.received,
      offersAccepted: m.offers.accepted,
      offersRefused: m.offers.refused,
      offersNoAnswer: m.offers.no_answer,
      missedOffline: m.missed.filter((x) => x.cause === 'ecran').length,
      missedEvent: m.missed.filter((x) => x.cause === 'evenement').length,
      unavailableDays: m.unavailableDays,
      lastDiffusionAt: m.lastDiffusionAt,
      signals,
      computedAt: now,
    };
    await db
      .insert(agentShFollowupSnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: [agentShFollowupSnapshots.screenhostId, agentShFollowupSnapshots.day],
        set: row,
      });

    const open = await db
      .select()
      .from(agentAttentionEvents)
      .where(
        and(
          eq(agentAttentionEvents.screenhostId, venue.id),
          isNull(agentAttentionEvents.clearedAt),
        ),
      );
    for (const o of open) {
      if (!signals.includes(o.signal as AttentionSignal)) {
        await db
          .update(agentAttentionEvents)
          .set({ clearedAt: now })
          .where(eq(agentAttentionEvents.id, o.id));
      }
    }
    for (const s of signals) {
      if (open.some((o) => o.signal === s)) continue;
      const inserted = await db
        .insert(agentAttentionEvents)
        .values({ screenhostId: venue.id, signal: s, appearedAt: now })
        .onConflictDoNothing()
        .returning({ id: agentAttentionEvents.id });
      if (inserted.length === 0 || baseline) continue;
      appeared += 1;
      await db.insert(notifications).values({
        userId: aff.agentUserId,
        type: 'agent_attention',
        title: `Point d’attention : ${venue.name}, ${ATTENTION_FR[s]}`,
        body: 'Consultez le suivi de ce Screenhost dans « Mes Screenhosts ».',
        link: '/agent/affilies',
      });
    }
  }
  return { venues: followed.length, appeared };
};

/** Boot + every 24 h, unref'd. */
export function startAgentShFollowupJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runAgentShFollowupTick().catch((err: unknown) =>
      log.warn({ err }, 'agent screenhost follow-up tick failed'),
    );
  tick();
  setInterval(tick, DAY_MS).unref();
}
