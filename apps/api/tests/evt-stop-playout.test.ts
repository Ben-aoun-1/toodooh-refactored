import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
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
import { runBlocPushTick } from '../src/lib/event-playout/bloc-pusher.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import { computeScreenPlaylist, resolveAirableVideo } from '../src/lib/playout/playlist-service.js';
import { screenRegistry } from '../src/lib/playout/registry.js';
import { adminEventsRoutes } from '../src/routes/admin-events.js';
import { runPlayout } from '../src/simulator/tick/actors.js';
import { momentOf } from '../src/simulator/tick/clock.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { eventSector } from './helpers/installed-screen-matrix.js';

// EVT-STOP (docs/daily/2026-09-28.md §2, R2/R3) + EVT-PLAY1 (2026-10-08) — from kickoff − 1 h to
// the end + 1 h of a confirmed match, every venue that shows events drops its classic entries
// (only event spots air, where accepted); outside, each classic entry carries the next 48 h of
// windows for an offline player; a classic proof played inside a window is not airable; and a
// window edge re-pushes the whole network.
//
// Clock: relative to the real instant — kickoff = now + 50 min puts the first pre-match bloc at
// [now − 10 min, now + 10 min); kickoff = now + 130 min puts every bloc in the future.

const MIN = 60_000;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `evtstop-play-${seq}@example.com`,
      contactName: `EVTSTOP play ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

/** A venue; by default one that SHOWS events (event switch on, event-eligible sector). */
const seedVenue = async (showsEvents = true): Promise<{ shId: string; screenId: string }> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `EVTSTOP play venue ${seq}`,
      ownerId,
      openingHour: 0,
      closingHour: 23,
      ...(showsEvents ? { businessSectorId: await eventSector(), broadcastCapacity: 1 } : {}),
    })
    .returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'TV', pairedAt: new Date('2024-01-01') })
    .returning();
  return { shId: sh?.id ?? '', screenId: screen?.id ?? '' };
};

const seedCreative = async (advertiserId: string): Promise<string> => {
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/evtstop-play/${seq}-${Math.random()}`,
      durationSeconds: 10,
      validationStatus: 'approved',
    })
    .returning();
  return creative?.id ?? '';
};

/** An active classic campaign with an ACCEPTE allocation at the venue, airable all day. */
const seedClassic = async (shId: string): Promise<string> => {
  const advertiserId = await seedUser();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Classique',
      campaignType: 'standard',
      status: 'active',
      startDate: '2020-01-01',
      endDate: '2999-12-31',
      creativeId: await seedCreative(advertiserId),
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible: 20000,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '0.8',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 20000,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: shId,
    iiPotentiel: 20000,
    rI: 5,
    revenuPrevisionnel: '200',
    creneaux: [],
    statutAcceptation: 'ACCEPTE',
  });
  return campaign?.id ?? '';
};

/** A positioning on an event kicking off at `kickoff`, with ONE allocation at `shId`. */
const seedEvent = async (
  kickoff: Date,
  shId: string,
  status: 'active' | 'pending' = 'active',
): Promise<{ positioningId: string; firstBloc: { start: Date; end: Date } }> => {
  const ends = new Date(kickoff.getTime() + 120 * MIN);
  const grid = fenetreDiffusion(kickoff, ends);
  const [event] = await db
    .insert(events)
    .values({
      name: `EVTSTOP play match ${seq}`,
      type: 'sport',
      kickoffAt: kickoff,
      endsAt: ends,
      source: 'official',
    })
    .returning();
  const advertiserId = await seedUser();
  const day = kickoff.toISOString().slice(0, 10);
  const [positioning] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Positionnement',
      campaignType: 'event',
      status,
      startDate: day,
      endDate: day,
      requestedBudget: '300.00',
      eventId: event?.id,
      creativeId: await seedCreative(advertiserId),
    })
    .returning();
  await db.insert(eventAllocations).values({
    campaignId: positioning?.id ?? '',
    screenhostId: shId,
    blocs: grid.blocs.map((b) => ({
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      impressions: 2000,
    })),
    impressionsTotal: 12000,
    montantTnd: '300.000',
    statut: 'ACCEPTE',
    decidedAt: new Date(),
  });
  const first = grid.blocs[0];
  if (!first) throw new Error('grid');
  return { positioningId: positioning?.id ?? '', firstBloc: first };
};

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

describe('EVT-STOP — playout (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('inside a match window, the venues that show events drop classic; the others keep it', async () => {
    const eventVenue = await seedVenue();
    const otherVenue = await seedVenue();
    const plainVenue = await seedVenue(false);
    const classicAtEvent = await seedClassic(eventVenue.shId);
    const classicElsewhere = await seedClassic(otherVenue.shId);
    const classicPlain = await seedClassic(plainVenue.shId);
    const { positioningId } = await seedEvent(new Date(Date.now() + 50 * MIN), eventVenue.shId);

    const atEvent = await computeScreenPlaylist(eventVenue.shId, new Date());
    expect(atEvent.videos.map((v) => v.id)).toEqual([positioningId]);
    const elsewhere = await computeScreenPlaylist(otherVenue.shId, new Date());
    expect(elsewhere.videos).toEqual([]);
    // A venue that does not show events is not reserved (EVT-PLAY1).
    const plain = await computeScreenPlaylist(plainVenue.shId, new Date());
    expect(plain.videos.map((v) => v.id)).toEqual([classicPlain]);

    // and the proof gate agrees: a classic play inside the window is not airable
    expect(await resolveAirableVideo(otherVenue.shId, classicElsewhere, new Date())).toBeNull();
    expect(await resolveAirableVideo(eventVenue.shId, classicAtEvent, new Date())).toBeNull();
    expect(await resolveAirableVideo(plainVenue.shId, classicPlain, new Date())).not.toBeNull();
  });

  it('EVT-PLAY1 — the match itself is reserved too (no classic between the blocs)', async () => {
    const venue = await seedVenue();
    await seedClassic(venue.shId);
    // Kickoff 30 min ago: the pre-match blocs are over, the match is on.
    await seedEvent(new Date(Date.now() - 30 * MIN), venue.shId);
    expect((await computeScreenPlaylist(venue.shId, new Date())).videos).toEqual([]);
  });

  it('outside any bloc, classic entries air and carry the upcoming windows (offline player)', async () => {
    const venue = await seedVenue();
    const classic = await seedClassic(venue.shId);
    const { firstBloc } = await seedEvent(new Date(Date.now() + 130 * MIN), venue.shId);

    const playlist = await computeScreenPlaylist(venue.shId, new Date());
    const entry = playlist.videos.find((v) => v.id === classic);
    expect(entry).toBeDefined();
    expect(entry?.blackouts?.[0]?.start).toBe(firstBloc.start.toISOString());
    expect(await resolveAirableVideo(venue.shId, classic, new Date())).not.toBeNull();
  });

  it('EVT-PLAY1 — an unsold confirmed match reserves (Q2 A); a provisional one does not', async () => {
    const venue = await seedVenue();
    const classic = await seedClassic(venue.shId);
    await seedEvent(new Date(Date.now() + 50 * MIN), venue.shId, 'pending');
    expect((await computeScreenPlaylist(venue.shId, new Date())).videos).toEqual([]);

    await db.update(events).set({ timeTbc: true });
    const playlist = await computeScreenPlaylist(venue.shId, new Date());
    expect(playlist.videos.map((v) => v.id)).toEqual([classic]);
    expect(playlist.videos[0]).not.toHaveProperty('blackouts');
  });

  it('a blackout edge re-pushes EVERY connected venue, not only the event’s', async () => {
    const eventVenue = await seedVenue();
    const otherVenue = await seedVenue();
    await seedClassic(otherVenue.shId);
    const { firstBloc } = await seedEvent(new Date(Date.now() + 50 * MIN), eventVenue.shId);
    const a = { send: vi.fn() };
    const b = { send: vi.fn() };
    screenRegistry.add(eventVenue.screenId, a as never);
    screenRegistry.add(otherVenue.screenId, b as never);
    try {
      const result = await runBlocPushTick(silentLog, firstBloc.start);
      expect(result.network).toBe(true);
      expect(result.pushed).toBe(2);
      expect(a.send).toHaveBeenCalledTimes(1);
      expect(b.send).toHaveBeenCalledTimes(1);
    } finally {
      screenRegistry.remove(eventVenue.screenId, a as never);
      screenRegistry.remove(otherVenue.screenId, b as never);
    }
  });

  it('annuler a sold event re-pushes every connected venue (its windows are gone)', async () => {
    const eventVenue = await seedVenue();
    const otherVenue = await seedVenue();
    const classic = await seedClassic(otherVenue.shId);
    const { positioningId } = await seedEvent(new Date(Date.now() + 50 * MIN), eventVenue.shId);
    const [row] = await db
      .select({ eventId: campaigns.eventId })
      .from(campaigns)
      .where(eq(campaigns.id, positioningId));
    const adminId = await seedUser({ role: 'admin' });
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: adminId, role: 'admin', status: 'approved' },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);
    const app = Fastify({ logger: false });
    await app.register(adminEventsRoutes);
    await app.ready();
    const b = { send: vi.fn() };
    screenRegistry.add(otherVenue.screenId, b as never);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/events/${row?.eventId}/annuler`,
      });
      expect(res.statusCode).toBe(200);
      expect(b.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(b.send.mock.calls[0]?.[0] as string) as {
        data: { videos: { id: string }[] };
      };
      expect(sent.data.videos.map((v) => v.id)).toEqual([classic]); // classic back on air
    } finally {
      screenRegistry.remove(otherVenue.screenId, b as never);
      await app.close();
      vi.restoreAllMocks();
    }
  });

  it('SIM — the simulator never writes a classic proof inside a match window (S7)', async () => {
    const venue = await seedVenue();
    const classic = await seedClassic(venue.shId);
    // A past hour H; the classic créneau plans 6 reps in H.
    const hourStart = new Date(Math.floor((Date.now() - 3 * 60 * MIN) / (60 * MIN)) * 60 * MIN);
    const moment = momentOf(hourStart);
    await db
      .update(campaignDispatchAllocation)
      .set({ creneaux: [{ date: moment.date, hour: moment.hour, reps: 6, impressions: 600 }] })
      .where(eq(campaignDispatchAllocation.screenhostId, venue.shId));
    // Kickoff 80 min into H: the window opens at H + 20 min.
    await seedEvent(new Date(hourStart.getTime() + 80 * MIN), venue.shId);

    const result = await runPlayout({
      moment,
      onlineByVenue: new Map([[venue.shId, [venue.screenId]]]),
    });
    // 6 reps at minutes 0, 10, 20, 30, 40, 50 → only the two before H + 20 air.
    expect(result.proofs).toBe(2);
    const proofs = await db
      .select({ at: proofOfPlay.eventTs })
      .from(proofOfPlay)
      .where(eq(proofOfPlay.campaignId, classic));
    expect(proofs.every((p) => (p.at?.getTime() ?? 0) < hourStart.getTime() + 20 * MIN)).toBe(true);
  });
});
