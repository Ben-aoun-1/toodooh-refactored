import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, eventAllocations, events, notifications, screenhosts } from '../db/schema.js';

import { notStoppedCampaignSql } from './campaign-stopped.js';
import { notDemoEventAllocationSql } from './demo.js';
import { slotsAddedToAcceptedBody } from './dispatch/tours/placer.js';
import { loadOwnerSharePcts, ownerShareTnd } from './owner-share.js';

// Mariem 05/11/2026 — « Notifications Screenhost pour les soirs de match » (spec + mockup
// Toodooh_Notif_Match_Host): a venue's owner is asked MATCH BY MATCH, never campaign by campaign.
//
//   • a share placed more than 24 h before kick-off waits; 24 h before kick-off the venue's owner
//     gets ONE « Soir de match » notice for that match, listing every waiting share, with the
//     owner's total for the match;
//   • a share placed later is proposed alone, at once, with the per-campaign popup;
//   • a share RE-PLACED (another venue refused) on a venue whose owner already accepted that
//     match airs without a new question, and the owner is told « Bonne nouvelle » (the classic
//     rule of Mariem 13/11, Youssef's wording).
//
// Mariem 15/11/2026 (« toutes les campagnes des matchs sont acceptées automatiquement, sans
// intervention de l'Admin ni du Host, et ce dernier ne reçoit aucune notification »; operator
// « change it as Mariem asked »): no share is ever accepted on the owner's behalf any more,
// whatever its amount — the 20 DT / 10 DT minimums of 05/11 (ruling 1C) are gone. The owner, his
// agent or the Admin (« Réponses des Hosts ») answers; a share still waiting at the end of the
// window never aired and settlement refunds it, as before. 'auto' and 'withheld' rows written
// before 15/11 stay as they are.
//
// Operator 23/11/2026 — a match still « à confirmer » (day or time) is sold, but its owners are
// asked NOTHING while it is: every share waits, whatever the provisional kick-off says, and the
// sweep skips the match. Once the Admin confirms it, the sweep asks 24 h before the real kick-off
// (at once when that is already under 24 h away).
//
// The amounts are the OWNER's share (lib/owner-share), the figure the popup shows (ruling 2A).
// ONE home: every event placement (lib/event-dispatch) and the sweep below go through it.

/** The grouped notice goes out this long before kick-off. */
export const EVENT_NOTICE_LEAD_MS = 24 * 60 * 60 * 1000;
export const EVENT_MATCH_NOTICE_TYPE = 'event_match_pending_acceptance';
export const EVENT_MATCH_NOTICE_TITLE = 'Soir de match en attente de votre réponse';

const tndLabel = (tnd: number): string =>
  `${tnd.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`;

export const eventMatchNoticeBody = (matchName: string, spots: number, totalTnd: number): string =>
  `« ${matchName} » : ${spots} spot${spots > 1 ? 's' : ''} à diffuser, ${tndLabel(totalTnd)} pour ce match.`;

/** Where a venue's owner stands on a match: accepted a share, refused one, or neither. */
export type VenueMatchStance = 'accepted' | 'refused' | 'open';
/** A booking (a positioning or its boost) or a re-placement after another venue's refusal. */
export type ShareOrigin = 'booking' | 'redispatch';
/**
 * What a share gets at its placement; 'wait' = the grouped notice will ask, 'auto' = a
 * re-placement on a venue whose owner accepted the match (« Bonne nouvelle »).
 */
export type PlacementNotice = 'wait' | 'single' | 'auto';

export const groupedNoticeAt = (kickoffAt: Date): Date =>
  new Date(kickoffAt.getTime() - EVENT_NOTICE_LEAD_MS);

/**
 * When the owner was asked about a share: at the match's notice for a grouped one, at placement
 * for a single one; null when never (still waiting, withheld, or accepted on the owner's behalf)
 * — then it is not an offer the owner could answer, late or not.
 */
export const shareAskedAt = (
  share: { notice: string | null; createdAt: Date },
  kickoffAt: Date,
): Date | null => {
  if (share.notice === 'grouped') return groupedNoticeAt(kickoffAt);
  if (share.notice === 'single') return share.createdAt;
  return null;
};

/** A share accepted on the owner's behalf ('auto') says nothing about the owner's stance. */
export const venueMatchStance = (
  shares: readonly { statut: string; notice: string | null }[],
): VenueMatchStance => {
  if (shares.some((s) => s.statut === 'ACCEPTE' && s.notice !== 'auto')) return 'accepted';
  if (shares.some((s) => s.statut === 'REFUSE')) return 'refused';
  return 'open';
};

export const placementNotice = (input: {
  now: Date;
  kickoffAt: Date;
  stance: VenueMatchStance;
  origin: ShareOrigin;
  /** False while the match's day or time is « à confirmer »: nobody is asked yet. */
  confirmed?: boolean;
}): PlacementNotice => {
  if (input.confirmed === false) return 'wait';
  if (input.now.getTime() < groupedNoticeAt(input.kickoffAt).getTime()) return 'wait';
  if (input.origin === 'redispatch' && input.stance === 'accepted') return 'auto';
  return 'single';
};

/** Millime-exact Σ of owner shares. */
const sumTnd = (values: readonly number[]): number =>
  Math.round(values.reduce((sum, v) => sum + v * 1000, 0)) / 1000;

type DbExecutor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/**
 * Each venue's stance on the match, from its OTHER shares (positionings of any advertiser, demo
 * excluded); `skip` leaves out the shares being decided right now.
 */
const stanceByVenue = async (
  executor: DbExecutor,
  eventId: string,
  screenhostIds: readonly string[],
  skip: readonly string[],
): Promise<Map<string, VenueMatchStance>> => {
  if (screenhostIds.length === 0) return new Map();
  const rows = await executor
    .select({
      id: eventAllocations.id,
      screenhostId: eventAllocations.screenhostId,
      statut: eventAllocations.statut,
      notice: eventAllocations.notice,
    })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.eventId, eventId),
        inArray(eventAllocations.screenhostId, [...screenhostIds]),
        notDemoEventAllocationSql(),
      ),
    );
  const skipped = new Set(skip);
  const byVenue = new Map<string, { statut: string; notice: string | null }[]>();
  for (const r of rows) {
    if (skipped.has(r.id)) continue;
    byVenue.set(r.screenhostId, [...(byVenue.get(r.screenhostId) ?? []), r]);
  }
  return new Map(screenhostIds.map((id) => [id, venueMatchStance(byVenue.get(id) ?? [])]));
};

/**
 * The placement hook: every event share written for one positioning on one match goes through
 * here, inside the writer's transaction — it waits for the grouped notice, is proposed alone
 * (one per-campaign notification per owner, as before), is accepted on the owner's behalf, or is
 * withheld.
 */
export const noticeNewEventShares = async (
  executor: DbExecutor,
  input: {
    positioning: { id: string; name: string };
    event: { id: string; kickoffAt: Date };
    shares: readonly {
      allocationId: string;
      screenhostId: string;
      ownerId: string;
      montantTnd: number;
    }[];
    origin: ShareOrigin;
    now?: Date;
  },
): Promise<void> => {
  if (input.shares.length === 0) return;
  const now = input.now ?? new Date();
  const pcts = await loadOwnerSharePcts();
  const [flags] = await executor
    .select({ dateTbc: events.dateTbc, timeTbc: events.timeTbc })
    .from(events)
    .where(eq(events.id, input.event.id))
    .limit(1);
  const confirmed = flags === undefined || !(flags.dateTbc || flags.timeTbc);
  const stances = await stanceByVenue(
    executor,
    input.event.id,
    [...new Set(input.shares.map((s) => s.screenhostId))],
    input.shares.map((s) => s.allocationId),
  );
  const proposedTo = new Set<string>();
  // « Bonne nouvelle »: the owner's added earnings, summed per owner for this positioning.
  const addedFor = new Map<string, number>();
  for (const share of input.shares) {
    const notice = placementNotice({
      now,
      kickoffAt: input.event.kickoffAt,
      stance: stances.get(share.screenhostId) ?? 'open',
      origin: input.origin,
      confirmed,
    });
    if (notice === 'wait') continue;
    await executor
      .update(eventAllocations)
      .set(notice === 'auto' ? { notice, statut: 'ACCEPTE', decidedAt: now } : { notice })
      .where(eq(eventAllocations.id, share.allocationId));
    if (notice === 'single') proposedTo.add(share.ownerId);
    else {
      const added = ownerShareTnd(share.montantTnd, pcts);
      addedFor.set(share.ownerId, sumTnd([addedFor.get(share.ownerId) ?? 0, added]));
    }
  }
  const rows = [
    ...[...proposedTo].map((ownerId) => ({
      userId: ownerId,
      type: 'dispatch_pending_acceptance',
      title: EVENT_PROPOSAL_TITLE,
      body: eventProposalBody(input.positioning.name),
      campaignId: input.positioning.id,
    })),
    ...[...addedFor].map(([ownerId, added]) => ({
      userId: ownerId,
      type: 'dispatch_slots_added',
      title: 'Bonne nouvelle !',
      body: slotsAddedToAcceptedBody(added),
      campaignId: input.positioning.id,
    })),
  ];
  if (rows.length > 0) await executor.insert(notifications).values(rows);
};

// §11.1 — the per-campaign proposal copy (French, ONE home; re-exported by lib/event-dispatch).
export const EVENT_PROPOSAL_TITLE = 'Événement en attente de votre acceptation';
export const eventProposalBody = (matchName: string): string =>
  `Le positionnement « ${matchName} » attend votre acceptation.`;

export interface GroupedNoticeOutcome {
  eventId: string;
  screenhostId: string;
  shares: number;
  totalOwnerShareTnd: number;
}

/**
 * The sweep: for every CONFIRMED match whose notice time has come and which has not ended, each venue's
 * waiting shares are asked together — one « Soir de match » notice to the owner, whatever the
 * total (Mariem 15/11). Each venue is handled in its own transaction, its waiting rows
 * locked and re-read, so two sweeps never notify twice.
 */
export const runEventGroupedNotices = async (
  now: Date = new Date(),
  log?: FastifyBaseLogger,
): Promise<GroupedNoticeOutcome[]> => {
  const due = await db
    .selectDistinct({ eventId: events.id, screenhostId: eventAllocations.screenhostId })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .where(
      and(
        eq(eventAllocations.statut, 'EN_ATTENTE'),
        isNull(eventAllocations.notice),
        notDemoEventAllocationSql(),
        notStoppedCampaignSql(),
        eq(events.annule, false),
        // A provisional kick-off asks nobody: the match is confirmed first.
        eq(events.dateTbc, false),
        eq(events.timeTbc, false),
        lte(events.kickoffAt, new Date(now.getTime() + EVENT_NOTICE_LEAD_MS)),
        gt(events.endsAt, now),
      ),
    );
  if (due.length === 0) return [];
  const pcts = await loadOwnerSharePcts();
  const outcomes: GroupedNoticeOutcome[] = [];
  for (const { eventId, screenhostId } of due) {
    const outcome = await db.transaction(async (tx): Promise<GroupedNoticeOutcome | null> => {
      const waiting = await tx
        .select({
          id: eventAllocations.id,
          montantTnd: eventAllocations.montantTnd,
          ownerId: screenhosts.ownerId,
          matchName: events.name,
        })
        .from(eventAllocations)
        .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
        .innerJoin(events, eq(campaigns.eventId, events.id))
        .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
        .where(
          and(
            eq(events.id, eventId),
            eq(eventAllocations.screenhostId, screenhostId),
            eq(eventAllocations.statut, 'EN_ATTENTE'),
            isNull(eventAllocations.notice),
            notDemoEventAllocationSql(),
            notStoppedCampaignSql(),
          ),
        )
        .for('update', { of: eventAllocations, skipLocked: true });
      const first = waiting[0];
      if (!first || first.ownerId === null) return null;
      const ids = waiting.map((w) => w.id);
      const total = sumTnd(waiting.map((w) => ownerShareTnd(Number(w.montantTnd), pcts)));
      await tx
        .update(eventAllocations)
        .set({ notice: 'grouped' })
        .where(inArray(eventAllocations.id, ids));
      await tx.insert(notifications).values({
        userId: first.ownerId,
        type: EVENT_MATCH_NOTICE_TYPE,
        title: EVENT_MATCH_NOTICE_TITLE,
        body: eventMatchNoticeBody(first.matchName, ids.length, total),
        eventId,
        screenhostId,
      });
      return { eventId, screenhostId, shares: ids.length, totalOwnerShareTnd: total };
    });
    if (outcome) outcomes.push(outcome);
  }
  if (outcomes.length > 0) {
    log?.info({ grouped: outcomes.length }, 'match-night notices sent');
  }
  return outcomes;
};

/** Boot + 5-min unref'd interval: a notice lands within 5 minutes of kick-off − 24 h. */
export function startEventHostNoticeJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runEventGroupedNotices(new Date(), log).catch((err: unknown) =>
      log.warn({ err }, 'match-night notice sweep failed'),
    );
  tick();
  const timer = setInterval(tick, 5 * 60_000);
  timer.unref();
}

/** Owner-scoped: the venue belongs to this owner. */
export const ownsVenue = async (ownerId: string, screenhostId: string): Promise<boolean> => {
  const [row] = await db
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .where(and(eq(screenhosts.id, screenhostId), eq(screenhosts.ownerId, ownerId)))
    .limit(1);
  return row !== undefined;
};

/** The shares a venue's grouped notice still asks about (the match popup's spots). */
export const pendingGroupedShareIds = async (
  eventId: string,
  screenhostId: string,
): Promise<string[]> => {
  const rows = await db
    .select({ id: eventAllocations.id })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.eventId, eventId),
        eq(eventAllocations.screenhostId, screenhostId),
        eq(eventAllocations.statut, 'EN_ATTENTE'),
        eq(eventAllocations.notice, 'grouped'),
        notStoppedCampaignSql(),
      ),
    );
  return rows.map((r) => r.id);
};
