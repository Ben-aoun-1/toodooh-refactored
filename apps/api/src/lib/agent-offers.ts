import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  ne,
  notExists,
  notInArray,
  sql,
} from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  type AllocationDecider,
  agentAffiliations,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignZones,
  campaigns,
  creatives,
  notifications,
  screenhosts,
  users,
  zones,
} from '../db/schema.js';

import { tunisDateOf } from './campaign-dates.js';
import { loadOwnerSharePcts, ownerShareTnd } from './owner-share.js';

// Agent Screenhost spec VF §10 (Mariem 12/11/2026) — « Offres de campagne : l'agent peut répondre
// à la place du Screenhost ». ONE home for what the agent reads of an offer (the same things the
// Host sees: the spot, what the Host earns, type, dates, zone), for the wording of the four
// notices, and for the sweep that tells the agent about a new offer.
//
// Scope: classic campaign offers here; match-night offers in lib/agent-event-offers.ts (Mariem
// 15/11: « toutes les campagnes reçues par le Host »), with the same view and notices. An offer belongs to an agent while
// the venue's affiliation to him is live (neither ended nor « exclue »); a demo campaign never reaches an agent.

/** The campaign statuses whose pending proposals can still be answered (B-ACC1, owner twin). */
const DECIDABLE = ['pending', 'upcoming', 'active'] as const;

/** The affiliation states in which the agent acts for the venue (not ended, not excluded). */
const LIVE_AFFILIATION = ['en_attente_activation', 'en_cours'] as const;

export const OFFER_NEW_TYPE = 'agent_offer_new';
export const OFFER_HOST_ANSWERED_TYPE = 'agent_host_answered';
export const HOST_AGENT_DECIDED_TYPE = 'agent_decided_for_host';

/** Where « Consulter » goes: the agent's Dashboard with the offer window open. */
export const offerLink = (allocationId: string): string => `/agent?offre=${allocationId}`;

/** « 99,792 TND » — an amount in the notices, up to 3 decimals. */
const tnd = (n: number): string =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} TND`;

// ── wording (French, verbatim from the spec) ───────────────────────────────────────────────────

export const offerNewNotice = (venue: string, campaign: string) => ({
  title: `Nouvelle offre de campagne pour ${venue} : ${campaign}`,
  body: `Consultez le spot et ce que gagnera ${venue}. Vous pouvez accepter ou refuser pour son compte.`,
});

/** The agent's own answer: his offer notice is rewritten, as in the prototype. */
export const offerAgentAnsweredNotice = (accepted: boolean, venue: string, campaign: string) => ({
  title: `${accepted ? 'Offre acceptée' : 'Offre refusée'} : ${campaign} (${venue})`,
  body: `Vous avez ${accepted ? 'accepté' : 'refusé'} cette offre pour le compte de ${venue}. Le Screenhost a été informé.`,
});

export const offerHostAnsweredNotice = (accepted: boolean, venue: string, campaign: string) => ({
  title: `${venue} a ${accepted ? 'accepté' : 'refusé'} l'offre : ${campaign}`,
  body: 'Le Screenhost a déjà répondu : aucune action de votre part.',
});

export const hostAgentDecidedNotice = (accepted: boolean, campaign: string, gainTnd: number) => ({
  title: accepted
    ? `Votre agent a accepté la campagne ${campaign} : vous allez gagner ${tnd(gainTnd)}`
    : `Votre agent a refusé la campagne ${campaign}`,
  body: accepted
    ? 'Pensez à maintenir vos écrans actifs pour assurer la diffusion.'
    : 'Cette campagne ne sera pas diffusée sur votre écran.',
});

// ── what the agent reads ───────────────────────────────────────────────────────────────────────

export type OfferState = 'attente' | 'acceptee' | 'refusee';
/** Who answered, from the agent's seat. */
export type OfferAnsweredBy = 'vous' | 'screenhost' | 'toodooh';

export interface AgentOfferView {
  id: string;
  /** A classic campaign offer, or a match-night share (lib/agent-event-offers.ts). */
  kind: 'campaign' | 'event';
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  start_date: string | null;
  end_date: string | null;
  /** A match's kick-off (ISO); null for a classic campaign. */
  kickoff_at: string | null;
  screenhost_id: string;
  screenhost_name: string;
  /** Zone NAMES; [] = the whole network. */
  zones: string[];
  /** What the Host earns: its share, exactly the amount the Host sees. */
  gain_tnd: number;
  /** How many spots the answer covers (a grouped match: all its waiting spots; else 1). */
  spots: number;
  state: OfferState;
  answered_by: OfferAnsweredBy | null;
  /** Still pending AND the campaign can still air: Accepter / Refuser are shown. */
  decidable: boolean;
  creative: { kind: 'video' | 'photo'; duration_seconds: number | null } | null;
}

export const offerState = (statut: string): OfferState =>
  statut === 'ACCEPTE' ? 'acceptee' : statut === 'REFUSE' ? 'refusee' : 'attente';

export const offerAnsweredBy = (
  statut: string,
  by: AllocationDecider | null,
  byUserId: string | null,
  agentUserId: string,
): OfferAnsweredBy | null => {
  if (statut !== 'ACCEPTE' && statut !== 'REFUSE') return null;
  if (by === 'admin') return 'toodooh';
  // Another agent's answer (a reassigned venue) reads as the venue's own.
  if (by === 'agent' && byUserId === agentUserId) return 'vous';
  return 'screenhost';
};

/** The agent's live affiliation to the allocation's venue, as a join condition. */
const affiliationOf = (agentUserId: string) =>
  and(
    eq(agentAffiliations.screenhostId, campaignDispatchAllocation.screenhostId),
    eq(agentAffiliations.agentUserId, agentUserId),
    inArray(agentAffiliations.status, [...LIVE_AFFILIATION]),
  );

const offerRows = (agentUserId: string, allocationId: string | null) =>
  db
    .select({
      a: campaignDispatchAllocation,
      campaign: campaigns,
      venueName: screenhosts.name,
      ownerId: screenhosts.ownerId,
      creativeKind: creatives.creativeType,
      creativeDuration: creatives.durationSeconds,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(agentAffiliations, affiliationOf(agentUserId))
    .innerJoin(screenhosts, eq(screenhosts.id, campaignDispatchAllocation.screenhostId))
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .innerJoin(users, eq(users.id, campaigns.advertiserId))
    .leftJoin(creatives, eq(creatives.id, campaigns.creativeId))
    .where(
      and(
        // A reservation is not an offer yet (DISP-TOURS Q1).
        ne(campaignDispatchAllocation.statutAcceptation, 'RESERVE'),
        isNull(campaigns.eventId),
        eq(users.isDemo, false),
        allocationId === null
          ? and(
              eq(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE'),
              inArray(campaigns.status, [...DECIDABLE]),
              gte(campaigns.endDate, tunisDateOf(new Date())),
            )
          : eq(campaignDispatchAllocation.id, allocationId),
      ),
    )
    .orderBy(desc(campaignDispatchAllocation.createdAt));

const toViews = async (
  agentUserId: string,
  rows: Awaited<ReturnType<typeof offerRows>>,
  now: Date,
): Promise<AgentOfferView[]> => {
  if (rows.length === 0) return [];
  const pcts = await loadOwnerSharePcts();
  const zoneRows = await db
    .select({ campaignId: campaignZones.campaignId, name: zones.name })
    .from(campaignZones)
    .innerJoin(zones, eq(zones.id, campaignZones.zoneId))
    .where(inArray(campaignZones.campaignId, [...new Set(rows.map((r) => r.campaign.id))]))
    .orderBy(asc(zones.name));
  const today = tunisDateOf(now);
  return rows.map(({ a, campaign: c, venueName, creativeKind, creativeDuration }) => ({
    id: a.id,
    kind: 'campaign' as const,
    campaign_id: c.id,
    campaign_name: c.name,
    campaign_type: c.campaignType,
    start_date: c.startDate,
    end_date: c.endDate,
    kickoff_at: null,
    screenhost_id: a.screenhostId,
    screenhost_name: venueName,
    zones: zoneRows.filter((z) => z.campaignId === c.id).map((z) => z.name),
    gain_tnd: ownerShareTnd(Number(a.revenuPrevisionnel), pcts),
    spots: 1,
    state: offerState(a.statutAcceptation),
    answered_by: offerAnsweredBy(a.statutAcceptation, a.decidedBy, a.decidedByUserId, agentUserId),
    decidable:
      a.statutAcceptation === 'EN_ATTENTE' &&
      (DECIDABLE as readonly string[]).includes(c.status) &&
      c.endDate !== null &&
      c.endDate >= today,
    creative:
      creativeKind === null ? null : { kind: creativeKind, duration_seconds: creativeDuration },
  }));
};

/** The offers still waiting on the agent's affiliated venues, newest first. */
export const agentPendingOffers = async (
  agentUserId: string,
  now: Date = new Date(),
): Promise<AgentOfferView[]> => toViews(agentUserId, await offerRows(agentUserId, null), now);

/** One offer of an affiliated venue, in any state (a foreign or missing one = null). */
export const agentOffer = async (
  agentUserId: string,
  allocationId: string,
  now: Date = new Date(),
): Promise<{ offer: AgentOfferView; ownerId: string | null } | null> => {
  const rows = await offerRows(agentUserId, allocationId);
  const [offer] = await toViews(agentUserId, rows, now);
  return offer ? { offer, ownerId: rows[0]?.ownerId ?? null } : null;
};

// ── notices ────────────────────────────────────────────────────────────────────────────────────

/** After the AGENT's answer: his offer notice is rewritten and read; the Host is told. */
export const noticeAgentAnswered = async (input: {
  agentUserId: string;
  ownerId: string;
  offer: Pick<
    AgentOfferView,
    'id' | 'campaign_id' | 'campaign_name' | 'screenhost_name' | 'gain_tnd'
  >;
  accepted: boolean;
}): Promise<void> => {
  const { agentUserId, ownerId, offer, accepted } = input;
  const mine = offerAgentAnsweredNotice(accepted, offer.screenhost_name, offer.campaign_name);
  const rewritten = await db
    .update(notifications)
    .set({ ...mine, readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(
      and(
        eq(notifications.userId, agentUserId),
        eq(notifications.type, OFFER_NEW_TYPE),
        eq(notifications.link, offerLink(offer.id)),
      ),
    )
    .returning({ id: notifications.id });
  if (rewritten.length === 0) {
    // He answered before the sweep told him: the result alone, already read, never emailed.
    await db.insert(notifications).values({
      userId: agentUserId,
      type: OFFER_NEW_TYPE,
      ...mine,
      campaignId: offer.campaign_id,
      link: offerLink(offer.id),
      readAt: new Date(),
      emailedAt: new Date(),
    });
  }
  await db.insert(notifications).values({
    userId: ownerId,
    type: HOST_AGENT_DECIDED_TYPE,
    ...hostAgentDecidedNotice(accepted, offer.campaign_name, offer.gain_tnd),
    campaignId: offer.campaign_id,
  });
};

/** After the HOST's own answer: its agent (if any) is told he can no longer act. */
export const noticeHostAnswered = async (
  allocationId: string,
  accepted: boolean,
): Promise<void> => {
  const [row] = await db
    .select({
      agentUserId: agentAffiliations.agentUserId,
      venueName: screenhosts.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(
      agentAffiliations,
      and(
        eq(agentAffiliations.screenhostId, campaignDispatchAllocation.screenhostId),
        inArray(agentAffiliations.status, [...LIVE_AFFILIATION]),
      ),
    )
    .innerJoin(agents, eq(agents.userId, agentAffiliations.agentUserId))
    .innerJoin(screenhosts, eq(screenhosts.id, campaignDispatchAllocation.screenhostId))
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .innerJoin(users, eq(users.id, campaigns.advertiserId))
    .where(
      and(
        eq(campaignDispatchAllocation.id, allocationId),
        isNull(campaigns.eventId),
        eq(users.isDemo, false),
      ),
    )
    .limit(1);
  if (!row) return;
  await db.insert(notifications).values({
    userId: row.agentUserId,
    type: OFFER_HOST_ANSWERED_TYPE,
    ...offerHostAnsweredNotice(accepted, row.venueName, row.campaignName),
    campaignId: row.campaignId,
    link: offerLink(allocationId),
  });
};

/**
 * « Son agent reçoit la même offre en même temps » — every pending, still answerable offer of an
 * affiliated venue gets ONE notice to the venue's agent. A sweep (not a write at each of the
 * engine's proposal sites): the offer exists the moment the row is EN_ATTENTE, whoever placed it.
 */
export const runAgentOfferNoticeTick = async (now: Date = new Date()): Promise<number> => {
  const rows = await db
    .select({
      allocationId: campaignDispatchAllocation.id,
      agentUserId: agentAffiliations.agentUserId,
      venueName: screenhosts.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(
      agentAffiliations,
      and(
        eq(agentAffiliations.screenhostId, campaignDispatchAllocation.screenhostId),
        inArray(agentAffiliations.status, [...LIVE_AFFILIATION]),
      ),
    )
    .innerJoin(agents, eq(agents.userId, agentAffiliations.agentUserId))
    .innerJoin(screenhosts, eq(screenhosts.id, campaignDispatchAllocation.screenhostId))
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId))
    .innerJoin(users, eq(users.id, campaigns.advertiserId))
    .where(
      and(
        eq(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE'),
        isNull(campaigns.eventId),
        eq(users.isDemo, false),
        // A suspended or closed agent account gets nothing.
        notInArray(agents.accountStatus, ['suspendu', 'cloture']),
        inArray(campaigns.status, [...DECIDABLE]),
        gte(campaigns.endDate, tunisDateOf(now)),
        notExists(
          db
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, agentAffiliations.agentUserId),
                eq(notifications.type, OFFER_NEW_TYPE),
                eq(
                  notifications.link,
                  sql`'/agent?offre=' || ${campaignDispatchAllocation.id}::text`,
                ),
              ),
            ),
        ),
      ),
    )
    .limit(200);
  for (const r of rows) {
    await db.insert(notifications).values({
      userId: r.agentUserId,
      type: OFFER_NEW_TYPE,
      ...offerNewNotice(r.venueName, r.campaignName),
      campaignId: r.campaignId,
      link: offerLink(r.allocationId),
    });
  }
  return rows.length;
};

/** Every minute, unref'd. */
export function startAgentOfferNoticeJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runAgentOfferNoticeTick().catch((err: unknown) =>
      log.warn({ err }, 'agent offer notice tick failed'),
    );
  setInterval(tick, 60 * 1000).unref();
}
