import { eq, inArray } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaigns,
  creatives,
  eventAllocations,
  events,
  notifications,
  screenhosts,
  users,
} from '../src/db/schema.js';
import {
  EVENT_GROUPED_NOTICE_MIN_TND,
  EVENT_MATCH_NOTICE_TYPE,
  EVENT_NOTICE_LEAD_MS,
  EVENT_PROPOSAL_TITLE,
  EVENT_SINGLE_NOTICE_MIN_TND,
  eventMatchNoticeBody,
  groupedNotice,
  groupedNoticeAt,
  noticeNewEventShares,
  placementNotice,
  runEventGroupedNotices,
  shareAskedAt,
  venueMatchStance,
} from '../src/lib/event-host-notice.js';
import { loadOwnerSharePcts, ownerShareTnd } from '../src/lib/owner-share.js';
import { notificationsRoutes } from '../src/routes/notifications.js';
import { screenhostEventMatchRoutes } from '../src/routes/screenhost-event-matches.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Mariem 05/11/2026 — « Notifications Screenhost pour les soirs de match » (lib/event-host-notice):
// a venue's owner is asked match by match — one « Soir de match » notice 24 h before kick-off
// (≥ 20 DT of the owner's share), a late share alone (≥ 10 DT), under the minimum accepted on the
// owner's behalf unless the owner refused the match (operator ruling 1C), and a re-placement on a
// venue that accepted the match airs without a new question.

const KICKOFF = new Date('2027-09-15T20:00:00+01:00');
const ENDS = new Date('2027-09-15T22:00:00+01:00');
const EARLY = new Date(KICKOFF.getTime() - 3 * 24 * 60 * 60 * 1000);
const LATE = new Date(KICKOFF.getTime() - 2 * 60 * 60 * 1000);
const NOTICE_TIME = new Date(KICKOFF.getTime() - EVENT_NOTICE_LEAD_MS + 60_000);

describe('the match-night notice rules (pure)', () => {
  it('a share placed more than 24 h before kick-off waits for the grouped notice', () => {
    expect(groupedNoticeAt(KICKOFF).getTime()).toBe(KICKOFF.getTime() - EVENT_NOTICE_LEAD_MS);
    for (const origin of ['booking', 'redispatch'] as const) {
      for (const stance of ['open', 'accepted', 'refused'] as const) {
        expect(
          placementNotice({ now: EARLY, kickoffAt: KICKOFF, ownerShareTnd: 500, stance, origin }),
        ).toBe('wait');
      }
    }
    // From the notice time on, a share is late.
    expect(
      placementNotice({
        now: groupedNoticeAt(KICKOFF),
        kickoffAt: KICKOFF,
        ownerShareTnd: 50,
        stance: 'open',
        origin: 'booking',
      }),
    ).toBe('single');
  });

  it('a late share is proposed alone from 10 DT; under it, accepted for the owner unless refused', () => {
    const late = (ownerShareTnd: number, stance: 'open' | 'accepted' | 'refused') =>
      placementNotice({ now: LATE, kickoffAt: KICKOFF, ownerShareTnd, stance, origin: 'booking' });
    expect(late(EVENT_SINGLE_NOTICE_MIN_TND, 'open')).toBe('single');
    expect(late(EVENT_SINGLE_NOTICE_MIN_TND, 'refused')).toBe('single');
    expect(late(EVENT_SINGLE_NOTICE_MIN_TND, 'accepted')).toBe('single');
    expect(late(9.999, 'open')).toBe('auto');
    expect(late(9.999, 'accepted')).toBe('auto');
    expect(late(9.999, 'refused')).toBe('withheld');
  });

  it('a late re-placement on a venue that accepted the match airs without a question (ruling 1C)', () => {
    const redispatch = (ownerShareTnd: number, stance: 'open' | 'accepted' | 'refused') =>
      placementNotice({
        now: LATE,
        kickoffAt: KICKOFF,
        ownerShareTnd,
        stance,
        origin: 'redispatch',
      });
    expect(redispatch(80, 'accepted')).toBe('auto');
    expect(redispatch(80, 'open')).toBe('single');
    expect(redispatch(80, 'refused')).toBe('single');
    expect(redispatch(5, 'refused')).toBe('withheld');
  });

  it('the grouped notice goes out from 20 DT; under it, accepted for the owner unless refused', () => {
    expect(
      groupedNotice({ totalOwnerShareTnd: EVENT_GROUPED_NOTICE_MIN_TND, stance: 'open' }),
    ).toBe('grouped');
    expect(groupedNotice({ totalOwnerShareTnd: 19.999, stance: 'open' })).toBe('auto');
    expect(groupedNotice({ totalOwnerShareTnd: 19.999, stance: 'accepted' })).toBe('auto');
    expect(groupedNotice({ totalOwnerShareTnd: 19.999, stance: 'refused' })).toBe('withheld');
    expect(groupedNotice({ totalOwnerShareTnd: 64.8, stance: 'refused' })).toBe('grouped');
  });

  it('only an owner’s own answer sets their stance on a match', () => {
    expect(venueMatchStance([])).toBe('open');
    expect(venueMatchStance([{ statut: 'ACCEPTE', notice: 'auto' }])).toBe('open');
    expect(venueMatchStance([{ statut: 'ACCEPTE', notice: 'grouped' }])).toBe('accepted');
    expect(venueMatchStance([{ statut: 'ACCEPTE', notice: 'single' }])).toBe('accepted');
    expect(venueMatchStance([{ statut: 'REFUSE', notice: 'single' }])).toBe('refused');
    expect(
      venueMatchStance([
        { statut: 'REFUSE', notice: 'single' },
        { statut: 'ACCEPTE', notice: 'single' },
      ]),
    ).toBe('accepted');
    expect(venueMatchStance([{ statut: 'EN_ATTENTE', notice: null }])).toBe('open');
  });

  it('a share was asked about at the match notice (grouped) or at its placement (single), else never', () => {
    const createdAt = new Date('2027-09-01T10:00:00Z');
    expect(shareAskedAt({ notice: 'grouped', createdAt }, KICKOFF)).toEqual(
      groupedNoticeAt(KICKOFF),
    );
    expect(shareAskedAt({ notice: 'single', createdAt }, KICKOFF)).toEqual(createdAt);
    for (const notice of [null, 'auto', 'withheld']) {
      expect(shareAskedAt({ notice, createdAt }, KICKOFF)).toBeNull();
    }
  });

  it('the notice speaks of the match, its spots and the owner’s total', () => {
    expect(eventMatchNoticeBody('Arsenal - Manchester City', 3, 64.8)).toBe(
      '« Arsenal - Manchester City » : 3 spots à diffuser, 64,800 TND pour ce match.',
    );
    expect(eventMatchNoticeBody('Arsenal - Manchester City', 1, 21.6)).toBe(
      '« Arsenal - Manchester City » : 1 spot à diffuser, 21,600 TND pour ce match.',
    );
  });
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'individual_owner', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `notice-${seq}-${Math.random().toString(16).slice(2, 8)}@example.com`,
      contactName: `Notice User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (ownerId?: string): Promise<{ id: string; ownerId: string }> => {
  const owner = ownerId ?? (await seedUser({ role: 'individual_owner' }));
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `Notice Venue ${seq}`, ownerId: owner })
    .returning();
  return { id: sh?.id ?? '', ownerId: owner };
};

const seedMatch = async (over: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: `Équipe A${seq} - Équipe B${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      ...over,
    })
    .returning();
  return row?.id ?? '';
};

/** A launched positioning on the match (its advertiser demo or not). */
const seedPositioning = async (eventId: string, opts: { demo?: boolean } = {}) => {
  const advertiserId = await seedUser({ isDemo: opts.demo ?? false });
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/notice/${seq}`,
      title: `Spot ${seq}`,
      originalFilename: `spot-${seq}.mp4`,
      durationSeconds: 20,
      validationStatus: 'approved',
      fileHash: `notice-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Positionnement ${seq}`,
      campaignType: 'event',
      status: 'upcoming',
      startDate: '2027-09-15',
      endDate: '2027-09-15',
      requestedBudget: '200.00',
      eventId,
      creativeId: creative?.id,
    })
    .returning();
  return { id: c?.id ?? '', name: c?.name ?? '' };
};

const seedShare = async (
  campaignId: string,
  screenhostId: string,
  montantTnd: number,
  over: Partial<typeof eventAllocations.$inferInsert> = {},
): Promise<string> => {
  const [row] = await db
    .insert(eventAllocations)
    .values({
      campaignId,
      screenhostId,
      blocs: [
        {
          start: new Date(KICKOFF.getTime() - 60 * 60_000).toISOString(),
          end: new Date(KICKOFF.getTime() - 40 * 60_000).toISOString(),
          impressions: 600,
        },
      ],
      impressionsTotal: 600,
      montantTnd: montantTnd.toFixed(3),
      statut: 'EN_ATTENTE',
      notice: null,
      ...over,
    })
    .returning();
  return row?.id ?? '';
};

const shareOf = async (id: string) => {
  const [row] = await db.select().from(eventAllocations).where(eq(eventAllocations.id, id));
  return row;
};

const notificationsOf = (userId: string) =>
  db.select().from(notifications).where(eq(notifications.userId, userId));

describe('the match-night notices (real Postgres)', () => {
  const buildApp = () => Fastify({ logger: false });
  let app: ReturnType<typeof buildApp>;
  let ownerShare: (montantTnd: number) => number;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.register(screenhostEventMatchRoutes);
    await app.register(notificationsRoutes);
    await app.ready();
    const pcts = await loadOwnerSharePcts();
    ownerShare = (montantTnd) => ownerShareTnd(montantTnd, pcts);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  afterAll(async () => {
    await sql.end();
  });

  // A montant whose OWNER share sits clearly above / below a threshold, whatever the split.
  const montantForShare = (targetTnd: number): number => {
    const perTnd = ownerShare(100) / 100;
    return Math.round((targetTnd / perTnd) * 1000) / 1000;
  };

  describe('at placement (noticeNewEventShares)', () => {
    it('early: the shares wait, no notification', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const p = await seedPositioning(eventId);
      const id = await seedShare(p.id, venue.id, montantForShare(50));
      await noticeNewEventShares(db, {
        positioning: p,
        event: { id: eventId, kickoffAt: KICKOFF },
        shares: [
          {
            allocationId: id,
            screenhostId: venue.id,
            ownerId: venue.ownerId,
            montantTnd: montantForShare(50),
          },
        ],
        origin: 'booking',
        now: EARLY,
      });
      expect((await shareOf(id))?.notice).toBeNull();
      expect(await notificationsOf(venue.ownerId)).toHaveLength(0);
    });

    it('late from 10 DT: proposed alone, at once, with the per-campaign notification', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const p = await seedPositioning(eventId);
      const montant = montantForShare(15);
      const id = await seedShare(p.id, venue.id, montant);
      await noticeNewEventShares(db, {
        positioning: p,
        event: { id: eventId, kickoffAt: KICKOFF },
        shares: [
          { allocationId: id, screenhostId: venue.id, ownerId: venue.ownerId, montantTnd: montant },
        ],
        origin: 'booking',
        now: LATE,
      });
      const share = await shareOf(id);
      expect(share?.notice).toBe('single');
      expect(share?.statut).toBe('EN_ATTENTE');
      const notifs = await notificationsOf(venue.ownerId);
      expect(notifs).toHaveLength(1);
      expect(notifs[0]?.type).toBe('dispatch_pending_acceptance');
      expect(notifs[0]?.title).toBe(EVENT_PROPOSAL_TITLE);
      expect(notifs[0]?.campaignId).toBe(p.id);
    });

    it('late under 10 DT: accepted on the owner’s behalf, no notification (ruling 1C)', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const p = await seedPositioning(eventId);
      const montant = montantForShare(5);
      const id = await seedShare(p.id, venue.id, montant);
      await noticeNewEventShares(db, {
        positioning: p,
        event: { id: eventId, kickoffAt: KICKOFF },
        shares: [
          { allocationId: id, screenhostId: venue.id, ownerId: venue.ownerId, montantTnd: montant },
        ],
        origin: 'booking',
        now: LATE,
      });
      const share = await shareOf(id);
      expect(share?.notice).toBe('auto');
      expect(share?.statut).toBe('ACCEPTE');
      expect(share?.decidedAt).not.toBeNull();
      expect(await notificationsOf(venue.ownerId)).toHaveLength(0);
    });

    it('late under 10 DT on a venue whose owner refused the match: withheld, never accepted', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const refused = await seedPositioning(eventId);
      await seedShare(refused.id, venue.id, 100, { statut: 'REFUSE', notice: 'grouped' });
      const p = await seedPositioning(eventId);
      const montant = montantForShare(5);
      const id = await seedShare(p.id, venue.id, montant);
      await noticeNewEventShares(db, {
        positioning: p,
        event: { id: eventId, kickoffAt: KICKOFF },
        shares: [
          { allocationId: id, screenhostId: venue.id, ownerId: venue.ownerId, montantTnd: montant },
        ],
        origin: 'booking',
        now: LATE,
      });
      const share = await shareOf(id);
      expect(share?.notice).toBe('withheld');
      expect(share?.statut).toBe('EN_ATTENTE');
      expect(await notificationsOf(venue.ownerId)).toHaveLength(0);
    });

    it('a late re-placement on a venue whose owner accepted the match airs without a question', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const accepted = await seedPositioning(eventId);
      await seedShare(accepted.id, venue.id, 100, { statut: 'ACCEPTE', notice: 'grouped' });
      const p = await seedPositioning(eventId);
      const montant = montantForShare(60);
      const id = await seedShare(p.id, venue.id, montant);
      await noticeNewEventShares(db, {
        positioning: p,
        event: { id: eventId, kickoffAt: KICKOFF },
        shares: [
          { allocationId: id, screenhostId: venue.id, ownerId: venue.ownerId, montantTnd: montant },
        ],
        origin: 'redispatch',
        now: LATE,
      });
      const share = await shareOf(id);
      expect(share?.notice).toBe('auto');
      expect(share?.statut).toBe('ACCEPTE');
      expect(await notificationsOf(venue.ownerId)).toHaveLength(0);
    });

    it('a share accepted on the owner’s behalf does not count as the owner accepting the match', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const auto = await seedPositioning(eventId);
      await seedShare(auto.id, venue.id, 5, { statut: 'ACCEPTE', notice: 'auto' });
      const p = await seedPositioning(eventId);
      const montant = montantForShare(60);
      const id = await seedShare(p.id, venue.id, montant);
      await noticeNewEventShares(db, {
        positioning: p,
        event: { id: eventId, kickoffAt: KICKOFF },
        shares: [
          { allocationId: id, screenhostId: venue.id, ownerId: venue.ownerId, montantTnd: montant },
        ],
        origin: 'redispatch',
        now: LATE,
      });
      expect((await shareOf(id))?.notice).toBe('single');
      expect(await notificationsOf(venue.ownerId)).toHaveLength(1);
    });
  });

  describe('24 h before kick-off (runEventGroupedNotices)', () => {
    it('ONE notice per match and venue, for every waiting share, with the owner’s total', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const ids: string[] = [];
      const montants = [montantForShare(12), montantForShare(9), montantForShare(30)];
      for (const montant of montants) {
        const p = await seedPositioning(eventId);
        ids.push(await seedShare(p.id, venue.id, montant));
      }
      // Not yet: one minute before the notice time nothing moves.
      await runEventGroupedNotices(new Date(groupedNoticeAt(KICKOFF).getTime() - 60_000));
      expect(await notificationsOf(venue.ownerId)).toHaveLength(0);

      const outcomes = await runEventGroupedNotices(NOTICE_TIME);
      const mine = outcomes.find((o) => o.eventId === eventId && o.screenhostId === venue.id);
      const total = Math.round(montants.reduce((s, m) => s + ownerShare(m) * 1000, 0)) / 1000;
      expect(mine).toEqual({
        eventId,
        screenhostId: venue.id,
        notice: 'grouped',
        shares: 3,
        totalOwnerShareTnd: total,
      });
      const notifs = await notificationsOf(venue.ownerId);
      expect(notifs).toHaveLength(1);
      expect(notifs[0]?.type).toBe(EVENT_MATCH_NOTICE_TYPE);
      expect(notifs[0]?.eventId).toBe(eventId);
      expect(notifs[0]?.screenhostId).toBe(venue.id);
      expect(notifs[0]?.campaignId).toBeNull();
      const [match] = await db.select().from(events).where(eq(events.id, eventId));
      expect(notifs[0]?.body).toBe(eventMatchNoticeBody(match?.name ?? '', 3, total));
      const rows = await db
        .select()
        .from(eventAllocations)
        .where(inArray(eventAllocations.id, ids));
      expect(rows.every((r) => r.notice === 'grouped' && r.statut === 'EN_ATTENTE')).toBe(true);

      // A second sweep sends nothing more.
      await runEventGroupedNotices(new Date(NOTICE_TIME.getTime() + 5 * 60_000));
      expect(await notificationsOf(venue.ownerId)).toHaveLength(1);
    });

    it('under 20 DT: no notice, the shares are accepted on the owner’s behalf', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const p = await seedPositioning(eventId);
      const id = await seedShare(p.id, venue.id, montantForShare(19));
      await runEventGroupedNotices(NOTICE_TIME);
      const share = await shareOf(id);
      expect(share?.notice).toBe('auto');
      expect(share?.statut).toBe('ACCEPTE');
      expect(await notificationsOf(venue.ownerId)).toHaveLength(0);
    });

    it('under 20 DT on a venue whose owner refused the match: withheld', async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const refused = await seedPositioning(eventId);
      await seedShare(refused.id, venue.id, 100, { statut: 'REFUSE', notice: 'single' });
      const p = await seedPositioning(eventId);
      const id = await seedShare(p.id, venue.id, montantForShare(5));
      await runEventGroupedNotices(NOTICE_TIME);
      const share = await shareOf(id);
      expect(share?.notice).toBe('withheld');
      expect(share?.statut).toBe('EN_ATTENTE');
      expect(await notificationsOf(venue.ownerId)).toHaveLength(0);
    });

    it('each venue of a fleet owner gets its own notice; shares already asked, demo, cancelled or ended matches are left alone', async () => {
      const ownerId = await seedUser({ role: 'individual_owner' });
      const a = await seedVenue(ownerId);
      const b = await seedVenue(ownerId);
      const eventId = await seedMatch();
      const p = await seedPositioning(eventId);
      await seedShare(p.id, a.id, montantForShare(40));
      await seedShare(p.id, b.id, montantForShare(40));
      const single = await seedShare((await seedPositioning(eventId)).id, a.id, 50, {
        notice: 'single',
      });
      const demo = await seedPositioning(eventId, { demo: true });
      const demoShare = await seedShare(demo.id, a.id, 5);
      const cancelled = await seedMatch({ annule: true });
      const cancelledShare = await seedShare((await seedPositioning(cancelled)).id, a.id, 50);
      const ended = await seedMatch({
        kickoffAt: new Date(NOTICE_TIME.getTime() - 4 * 60 * 60_000),
        endsAt: new Date(NOTICE_TIME.getTime() - 2 * 60 * 60_000),
      });
      const endedShare = await seedShare((await seedPositioning(ended)).id, a.id, 50);

      await runEventGroupedNotices(NOTICE_TIME);
      const notifs = (await notificationsOf(ownerId)).filter(
        (n) => n.type === EVENT_MATCH_NOTICE_TYPE,
      );
      expect(notifs.map((n) => n.screenhostId).sort()).toEqual([a.id, b.id].sort());
      expect((await shareOf(single))?.notice).toBe('single');
      expect((await shareOf(demoShare))?.notice).toBeNull();
      expect((await shareOf(cancelledShare))?.notice).toBeNull();
      expect((await shareOf(endedShare))?.notice).toBeNull();
    });
  });

  describe('the owner’s routes', () => {
    /** A venue with two waiting shares, settled by the sweep into one grouped notice. */
    const groupedVenue = async () => {
      const venue = await seedVenue();
      const eventId = await seedMatch();
      const p1 = await seedPositioning(eventId);
      const p2 = await seedPositioning(eventId);
      const s1 = await seedShare(p1.id, venue.id, montantForShare(25));
      const s2 = await seedShare(p2.id, venue.id, montantForShare(25));
      const waiting = await seedShare(
        (
          await seedPositioning(
            await seedMatch({
              kickoffAt: new Date('2028-01-10T20:00:00Z'),
              endsAt: new Date('2028-01-10T22:00:00Z'),
            }),
          )
        ).id,
        venue.id,
        50,
      );
      await runEventGroupedNotices(NOTICE_TIME);
      return { venue, eventId, shares: [s1, s2], waiting, campaigns: [p1.id, p2.id] };
    };

    it('GET event-matches: the match with every spot and the owner’s total; the per-spot list flags them, hides the waiting one', async () => {
      const g = await groupedVenue();
      mockSession(g.venue.ownerId);
      const res = await app.inject({ method: 'GET', url: '/api/screenhosts/event-matches' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        event_id: string;
        screenhost_id: string;
        noticed_at: string;
        total_tnd: number;
        spots: { allocation_id: string; creative: { title: string | null } | null }[];
      }[];
      expect(body).toHaveLength(1);
      expect(body[0]?.event_id).toBe(g.eventId);
      // When the notice went out — the dashboard dates the match row from it.
      expect(body[0]?.noticed_at).toBe(groupedNoticeAt(KICKOFF).toISOString());
      expect(body[0]?.screenhost_id).toBe(g.venue.id);
      expect(body[0]?.spots.map((s) => s.allocation_id).sort()).toEqual([...g.shares].sort());
      expect(body[0]?.spots.every((s) => s.creative?.title?.startsWith('Spot '))).toBe(true);
      expect(body[0]?.total_tnd).toBe(
        Math.round(ownerShare(montantForShare(25)) * 2 * 1000) / 1000,
      );

      const list = await app.inject({ method: 'GET', url: '/api/screenhosts/event-allocations' });
      const rows = list.json() as { id: string; grouped: boolean; event_id: string }[];
      expect(rows.map((r) => r.id).sort()).toEqual([...g.shares].sort());
      expect(rows.every((r) => r.grouped && r.event_id === g.eventId)).toBe(true);
      expect(rows.some((r) => r.id === g.waiting)).toBe(false);

      const feed = await app.inject({ method: 'GET', url: '/api/notifications' });
      const notice = (
        feed.json() as { type: string; event_id: string | null; screenhost_id: string | null }[]
      ).find((n) => n.type === EVENT_MATCH_NOTICE_TYPE);
      expect(notice?.event_id).toBe(g.eventId);
      expect(notice?.screenhost_id).toBe(g.venue.id);
    });

    it('« Accepter le match » accepts every spot at once', async () => {
      const g = await groupedVenue();
      mockSession(g.venue.ownerId);
      const res = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-matches/${g.eventId}/venues/${g.venue.id}/accept`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ statut: 'ACCEPTE', decided: 2 });
      expect((res.json() as { reminder?: string }).reminder).toBeTruthy();
      for (const id of g.shares) expect((await shareOf(id))?.statut).toBe('ACCEPTE');
      expect((await shareOf(g.waiting))?.statut).toBe('EN_ATTENTE');
      // Nothing left to answer: the match leaves the list, a second click decides nothing.
      const after = await app.inject({ method: 'GET', url: '/api/screenhosts/event-matches' });
      expect(after.json()).toEqual([]);
      const again = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-matches/${g.eventId}/venues/${g.venue.id}/accept`,
      });
      expect(again.json()).toMatchObject({ decided: 0 });
    });

    it('« Refuser le match » refuses every spot at once (final)', async () => {
      const g = await groupedVenue();
      mockSession(g.venue.ownerId);
      const res = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-matches/${g.eventId}/venues/${g.venue.id}/refuse`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ statut: 'REFUSE', decided: 2 });
      for (const id of g.shares) expect((await shareOf(id))?.statut).toBe('REFUSE');
    });

    it('another owner’s venue is not found, and decides nothing', async () => {
      const g = await groupedVenue();
      mockSession(await seedUser({ role: 'individual_owner' }));
      const res = await app.inject({
        method: 'POST',
        url: `/api/screenhosts/event-matches/${g.eventId}/venues/${g.venue.id}/accept`,
      });
      expect(res.statusCode).toBe(404);
      for (const id of g.shares) expect((await shareOf(id))?.statut).toBe('EN_ATTENTE');
    });
  });
});
