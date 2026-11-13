import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, eventAllocations, events, notifications, screenhosts } from '../db/schema.js';

import { notStoppedCampaignSql } from './campaign-stopped.js';
import { notDemoEventAllocationSql } from './demo.js';
import { loadOwnerSharePcts, ownerShareTnd } from './owner-share.js';

// Mariem 05/11/2026 — « Notifications Screenhost pour les soirs de match » (spec + mockup
// Toodooh_Notif_Match_Host): a venue's owner is asked MATCH BY MATCH, never campaign by campaign.
//
//   • a share placed more than 24 h before kick-off waits; 24 h before kick-off the venue's owner
//     gets ONE « Soir de match » notice for that match, listing every waiting share, with the
//     owner's total for the match — if that total reaches 20 DT;
//   • a share placed later is proposed alone, at once, with the per-campaign popup — from 10 DT;
//   • under the minimum the owner is not asked: the share airs, accepted on the owner's behalf
//     (operator ruling 1C) — unless the owner refused that match, then it is never asked
//     ('withheld': it never airs, settlement refunds it);
//   • a share RE-PLACED (another venue refused) on a venue whose owner already accepted that
//     match airs without a new question (operator ruling 1C, 2026-11-05).
//
// The amounts are the OWNER's share (lib/owner-share), the figure the popup shows (ruling 2A).
// ONE home: every event placement (lib/event-dispatch) and the sweep below go through it.

/** The grouped notice goes out this long before kick-off. */
export const EVENT_NOTICE_LEAD_MS = 24 * 60 * 60 * 1000;
/** The owner's total for the match below which the grouped notice is not sent. */
export const EVENT_GROUPED_NOTICE_MIN_TND = 20;
/** The owner's share below which a late share is not proposed. */
export const EVENT_SINGLE_NOTICE_MIN_TND = 10;

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
/** What a share gets at its placement; 'wait' = the grouped notice will ask. */
export type PlacementNotice = 'wait' | 'single' | 'auto' | 'withheld';
export type GroupedNotice = 'grouped' | 'auto' | 'withheld';

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
  ownerShareTnd: number;
  stance: VenueMatchStance;
  origin: ShareOrigin;
}): PlacementNotice => {
  if (input.now.getTime() < groupedNoticeAt(input.kickoffAt).getTime()) return 'wait';
  if (input.origin === 'redispatch' && input.stance === 'accepted') return 'auto';
  if (input.ownerShareTnd >= EVENT_SINGLE_NOTICE_MIN_TND) return 'single';
  return input.stance === 'refused' ? 'withheld' : 'auto';
};

export const groupedNotice = (input: {
  totalOwnerShareTnd: number;
  stance: VenueMatchStance;
}): GroupedNotice => {
  if (input.totalOwnerShareTnd >= EVENT_GROUPED_NOTICE_MIN_TND) return 'grouped';
  return input.stance === 'refused' ? 'withheld' : 'auto';
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
  const stances = await stanceByVenue(
    executor,
    input.event.id,
    [...new Set(input.shares.map((s) => s.screenhostId))],
    input.shares.map((s) => s.allocationId),
  );
  const proposedTo = new Set<string>();
  for (const share of input.shares) {
    const notice = placementNotice({
      now,
      kickoffAt: input.event.kickoffAt,
      ownerShareTnd: ownerShareTnd(share.montantTnd, pcts),
      stance: stances.get(share.screenhostId) ?? 'open',
      origin: input.origin,
    });
    if (notice === 'wait') continue;
    await executor
      .update(eventAllocations)
      .set(notice === 'auto' ? { notice, statut: 'ACCEPTE', decidedAt: now } : { notice })
      .where(eq(eventAllocations.id, share.allocationId));
    if (notice === 'single') proposedTo.add(share.ownerId);
  }
  if (proposedTo.size > 0) {
    await executor.insert(notifications).values(
      [...proposedTo].map((ownerId) => ({
        userId: ownerId,
        type: 'dispatch_pending_acceptance',
        title: EVENT_PROPOSAL_TITLE,
        body: eventProposalBody(input.positioning.name),
        campaignId: input.positioning.id,
      })),
    );
  }
};

// §11.1 — the per-campaign proposal copy (French, ONE home; re-exported by lib/event-dispatch).
export const EVENT_PROPOSAL_TITLE = 'Événement en attente de votre acceptation';
export const eventProposalBody = (matchName: string): string =>
  `Le positionnement « ${matchName} » attend votre acceptation.`;

export interface GroupedNoticeOutcome {
  eventId: string;
  screenhostId: string;
  notice: GroupedNotice;
  shares: number;
  totalOwnerShareTnd: number;
}

/**
 * The sweep: for every match whose notice time has come and which has not ended, each venue's
 * waiting shares are settled together — one « Soir de match » notice to the owner, accepted on
 * the owner's behalf, or withheld. Each venue is handled in its own transaction, its waiting rows
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
      const stance =
        (await stanceByVenue(tx, eventId, [screenhostId], ids)).get(screenhostId) ?? 'open';
      const notice = groupedNotice({ totalOwnerShareTnd: total, stance });
      await tx
        .update(eventAllocations)
        .set(notice === 'auto' ? { notice, statut: 'ACCEPTE', decidedAt: now } : { notice })
        .where(inArray(eventAllocations.id, ids));
      if (notice === 'grouped') {
        await tx.insert(notifications).values({
          userId: first.ownerId,
          type: EVENT_MATCH_NOTICE_TYPE,
          title: EVENT_MATCH_NOTICE_TITLE,
          body: eventMatchNoticeBody(first.matchName, ids.length, total),
          eventId,
          screenhostId,
        });
      }
      return { eventId, screenhostId, notice, shares: ids.length, totalOwnerShareTnd: total };
    });
    if (outcome) outcomes.push(outcome);
  }
  if (outcomes.length > 0) {
    log?.info(
      {
        grouped: outcomes.filter((o) => o.notice === 'grouped').length,
        auto: outcomes.filter((o) => o.notice === 'auto').length,
        withheld: outcomes.filter((o) => o.notice === 'withheld').length,
      },
      'match-night notices settled',
    );
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
