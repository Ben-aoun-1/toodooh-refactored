import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaigns,
  creatives,
  eventAllocations,
  events,
  notifications,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { type ApiFixture, parseFixturesResponse } from '../src/lib/api-football/client.js';
import { EXTRA_TIME_MINUTES, PENALTIES_MINUTES, jumpsFor } from '../src/lib/api-football/jumps.js';
import { eventTeams, matchFixture, sameTeam } from '../src/lib/api-football/match.js';
import { type TrackerDeps, trackerTick } from '../src/lib/api-football/tracker.js';
import { extendEventEnd } from '../src/lib/event-playout/extend.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { adminEventsRoutes } from '../src/routes/admin-events.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// EVT-ET1 (operator rulings 2026-10-27) — extra time / penalties move a match's « après » ads:
// automatic fixture matching, FIXED jumps (+35 extra time, +15 penalties, each once), never
// earlier, no notifications, and the admin's « Prolonger » by any 5-minute step. Also pins the
// remap fixes (holds per venue kept for every positioning; REFUSE holds nothing; a date edit
// remaps). API-Football itself is faked — no network.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: 'silent',
} as never;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `et1-${seq}@example.com`,
      contactName: `ET1 ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (): Promise<string> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [sector] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `ET1 Venue ${seq}`,
      ownerId,
      businessSectorId: sector?.id,
      openingHour: 8,
      closingHour: 2,
    })
    .returning();
  await seedInstalledScreen(sh?.id ?? '');
  return sh?.id ?? '';
};

// Kick-off 20:00 Tunis, planned end 22:00 → « après » blocs 22:00–23:00.
const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
const ENDS = new Date('2027-06-10T22:00:00+01:00');
const GRID = fenetreDiffusion(KICKOFF, ENDS);

const seedEvent = async (over: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [row] = await db
    .insert(events)
    .values({
      name: 'Espérance de Tunis - Club Africain',
      type: 'sport',
      category: 'Football',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      ...over,
    })
    .returning();
  return row?.id ?? '';
};

const seedPositioning = async (
  eventId: string,
  venueId: string,
  blocIdx: number[],
  statut: 'ACCEPTE' | 'REFUSE' = 'ACCEPTE',
): Promise<string> => {
  const advertiserId = await seedUser();
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/et1/${seq}`,
      durationSeconds: 15,
      validationStatus: 'approved',
      fileHash: `et1-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Positionnement ${seq}`,
      campaignType: 'event',
      status: 'upcoming',
      startDate: '2027-06-10',
      endDate: '2027-06-10',
      requestedBudget: '300.00',
      eventId,
      creativeId: creative?.id,
    })
    .returning();
  const blocs = blocIdx.map((i) => ({
    start: GRID.blocs[i]?.start.toISOString() ?? '',
    end: GRID.blocs[i]?.end.toISOString() ?? '',
    impressions: 1000,
  }));
  await db.insert(eventAllocations).values({
    campaignId: campaign?.id ?? '',
    screenhostId: venueId,
    blocs,
    impressionsTotal: blocs.length * 1000,
    montantTnd: '100.000',
    statut,
    decidedAt: new Date(),
  });
  return campaign?.id ?? '';
};

const blocStarts = async (campaignId: string): Promise<string[]> => {
  const [row] = await db
    .select({ blocs: eventAllocations.blocs })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, campaignId));
  return (row?.blocs as { start: string }[]).map((b) => b.start);
};

const heldHours = async (eventId: string, venueId: string): Promise<string[]> => {
  const rows =
    await sql`select day::text || ' ' || hour as cell from hour_reservations where event_id = ${eventId} and screenhost_id = ${venueId} order by day, hour`;
  return rows.map((r) => String(r['cell']));
};

const fixture = (over: Partial<ApiFixture> = {}): ApiFixture => ({
  id: 9001,
  date: '2027-06-10T20:00:00+01:00',
  status: 'NS',
  home: 'Esperance Tunis',
  away: 'Club Africain',
  ...over,
});

describe('EVT-ET1 pure rules', () => {
  it('folds team names: accents, club words, and a shared distinctive word', () => {
    expect(sameTeam('Espérance de Tunis', 'Esperance Tunis')).toBe(true);
    expect(sameTeam('Bayern Munich', 'Bayern München')).toBe(true);
    expect(sameTeam('Paris Saint-Germain', 'Paris Saint Germain')).toBe(true);
    expect(sameTeam('Club Africain', 'CS Sfaxien')).toBe(false);
    expect(sameTeam('FC', 'AC')).toBe(false); // only boilerplate → never a match
  });

  it('takes the teams from the single catalogue match, else from « A - B »; never from an evening', () => {
    expect(eventTeams('X', [{ home: 'Liverpool', away: 'Arsenal' }])).toEqual([
      'Liverpool',
      'Arsenal',
    ]);
    expect(eventTeams('Libye - Tunisie', [])).toEqual(['Libye', 'Tunisie']);
    expect(
      eventTeams('Soirée', [
        { home: 'A', away: 'B' },
        { home: 'C', away: 'D' },
      ]),
    ).toBeNull();
    expect(eventTeams('Soirée Ligue des champions', [])).toBeNull();
  });

  it('matches one fixture on both teams (either order) and the kick-off; ambiguity links nothing', () => {
    const event = {
      teams: ['Club Africain', 'Espérance de Tunis'] as [string, string],
      kickoffAt: KICKOFF,
      timeTbc: false,
    };
    expect(matchFixture(event, [fixture()])?.id).toBe(9001);
    // An hour off → not the same fixture.
    expect(matchFixture(event, [fixture({ date: '2027-06-10T21:30:00+01:00' })])).toBeNull();
    // Kick-off time unconfirmed → the same Tunis day is enough.
    expect(
      matchFixture({ ...event, timeTbc: true }, [fixture({ date: '2027-06-10T17:00:00+01:00' })])
        ?.id,
    ).toBe(9001);
    // Two candidates → none.
    expect(matchFixture(event, [fixture(), fixture({ id: 9002 })])).toBeNull();
  });

  it('fixed jumps: extra time +35, penalties +15, each once — a late first look still counts', () => {
    const none = { extraTime: false, penalties: false };
    expect(jumpsFor('2H', none)).toEqual([]);
    expect(jumpsFor('ET', none)).toEqual([{ reason: 'extra_time', minutes: EXTRA_TIME_MINUTES }]);
    expect(jumpsFor('P', { extraTime: true, penalties: false })).toEqual([
      { reason: 'penalties', minutes: PENALTIES_MINUTES },
    ]);
    expect(jumpsFor('PEN', none).map((j) => j.reason)).toEqual(['extra_time', 'penalties']);
    expect(jumpsFor('AET', { extraTime: true, penalties: false })).toEqual([]);
    expect(jumpsFor('FT', none)).toEqual([]);
  });

  it('reads API-Football answers and surfaces its errors (quota, bad key)', () => {
    expect(
      parseFixturesResponse({
        errors: [],
        response: [
          {
            fixture: { id: 1, date: '2027-06-10T19:00:00+00:00', status: { short: 'ET' } },
            teams: { home: { name: 'A' }, away: { name: 'B' } },
          },
          { fixture: { id: 'x' } },
        ],
      }),
    ).toEqual([{ id: 1, date: '2027-06-10T19:00:00+00:00', status: 'ET', home: 'A', away: 'B' }]);
    expect(() =>
      parseFixturesResponse({ errors: { requests: 'limit reached' }, response: [] }),
    ).toThrow(/limit reached/);
  });
});

describe('EVT-ET1 on the database', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    await sql`delete from events`;
    app = Fastify({ logger: false });
    await app.register(adminEventsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('an extension moves only the « après » blocs and their holds, silently, and counts the minutes', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent();
    const campaignId = await seedPositioning(eventId, venue, [0, 1, 2, 3, 4, 5]);

    const outcome = await extendEventEnd(eventId, 35, 'extra_time', silentLog);
    expect(outcome?.endsAt.toISOString()).toBe(
      new Date(ENDS.getTime() + 35 * 60_000).toISOString(),
    );

    const moved = fenetreDiffusion(KICKOFF, new Date(ENDS.getTime() + 35 * 60_000));
    const starts = await blocStarts(campaignId);
    expect(starts.slice(0, 3)).toEqual(GRID.blocs.slice(0, 3).map((b) => b.start.toISOString()));
    expect(starts.slice(3)).toEqual(moved.blocs.slice(3).map((b) => b.start.toISOString()));
    // 22:35–23:35 now held (hours 22 and 23), the pre-match 19 still held.
    expect(await heldHours(eventId, venue)).toEqual([
      '2027-06-10 19',
      '2027-06-10 22',
      '2027-06-10 23',
    ]);

    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    expect(row?.extensionMinutes).toBe(35);
    expect(row?.extraTimeAppliedAt).not.toBeNull();
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it('remap fix: two positionings at one venue BOTH keep their holds; a refused one holds nothing', async () => {
    const venue = await seedVenue();
    const other = await seedVenue();
    const eventId = await seedEvent();
    await seedPositioning(eventId, venue, [0]); // 19:00
    await seedPositioning(eventId, venue, [5]); // 22:40
    await seedPositioning(eventId, other, [5], 'REFUSE');

    await extendEventEnd(eventId, 60, 'admin', silentLog); // après → 23:00–00:00
    expect(await heldHours(eventId, venue)).toEqual(['2027-06-10 19', '2027-06-10 23']);
    expect(await heldHours(eventId, other)).toEqual([]);
  });

  // The free plan's behaviour (seen on staging): `live=all` lists the matches being played; a
  // finished one leaves it and is read by `id`. The fakes mirror that.
  const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P']);
  const fakeApi = (state: { status: string }) => {
    const calls = { date: 0, live: 0, byId: 0 };
    const deps: TrackerDeps = {
      fixturesOnDate: () => {
        calls.date += 1;
        return Promise.resolve([fixture(), fixture({ id: 77, home: 'Milan', away: 'Inter' })]);
      },
      liveFixtures: () => {
        calls.live += 1;
        return Promise.resolve(LIVE.has(state.status) ? [fixture({ status: state.status })] : []);
      },
      fixtureById: (id) => {
        calls.byId += 1;
        return Promise.resolve(id === 9001 ? fixture({ status: state.status }) : null);
      },
      extend: extendEventEnd,
      pollSeconds: 120,
      linkAttempts: new Map(),
    };
    return { deps, calls };
  };
  const at = (minutesAfterKickoff: number) =>
    new Date(KICKOFF.getTime() + minutesAfterKickoff * 60_000);

  it('the tracker links the fixture, then applies +35 at extra time and +15 at penalties — once each', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent();
    await seedPositioning(eventId, venue, [3, 4, 5]);
    const state = { status: 'NS' };
    const { deps, calls } = fakeApi(state);

    // Two days before: the free plan cannot answer that date yet — no request is spent.
    expect(await trackerTick(new Date(KICKOFF.getTime() - 48 * 3600_000), deps, silentLog)).toEqual(
      {
        linked: 0,
        jumped: 0,
      },
    );
    expect(calls.date).toBe(0);
    // The day before: linked, nothing followed yet.
    expect(await trackerTick(new Date(KICKOFF.getTime() - 24 * 3600_000), deps, silentLog)).toEqual(
      {
        linked: 1,
        jumped: 0,
      },
    );
    // Minute 60: not followed yet (from 85 only), no request spent.
    state.status = '2H';
    await trackerTick(at(60), deps, silentLog);
    expect(calls.live).toBe(0);
    // Minute 110: extra time, seen in the live list → +35.
    state.status = 'ET';
    expect((await trackerTick(at(110), deps, silentLog)).jumped).toBe(1);
    // Minute 113: within the 2-min poll — nothing asked, nothing applied twice.
    expect((await trackerTick(at(111), deps, silentLog)).jumped).toBe(0);
    expect((await trackerTick(at(113), deps, silentLog)).jumped).toBe(0);
    // Minute 145: penalties → +15.
    state.status = 'P';
    expect((await trackerTick(at(145), deps, silentLog)).jumped).toBe(1);
    // Final whistle: off the live list → ONE read by id, final status, then no more requests.
    state.status = 'PEN';
    await trackerTick(at(160), deps, silentLog);
    expect(calls.byId).toBe(1);
    const before = { ...calls };
    await trackerTick(at(170), deps, silentLog);
    expect(calls).toEqual(before);

    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    expect(row?.apiFootballFixtureId).toBe(9001);
    expect(row?.apiFootballStatus).toBe('PEN');
    expect(row?.endsAt.toISOString()).toBe(new Date(ENDS.getTime() + 50 * 60_000).toISOString());
    expect(row?.extensionMinutes).toBe(50);
    expect(calls.date).toBe(1);
  });

  it('a match first seen already finished on penalties gets BOTH jumps (read by id)', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent({ apiFootballFixtureId: 9001 });
    await seedPositioning(eventId, venue, [3]);
    const state = { status: 'PEN' };
    const { deps, calls } = fakeApi(state);
    expect((await trackerTick(at(150), deps, silentLog)).jumped).toBe(2);
    expect(calls).toMatchObject({ live: 1, byId: 1 });
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    expect(row?.extensionMinutes).toBe(50);
  });

  it('a match not live yet (late kick-off) is re-read by id at most every 15 min', async () => {
    const eventId = await seedEvent({ apiFootballFixtureId: 9001 });
    const state = { status: 'NS' };
    const { deps, calls } = fakeApi(state);
    await trackerTick(at(90), deps, silentLog); // first look → by id
    await trackerTick(at(92), deps, silentLog); // 2 min later: live list only
    await trackerTick(at(100), deps, silentLog); // 10 min: still waiting
    expect(calls.byId).toBe(1);
    await trackerTick(at(106), deps, silentLog); // 16 min after the first look → by id again
    expect(calls.byId).toBe(2);
    const [row] = await db.select().from(events).where(eq(events.id, eventId));
    expect(row?.extensionMinutes).toBe(0);
  });

  it('« Prolonger » takes the minutes the admin chose; refuses bad steps, finished and annulé matches', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent();
    const campaignId = await seedPositioning(eventId, venue, [5]);
    mockSession(await seedUser({ role: 'admin' }));
    const prolonger = (id: string, minutes: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/admin/events/${id}/prolonger`,
        payload: { minutes },
      });

    const ok = await prolonger(eventId, 45);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ extension_minutes: 45, allocations_recalculees: 1 });
    const later = fenetreDiffusion(KICKOFF, new Date(ENDS.getTime() + 45 * 60_000));
    expect(await blocStarts(campaignId)).toEqual([later.blocs[5]?.start.toISOString()]);

    for (const bad of [0, 7, 185, 'x'])
      expect((await prolonger(eventId, bad)).statusCode).toBe(400);

    const past = await seedEvent({
      kickoffAt: new Date('2020-01-01T20:00:00Z'),
      endsAt: new Date('2020-01-01T22:00:00Z'),
    });
    expect((await prolonger(past, 30)).statusCode).toBe(409);
    const cancelled = await seedEvent({ annule: true });
    expect((await prolonger(cancelled, 30)).statusCode).toBe(409);
  });

  it('editing the end time in the event form now moves the « après » blocs too', async () => {
    const venue = await seedVenue();
    const eventId = await seedEvent();
    const campaignId = await seedPositioning(eventId, venue, [3]);
    mockSession(await seedUser({ role: 'admin' }));
    const newEnd = new Date(ENDS.getTime() + 20 * 60_000);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/events/${eventId}`,
      payload: { ends_at: newEnd.toISOString() },
    });
    expect(res.statusCode).toBe(200);
    expect(await blocStarts(campaignId)).toEqual([
      fenetreDiffusion(KICKOFF, newEnd).blocs[3]?.start.toISOString(),
    ]);
  });
});
