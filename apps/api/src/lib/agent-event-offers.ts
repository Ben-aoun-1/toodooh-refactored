import { and, desc, eq, gt, inArray, notInArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  agentAffiliations,
  agents,
  campaigns,
  creatives,
  eventAllocations,
  events,
  notifications,
  screenhosts,
} from '../db/schema.js';

import {
  type AgentOfferView,
  OFFER_HOST_ANSWERED_TYPE,
  OFFER_NEW_TYPE,
  offerAnsweredBy,
  offerHostAnsweredNotice,
  offerLink,
  offerNewNotice,
  offerState,
} from './agent-offers.js';
import { tunisDateOf } from './campaign-dates.js';
import { notStoppedCampaignSql } from './campaign-stopped.js';
import { notDemoEventAllocationSql } from './demo.js';
import { loadOwnerSharePcts, ownerShareTnd } from './owner-share.js';

// Mariem 15/11/2026 — « Oui, l'agent doit pouvoir répondre à toutes les campagnes reçues par le
// Host (quotidiennes, événements et Ramadan) ». The match-night shares of an agent's affiliated
// venues, read and answered like the classic offers of lib/agent-offers.ts (same view, same
// notices, same first-answer-final rule through lib/event-allocation-decision.ts).
//
// A share is an offer once the Host was asked about it (notice 'single' or 'grouped'): a share
// still waiting for the match's notice (kick-off − 24 h) is not one yet. A grouped share stands for
// its whole match on that venue, as in the Host's « Soir de match » popup: its view carries the
// match's total and spot count, and an answer covers every spot of the match still waiting.

const LIVE_AFFILIATION = ['en_attente_activation', 'en_cours'] as const;
const ASKED = ['single', 'grouped'] as const;

const affiliationOf = (agentUserId: string) =>
  and(
    eq(agentAffiliations.screenhostId, eventAllocations.screenhostId),
    eq(agentAffiliations.agentUserId, agentUserId),
    inArray(agentAffiliations.status, [...LIVE_AFFILIATION]),
  );

const shareRows = (agentUserId: string, allocationId: string | null, now: Date) =>
  db
    .select({
      a: eventAllocations,
      positioningName: campaigns.name,
      eventId: events.id,
      matchName: events.name,
      kickoffAt: events.kickoffAt,
      endsAt: events.endsAt,
      annule: events.annule,
      venueName: screenhosts.name,
      ownerId: screenhosts.ownerId,
      creativeKind: creatives.creativeType,
      creativeDuration: creatives.durationSeconds,
    })
    .from(eventAllocations)
    .innerJoin(agentAffiliations, affiliationOf(agentUserId))
    .innerJoin(campaigns, eq(campaigns.id, eventAllocations.campaignId))
    .innerJoin(events, eq(events.id, campaigns.eventId))
    .innerJoin(screenhosts, eq(screenhosts.id, eventAllocations.screenhostId))
    .leftJoin(creatives, eq(creatives.id, campaigns.creativeId))
    .where(
      and(
        notDemoEventAllocationSql(),
        notStoppedCampaignSql(),
        inArray(eventAllocations.notice, [...ASKED]),
        allocationId === null
          ? and(
              eq(eventAllocations.statut, 'EN_ATTENTE'),
              eq(events.annule, false),
              gt(events.endsAt, now),
            )
          : eq(eventAllocations.id, allocationId),
      ),
    )
    .orderBy(desc(eventAllocations.createdAt));

type ShareRow = Awaited<ReturnType<typeof shareRows>>[number];

/** The spots of a grouped match still waiting on this venue (the popup's list), or just this one. */
const groupOf = async (row: ShareRow): Promise<{ id: string; montantTnd: number }[]> => {
  if (row.a.notice !== 'grouped' || row.a.statut !== 'EN_ATTENTE') {
    return [{ id: row.a.id, montantTnd: Number(row.a.montantTnd) }];
  }
  const rows = await db
    .select({ id: eventAllocations.id, montantTnd: eventAllocations.montantTnd })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(campaigns.id, eventAllocations.campaignId))
    .where(
      and(
        eq(campaigns.eventId, row.eventId),
        eq(eventAllocations.screenhostId, row.a.screenhostId),
        eq(eventAllocations.statut, 'EN_ATTENTE'),
        eq(eventAllocations.notice, 'grouped'),
        notStoppedCampaignSql(),
        notDemoEventAllocationSql(),
      ),
    );
  // The offer's own share first: it is the one whose answer decides (routes/agent-offers.ts).
  return rows
    .map((r) => ({ id: r.id, montantTnd: Number(r.montantTnd) }))
    .sort((x, y) => Number(y.id === row.a.id) - Number(x.id === row.a.id));
};

const sumTnd = (values: readonly number[]): number =>
  Math.round(values.reduce((s, v) => s + v * 1000, 0)) / 1000;

const toView = async (
  agentUserId: string,
  row: ShareRow,
  pcts: Awaited<ReturnType<typeof loadOwnerSharePcts>>,
  now: Date,
): Promise<{ view: AgentOfferView; shareIds: string[] }> => {
  const group = await groupOf(row);
  const day = tunisDateOf(row.kickoffAt);
  const view: AgentOfferView = {
    id: row.a.id,
    kind: 'event',
    campaign_id: row.a.campaignId,
    campaign_name: row.matchName,
    campaign_type: 'evenement',
    start_date: day,
    end_date: day,
    kickoff_at: row.kickoffAt.toISOString(),
    screenhost_id: row.a.screenhostId,
    screenhost_name: row.venueName,
    zones: [],
    gain_tnd: sumTnd(group.map((g) => ownerShareTnd(g.montantTnd, pcts))),
    spots: group.length,
    state: offerState(row.a.statut),
    answered_by: offerAnsweredBy(row.a.statut, row.a.decidedBy, row.a.decidedByUserId, agentUserId),
    decidable: row.a.statut === 'EN_ATTENTE' && !row.annule && row.endsAt.getTime() > now.getTime(),
    creative:
      row.creativeKind === null
        ? null
        : { kind: row.creativeKind, duration_seconds: row.creativeDuration },
  };
  return { view, shareIds: group.map((g) => g.id) };
};

/** The match offers still waiting on the agent's venues — one per match and venue when grouped. */
export const agentPendingEventOffers = async (
  agentUserId: string,
  now: Date = new Date(),
): Promise<AgentOfferView[]> => {
  const rows = await shareRows(agentUserId, null, now);
  if (rows.length === 0) return [];
  const pcts = await loadOwnerSharePcts();
  const seen = new Set<string>();
  const views: AgentOfferView[] = [];
  for (const row of rows) {
    const key = row.a.notice === 'grouped' ? `${row.eventId}:${row.a.screenhostId}` : row.a.id;
    if (seen.has(key)) continue;
    seen.add(key);
    views.push((await toView(agentUserId, row, pcts, now)).view);
  }
  return views;
};

/** One match share of an affiliated venue, in any state (a foreign or missing one = null). */
export const agentEventOffer = async (
  agentUserId: string,
  allocationId: string,
  now: Date = new Date(),
): Promise<{
  offer: AgentOfferView;
  ownerId: string | null;
  shareIds: string[];
} | null> => {
  const [row] = await shareRows(agentUserId, allocationId, now);
  if (!row) return null;
  const { view, shareIds } = await toView(agentUserId, row, await loadOwnerSharePcts(), now);
  return { offer: view, ownerId: row.ownerId, shareIds };
};

/**
 * « Son agent reçoit la même offre en même temps » — one notice to the venue's agent per match
 * offer: per share when proposed alone, per match and venue when grouped (its earliest share
 * carries the link).
 */
export const runAgentEventOfferNoticeTick = async (now: Date = new Date()): Promise<number> => {
  const rows = await db
    .select({
      allocationId: eventAllocations.id,
      notice: eventAllocations.notice,
      createdAt: eventAllocations.createdAt,
      eventId: events.id,
      matchName: events.name,
      screenhostId: eventAllocations.screenhostId,
      agentUserId: agentAffiliations.agentUserId,
      venueName: screenhosts.name,
      campaignId: campaigns.id,
    })
    .from(eventAllocations)
    .innerJoin(
      agentAffiliations,
      and(
        eq(agentAffiliations.screenhostId, eventAllocations.screenhostId),
        inArray(agentAffiliations.status, [...LIVE_AFFILIATION]),
      ),
    )
    .innerJoin(agents, eq(agents.userId, agentAffiliations.agentUserId))
    .innerJoin(campaigns, eq(campaigns.id, eventAllocations.campaignId))
    .innerJoin(events, eq(events.id, campaigns.eventId))
    .innerJoin(screenhosts, eq(screenhosts.id, eventAllocations.screenhostId))
    .where(
      and(
        eq(eventAllocations.statut, 'EN_ATTENTE'),
        inArray(eventAllocations.notice, [...ASKED]),
        notDemoEventAllocationSql(),
        notStoppedCampaignSql(),
        notInArray(agents.accountStatus, ['suspendu', 'cloture']),
        eq(events.annule, false),
        gt(events.endsAt, now),
      ),
    )
    .limit(500);
  // One candidate per offer: a single share, or the earliest share of a grouped match.
  const offers = new Map<string, (typeof rows)[number] & { spots: number }>();
  for (const r of [...rows].sort(
    (x, y) =>
      x.createdAt.getTime() - y.createdAt.getTime() || x.allocationId.localeCompare(y.allocationId),
  )) {
    const key =
      r.notice === 'grouped'
        ? `${r.agentUserId}:${r.eventId}:${r.screenhostId}`
        : `${r.agentUserId}:${r.allocationId}`;
    const known = offers.get(key);
    if (known) known.spots += 1;
    else offers.set(key, { ...r, spots: 1 });
  }
  if (offers.size === 0) return 0;
  const candidates = [...offers.values()];
  const told = await db
    .select({ userId: notifications.userId, link: notifications.link })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, OFFER_NEW_TYPE),
        inArray(
          notifications.link,
          candidates.map((c) => offerLink(c.allocationId)),
        ),
      ),
    );
  const toldKeys = new Set(told.map((t) => `${t.userId}:${t.link}`));
  const fresh = candidates.filter(
    (c) => !toldKeys.has(`${c.agentUserId}:${offerLink(c.allocationId)}`),
  );
  for (const c of fresh) {
    const label = c.spots > 1 ? `${c.matchName} (${c.spots} spots)` : c.matchName;
    await db.insert(notifications).values({
      userId: c.agentUserId,
      type: OFFER_NEW_TYPE,
      ...offerNewNotice(c.venueName, label),
      campaignId: c.campaignId,
      link: offerLink(c.allocationId),
    });
  }
  return fresh.length;
};

/** Every minute, unref'd (next to the classic offer sweep). */
export function startAgentEventOfferNoticeJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runAgentEventOfferNoticeTick().catch((err: unknown) =>
      log.warn({ err }, 'agent match offer notice tick failed'),
    );
  setInterval(tick, 60 * 1000).unref();
}

/** After the HOST's own answer on a match share: its agent (if any) is told he can't act. */
export const noticeHostAnsweredEvent = async (
  allocationId: string,
  accepted: boolean,
): Promise<void> => {
  const [row] = await db
    .select({
      agentUserId: agentAffiliations.agentUserId,
      venueName: screenhosts.name,
      campaignId: campaigns.id,
      matchName: events.name,
    })
    .from(eventAllocations)
    .innerJoin(
      agentAffiliations,
      and(
        eq(agentAffiliations.screenhostId, eventAllocations.screenhostId),
        inArray(agentAffiliations.status, [...LIVE_AFFILIATION]),
      ),
    )
    .innerJoin(agents, eq(agents.userId, agentAffiliations.agentUserId))
    .innerJoin(screenhosts, eq(screenhosts.id, eventAllocations.screenhostId))
    .innerJoin(campaigns, eq(campaigns.id, eventAllocations.campaignId))
    .innerJoin(events, eq(events.id, campaigns.eventId))
    .where(and(eq(eventAllocations.id, allocationId), notDemoEventAllocationSql()))
    .limit(1);
  if (!row) return;
  await db.insert(notifications).values({
    userId: row.agentUserId,
    type: OFFER_HOST_ANSWERED_TYPE,
    ...offerHostAnsweredNotice(accepted, row.venueName, row.matchName),
    campaignId: row.campaignId,
    link: offerLink(allocationId),
  });
};
