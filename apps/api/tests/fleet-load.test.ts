import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  eventAllocations,
  events,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { loadFleet, loadFleetScreen } from '../src/lib/fleet/load.js';
import { adminFleetRoutes } from '../src/routes/admin-fleet.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// FLEET-1 — « Parc d'écrans », real Postgres. now = 10/03 11:30 Tunis (10:30 UTC). Venue A carries
// a tours campaign at 10 h and 11 h (6 passes) and 15 h (3): screen A1 aired at 11:20 (diffuse),
// A2 last aired at 10:05 (muet). Venue B is open 8–22 with nothing planned and its TV silent for
// an hour (hors ligne pendant l'ouverture); venue C has no hours and no plan (hors ligne); a
// screen never connected reads « jamais ».

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

const NOW = new Date('2026-03-10T10:30:00Z');
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);
/** A Tunis wall-clock time on 10/03 (UTC+1). */
const tunis = (hh: number, mm: number) =>
  new Date(`2026-03-10T${String(hh - 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `fleet-${seq}@example.com`,
      contactName: `Fleet ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (name: string, hours?: { opening: number; closing: number }) => {
  const owner = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({ name, ownerId: owner, openingHour: hours?.opening, closingHour: hours?.closing })
    .returning();
  return sh?.id ?? '';
};

const seedScreen = async (venueId: string, name: string, lastSeenAt: Date | null) => {
  const [s] = await db
    .insert(screens)
    .values({ screenhostId: venueId, name, lastSeenAt, pairedAt: lastSeenAt ? ago(10_000) : null })
    .returning();
  return s?.id ?? '';
};

describe('FLEET-1 — the fleet reads (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  const world = async () => {
    const venueA = await seedVenue('Café A');
    const a1 = await seedScreen(venueA, 'A1', ago(0.5));
    const a2 = await seedScreen(venueA, 'A2', ago(0.5));
    const venueB = await seedVenue('Café B', { opening: 8, closing: 22 });
    const b1 = await seedScreen(venueB, 'B1', ago(60));
    const venueC = await seedVenue('Café C');
    const c1 = await seedScreen(venueC, 'C1', ago(60));
    const never = await seedScreen(venueC, 'C2', null);

    const advertiser = await seedUser();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: 'creatives/fleet',
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Alpha',
        campaignType: 'standard',
        status: 'active',
        startDate: '2026-03-09',
        endDate: '2026-03-12',
        creativeId: creative?.id,
        requestedBudget: '100.00',
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: campaign?.id ?? '',
        engine: 'tours',
        iCible: 150,
        cpm: '10',
        sSpotSeconds: 20,
        tTierCoef: '1.0',
        seuilDiffusable: 1000,
        sMin: '10',
        gJour: '3.33',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 150,
        nMin: 1,
        nMax: 20,
        nRetenus: 1,
      })
      .returning();
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: venueA,
      iiPotentiel: 150,
      rI: 6,
      revenuPrevisionnel: '1.5',
      statutAcceptation: 'ACCEPTE',
      creneaux: [
        { date: '2026-03-10', hour: 10, reps: 6, impressions: 60 },
        { date: '2026-03-10', hour: 11, reps: 6, impressions: 60 },
        { date: '2026-03-10', hour: 15, reps: 3, impressions: 30 },
      ],
    });
    const proof = (screenId: string, at: Date) => ({
      screenId,
      screenhostId: venueA,
      campaignId: campaign?.id ?? '',
      creativeId: creative?.id ?? '',
      videoIdAsSent: campaign?.id ?? '',
      eventType: 'VIDEO_STARTED' as const,
      receivedAt: at,
    });
    await db.insert(proofOfPlay).values([
      proof(a1, tunis(10, 10)),
      proof(a1, tunis(10, 40)),
      proof(a1, tunis(11, 20)),
      proof(a2, tunis(10, 5)),
      // Yesterday — not today's count, but the total and the « last pass » know it.
      proof(a1, new Date('2026-03-09T15:00:00Z')),
    ]);
    return { a1, a2, b1, c1, never, campaignId: campaign?.id ?? '' };
  };

  it('every screen with its state now and its day so far', async () => {
    const w = await world();
    const fleet = await loadFleet(NOW);
    const byId = new Map(fleet.map((s) => [s.id, s]));
    expect(byId.get(w.a1)).toMatchObject({
      status: 'diffuse',
      venue: { name: 'Café A' },
      now: { plannedReps: 6, campaigns: [{ id: w.campaignId, name: 'Alpha', reps: 6 }] },
      lastProof: { campaignName: 'Alpha' },
      // planned 6 (10 h) + 6 × 30/60 (11:30) = 9 so far, 15 in the day; 3 aired today.
      today: { plannedTotal: 15, plannedSoFar: 9, aired: 3 },
    });
    expect(byId.get(w.a2)?.status).toBe('muet');
    expect(byId.get(w.b1)).toMatchObject({ status: 'hors_ligne_ouverture', openNow: true });
    expect(byId.get(w.c1)?.status).toBe('hors_ligne');
    expect(byId.get(w.never)?.status).toBe('jamais');
  });

  it('one screen hour by hour and campaign by campaign', async () => {
    const w = await world();
    const d = await loadFleetScreen(w.a1, NOW);
    expect(d?.hours[10]).toMatchObject({ hour: 10, planned: 6, aired: 2, blackoutMinutes: 0 });
    expect(d?.hours[11]).toMatchObject({ planned: 6, aired: 1 });
    expect(d?.hours[15]).toMatchObject({ planned: 3, aired: 0 });
    expect(d?.campaigns).toEqual([
      expect.objectContaining({ id: w.campaignId, plannedToday: 15, airedToday: 3, airedTotal: 4 }),
    ]);
    expect(await loadFleetScreen('00000000-0000-0000-0000-000000000000', NOW)).toBeNull();
  });

  // FLEET-3 — a match 12:00–14:00 Tunis holds the venue from 11:00. A positioning has ONE ad
  // page, opening with the 11:20 bloc: before it the screens wait, during it they must air.
  it('a match: the screens follow the ad pages, not the paused campaigns', async () => {
    const w = await world();
    const [sector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.eventEligible, true))
      .limit(1);
    const [venue] = await db
      .select({ id: screens.screenhostId })
      .from(screens)
      .where(eq(screens.id, w.a1));
    const venueA = venue?.id ?? '';
    await db
      .update(screenhosts)
      .set({ businessSectorId: sector?.id, broadcastCapacity: 4 })
      .where(eq(screenhosts.id, venueA));
    const [ev] = await db
      .insert(events)
      .values({
        name: 'Match',
        type: 'sport',
        kickoffAt: tunis(12, 0),
        endsAt: tunis(14, 0),
        source: 'official',
      })
      .returning();
    const advertiser = await seedUser();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: 'creatives/fleet-event',
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    const [positioning] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Orange match',
        campaignType: 'event',
        status: 'active',
        startDate: '2026-03-10',
        endDate: '2026-03-10',
        requestedBudget: '300.00',
        eventId: ev?.id,
        eventMinutes: 2,
        creativeId: creative?.id,
      })
      .returning();
    const eventId = positioning?.id ?? '';
    await db.insert(eventAllocations).values({
      campaignId: eventId,
      screenhostId: venueA,
      blocs: [
        {
          start: tunis(11, 20).toISOString(),
          end: tunis(11, 40).toISOString(),
          impressions: 2000,
        },
      ],
      impressionsTotal: 2000,
      montantTnd: '30.000',
      statut: 'ACCEPTE',
    });
    const seen = async (at: Date) =>
      db.update(screens).set({ lastSeenAt: at }).where(eq(screens.screenhostId, venueA));

    // 11:10 — the match holds the venue, the page opens at 11:20.
    await seen(tunis(11, 10));
    const before = new Map((await loadFleet(tunis(11, 10))).map((s) => [s.id, s]));
    expect(before.get(w.a1)).toMatchObject({
      status: 'rien_prevu',
      matchNow: true,
      match: { podStart: null, podLive: false, nextPodAt: tunis(11, 20) },
      now: { plannedReps: 0, campaigns: [{ id: eventId, name: 'Orange match' }] },
    });

    // 11:23 — the page is on air: A1 sent a pass at 11:21, A2 none.
    await seen(tunis(11, 23));
    await db.insert(proofOfPlay).values({
      screenId: w.a1,
      screenhostId: venueA,
      campaignId: eventId,
      creativeId: creative?.id ?? '',
      videoIdAsSent: eventId,
      eventType: 'VIDEO_STARTED',
      receivedAt: tunis(11, 21),
    });
    const during = new Map((await loadFleet(tunis(11, 23))).map((s) => [s.id, s]));
    const a1 = during.get(w.a1);
    expect(a1).toMatchObject({
      status: 'diffuse',
      matchNow: true,
      match: { podStart: tunis(11, 20), podLive: true, nextPodAt: null },
      now: { campaigns: [{ id: eventId, name: 'Orange match' }] },
      lastProof: { campaignName: 'Orange match' },
    });
    const passes = a1?.now.plannedReps ?? 0;
    expect(passes).toBeGreaterThan(0);
    expect(during.get(w.a2)?.status).toBe('muet');

    // The day counts the page's passes in the match hour, and no classic pass there.
    const d = await loadFleetScreen(w.a1, tunis(11, 23));
    expect(d?.hours[11]).toMatchObject({ planned: passes, blackoutMinutes: 60 });
    expect(d?.hours[11]?.campaigns.map((c) => c.id)).toEqual([eventId]);
    expect(d?.hours[10]).toMatchObject({ planned: 6 });
    expect(d?.campaigns.find((c) => c.id === eventId)).toMatchObject({
      plannedToday: passes,
      airedToday: 1,
    });
  });

  it('admin only; 400 on a bad id, 404 on an unknown screen', async () => {
    const app = Fastify({ logger: false });
    await app.register(adminFleetRoutes);
    await app.ready();
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(owner, 'individual_owner');
    expect((await app.inject({ method: 'GET', url: '/api/admin/fleet' })).statusCode).toBe(403);
    vi.restoreAllMocks();
    mockSession(await seedUser({ role: 'admin' }));
    const list = await app.inject({ method: 'GET', url: '/api/admin/fleet' });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ screens: unknown[] }>().screens).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/fleet/screens/x' })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/admin/fleet/screens/00000000-0000-0000-0000-000000000000',
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });
});
