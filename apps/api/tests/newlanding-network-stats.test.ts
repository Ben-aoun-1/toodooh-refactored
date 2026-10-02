import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  proofOfPlay,
  screenhostAffluenceHourly,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { resetPublicNetworkStatsCache } from '../src/lib/public-network-stats.js';
import { publicNetworkStatsRoutes } from '../src/routes/public-network-stats.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// NEWLANDING-1 ruling 1A — GET /api/public/network-stats (real Postgres): public, network-wide
// aggregates in the landing script's shape, never a per-venue figure.

const tunisToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());

describe('NEWLANDING-1 — public network stats', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    resetPublicNetworkStatsCache();
    app = Fastify({ logger: false });
    await app.register(publicNetworkStatsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  const get = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/network-stats' });
    expect(res.statusCode).toBe(200);
    return res.json() as Record<string, unknown>;
  };

  it('is public and answers zeros with hidden charts on an empty network', async () => {
    expect(await get()).toEqual({
      venues: 0,
      diffusions: 0,
      hours: 0,
      impressions: 0,
      audience: 0,
      hourly: null,
      gender: null,
      ages: null,
    });
  });

  it('aggregates the network: approved + installed venues only, plays, hours, measured audience', async () => {
    const owner = await seedApprovedOwner();
    const [venue] = await db
      .insert(screenhosts)
      .values({
        name: 'Café Réseau',
        ownerId: owner,
        genderFemalePct: '40',
        genderMalePct: '60',
        age17To30Pct: '50',
        age31To45Pct: '30',
        age46PlusPct: '20',
      })
      .returning();
    const venueId = venue?.id ?? '';
    const screenId = await seedInstalledScreen(venueId);
    // Not on the network: a venue with no installed screen, and one whose owner is pending.
    await db.insert(screenhosts).values({ name: 'Sans écran', ownerId: owner });
    const [pending] = await db
      .insert(users)
      .values({
        email: 'pending-owner@example.com',
        contactName: 'Pending',
        role: 'individual_owner',
        status: 'pending',
      })
      .returning();
    const [pendingVenue] = await db
      .insert(screenhosts)
      .values({ name: 'Proprio en attente', ownerId: pending?.id ?? '' })
      .returning();
    await seedInstalledScreen(pendingVenue?.id ?? '');

    const [creative] = await db
      .insert(creatives)
      .values({ advertiserId: owner, storageKey: 'creatives/x', validationStatus: 'approved' })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({ advertiserId: owner, name: 'C', campaignType: 'standard', status: 'completed' })
      .returning();
    const play = (eventType: 'VIDEO_STARTED' | 'VIDEO_ENDED', ms: number | null) => ({
      screenId,
      screenhostId: venueId,
      campaignId: campaign?.id ?? '',
      creativeId: creative?.id ?? '',
      videoIdAsSent: 'v',
      eventType,
      playedDurationMs: ms,
    });
    await db
      .insert(proofOfPlay)
      .values([
        play('VIDEO_STARTED', null),
        play('VIDEO_ENDED', 1_800_000),
        play('VIDEO_ENDED', 1_800_000),
      ]);

    const [rec] = await db
      .insert(campaignReconciliation)
      .values({
        campaignId: campaign?.id ?? '',
        expectedImp: 500,
        deliveredImp: 420,
        manquementImp: 80,
        pPerteTnd: '0',
        refundTnd: '0',
        spendTnd: '10',
        status: 'partial',
      })
      .returning();
    await db.insert(campaignScreenhostPayout).values({
      reconciliationId: rec?.id ?? '',
      campaignId: campaign?.id ?? '',
      screenhostId: venueId,
      expectedImp: 500,
      deliveredImp: 420,
      earningsTnd: '6.3',
    });

    // Measured audience: 10h halves 20 & 30 → hour 25; 21h halves 40 & 40 → 40. An estimate-only
    // cell (value null) never counts.
    const today = tunisToday();
    await db.insert(screenhostAffluenceHourly).values([
      { screenhostId: venueId, date: today, hour: 10, slot: 20, value: 20 },
      { screenhostId: venueId, date: today, hour: 10, slot: 21, value: 30 },
      { screenhostId: venueId, date: today, hour: 21, slot: 42, value: 40 },
      { screenhostId: venueId, date: today, hour: 21, slot: 43, value: 40 },
      { screenhostId: venueId, date: today, hour: 12, slot: 24, value: null, estimate: 999 },
    ]);

    const body = await get();
    expect(body).toMatchObject({
      venues: 1,
      diffusions: 2,
      hours: 1,
      impressions: 420,
      audience: 65,
      gender: { f: 40, m: 60 },
      ages: { '17–30 ans': 50, '31–45 ans': 30, '46 ans et +': 20 },
    });
    const hourly = body['hourly'] as number[];
    expect(hourly).toHaveLength(16); // 8h → 23h
    expect(hourly[10 - 8]).toBe(25);
    expect(hourly[21 - 8]).toBe(40);
    expect(hourly[12 - 8]).toBe(0);
    // No identifying field ever reaches the public wire.
    expect(JSON.stringify(body)).not.toContain('Café Réseau');
    expect(JSON.stringify(body)).not.toContain(venueId);
  });
});
