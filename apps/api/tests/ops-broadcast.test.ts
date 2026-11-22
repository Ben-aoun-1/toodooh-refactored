import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  campaigns,
  creatives,
  eventAllocations,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { handleScreenEvent } from '../src/lib/playout/ingest.js';
import {
  type BroadcastSpot,
  broadcastTimeline,
  clearManualBroadcast,
  currentManualBroadcast,
} from '../src/lib/playout/manual-broadcast.js';
import { computeScreenPlaylist } from '../src/lib/playout/playlist-service.js';
import { internalBroadcastRoutes } from '../src/routes/internal-broadcast.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// OPS-BROADCAST — the operator's own ad page: three stopped positionings' spots, sent on order.

const spot = (id: string, seconds: number): BroadcastSpot => ({
  campaignId: id,
  campaignName: id,
  storageKey: `creatives/${id}`,
  durationSeconds: seconds,
  creativeType: 'video',
});

describe('OPS-BROADCAST — the page timeline (pure)', () => {
  it('lays the spots out like a match page: 2-minute seats, the order given, 6 minutes', () => {
    const start = new Date('2026-11-22T15:30:00Z');
    const t = broadcastTimeline([spot('a', 30), spot('b', 18), spot('c', 20)], start);
    expect(t?.end.toISOString()).toBe('2026-11-22T15:36:00.000Z');
    const count = (id: string) => t?.slots.filter((s) => s.campaignId === id).length;
    // 30 s → 2 plays a minute, 18 s and 20 s → 3: over a 2-minute seat, 4 / 6 / 6.
    expect([count('a'), count('b'), count('c')]).toEqual([4, 6, 6]);
    expect(t?.slots[0]).toMatchObject({ campaignId: 'a', at: start });
    expect(t?.slots.slice(0, 3).map((s) => s.campaignId)).toEqual(['a', 'b', 'c']);
    expect(broadcastTimeline([], start)).toBeNull();
  });
});

describe('OPS-BROADCAST — announce, playlist, trace (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
    clearManualBroadcast();
  });
  afterEach(() => clearManualBroadcast());
  afterAll(async () => {
    await sql.end();
  });

  const world = async () => {
    const [owner] = await db
      .insert(users)
      .values({
        email: 'ops-o@example.com',
        contactName: 'O',
        role: 'individual_owner',
        status: 'approved',
      })
      .returning();
    const [advertiser] = await db
      .insert(users)
      .values({
        email: 'ops-a@example.com',
        contactName: 'A',
        role: 'advertiser',
        status: 'approved',
      })
      .returning();
    const [held] = await db
      .insert(screenhosts)
      .values({ name: 'Held', ownerId: owner?.id ?? '' })
      .returning();
    const [other] = await db
      .insert(screenhosts)
      .values({ name: 'Other', ownerId: owner?.id ?? '' })
      .returning();
    const [screen] = await db
      .insert(screens)
      .values({ screenhostId: held?.id ?? '', name: 'S1' })
      .returning();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser?.id ?? '',
        creativeType: 'video',
        storageKey: 'creatives/ops',
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    // A STOPPED positioning: nothing of it is airable through the commercial gates.
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser?.id ?? '',
        name: 'Stopped spot',
        campaignType: 'event',
        status: 'completed',
        stoppedAt: new Date(),
        startDate: '2026-11-22',
        endDate: '2026-11-22',
        creativeId: creative?.id,
        requestedBudget: '100.00',
      })
      .returning();
    await db.insert(eventAllocations).values({
      campaignId: campaign?.id ?? '',
      screenhostId: held?.id ?? '',
      blocs: [],
      impressionsTotal: 0,
      montantTnd: '0.000',
      statut: 'ACCEPTE',
    });
    return {
      held: held?.id ?? '',
      other: other?.id ?? '',
      screenId: screen?.id ?? '',
      campaignId: campaign?.id ?? '',
    };
  };

  const build = async () => {
    const app = Fastify({ logger: false });
    await app.register(internalBroadcastRoutes);
    await app.ready();
    return app;
  };

  it('answers the machine itself only', async () => {
    const app = await build();
    const outside = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/broadcast',
      remoteAddress: '172.18.0.2',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    expect(outside.statusCode).toBe(404);
    const posted = await app.inject({
      method: 'POST',
      url: '/api/internal/ops/broadcast',
      remoteAddress: '203.0.113.9',
      payload: { campaign_ids: [], starts_in_seconds: 60, scope: 'all' },
    });
    expect(posted.statusCode).toBe(404);
    expect(currentManualBroadcast()).toBeNull();
    expect(
      (await app.inject({ method: 'GET', url: '/api/internal/ops/broadcast' })).statusCode,
    ).toBe(200);
    await app.close();
  });

  it('announces the page to its venues, counts its plays without a proof, and withdraws', async () => {
    const w = await world();
    const app = await build();
    expect((await computeScreenPlaylist(w.held, new Date())).videos).toEqual([]);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/internal/ops/broadcast',
      payload: { campaign_ids: [w.campaignId], starts_in_seconds: 5, scope: 'all' },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/internal/ops/broadcast',
      payload: {
        campaign_ids: ['00000000-0000-4000-8000-000000000000'],
        starts_in_seconds: 60,
        scope: 'all',
      },
    });
    expect(missing.statusCode).toBe(409);

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/ops/broadcast',
      payload: { campaign_ids: [w.campaignId], starts_in_seconds: 60, scope: 'campaign_venues' },
    });
    expect(res.statusCode).toBe(200);
    const b = currentManualBroadcast();
    expect(b?.venueIds).toEqual(new Set([w.held]));

    // The venue's playlist carries the spot at its exact slots; another venue's does not.
    const playlist = await computeScreenPlaylist(w.held, new Date());
    expect(playlist.videos).toHaveLength(1);
    expect(playlist.videos[0]).toMatchObject({ id: w.campaignId, reps_per_hour: 0 });
    expect(playlist.videos[0]?.slots?.[0]?.at).toBe(b?.start.toISOString());
    expect(playlist.videos[0]?.valid_until).toBe(b?.end.toISOString());
    expect(playlist.server_time).toBeDefined();
    expect((await computeScreenPlaylist(w.other, new Date())).videos).toEqual([]);

    // A play of the page is counted, never recorded as a proof (no billing, no payout).
    const outcome = await handleScreenEvent(
      { event: 'VIDEO_STARTED', data: { video_id: w.campaignId, timestamp: b?.start.getTime() } },
      { screenId: w.screenId, screenhostId: w.held },
      app.log,
      b?.start,
    );
    expect(outcome?.status).toBe('rejected');
    expect(await db.select().from(proofOfPlay)).toHaveLength(0);
    const state = (await app.inject({ method: 'GET', url: '/api/internal/ops/broadcast' })).json<{
      plays: { screenId: string; started: number; ended: number }[];
    }>();
    expect(state.plays).toEqual([{ screenId: w.screenId, started: 1, ended: 0 }]);

    // The operator's own list of venues wins over the scope: there and nowhere else.
    const listed = await app.inject({
      method: 'POST',
      url: '/api/internal/ops/broadcast',
      payload: {
        campaign_ids: [w.campaignId],
        starts_in_seconds: 60,
        scope: 'campaign_venues',
        venue_ids: [w.other],
      },
    });
    expect(listed.statusCode).toBe(200);
    expect(currentManualBroadcast()?.venueIds).toEqual(new Set([w.other]));
    expect((await computeScreenPlaylist(w.other, new Date())).videos).toHaveLength(1);
    expect((await computeScreenPlaylist(w.held, new Date())).videos).toEqual([]);
    const b2 = currentManualBroadcast();

    // Once the page has ended it leaves the playlist by itself; DELETE withdraws it at once.
    expect(
      (await computeScreenPlaylist(w.other, new Date((b2?.end.getTime() ?? 0) + 1))).videos,
    ).toEqual([]);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/internal/ops/broadcast' })).statusCode,
    ).toBe(200);
    expect(currentManualBroadcast()).toBeNull();
    expect((await computeScreenPlaylist(w.held, new Date())).videos).toEqual([]);
    await app.close();
  });
});
