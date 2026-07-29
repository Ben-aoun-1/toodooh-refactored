import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  engineEvents,
  proofOfPlay,
  reversementLines,
  screenhostAffluence,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { runRedispatchRound } from '../src/lib/dispatch/redispatch.js';
import { createEngineTrace } from '../src/lib/engine-journal/trace.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import { adminEngineJournalRoutes } from '../src/routes/admin-engine-journal.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// LOG1 — per-phase pins over the REAL engine (real Postgres): the journal records why the engine
// did what it did, and the engine's own outcomes are byte-unchanged (the full pre-LOG1 suite
// passing untouched is the no-op pin; these tests pass a REAL collector explicitly).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string, role = 'admin', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `ej${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// A dispatchable venue: active, capacity, hours 8–20, full-week affluence.
const seedVenue = async (ownerId: string, name: string): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name,
      ownerId,
      openingHour: 8,
      closingHour: 20,
      broadcastCapacity: 10,
    })
    .returning();
  await db.insert(screenhostAffluence).values(
    Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => ({
        screenhostId: sh?.id ?? '',
        dayOfWeek: d + 1,
        hour: h,
        estimatedImpressions: 100,
      })),
    ).flat(),
  );
  return sh?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  dates: { start: string; end: string },
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'LOG1 Campagne',
      campaignType: 'standard',
      status: 'active',
      startDate: dates.start,
      endDate: dates.end,
    })
    .returning();
  return c?.id ?? '';
};

const eventsFor = async (campaignId: string) =>
  db.select().from(engineEvents).where(eq(engineEvents.campaignId, campaignId));

// ONE file-scoped teardown: both describes share the postgres.js connection.
afterAll(async () => {
  await sql.end();
});

describe('LOG1 engine journal — per-phase pins (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a dispatched campaign journals exclusions WITH reasons + placements + the committed run', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const advertiser = await seedUser({ role: 'advertiser' });
    await seedVenue(owner, 'Venue OK');
    // A venue with NO hours — excluded with reason hours_missing.
    const [bare] = await db
      .insert(screenhosts)
      .values({ name: 'Venue sans horaires', ownerId: owner, broadcastCapacity: 5 })
      .returning();
    const campaignId = await seedCampaign(advertiser, { start: '2027-01-04', end: '2027-01-08' });

    const result = await runDispatch(
      { id: campaignId, name: 'LOG1', startDate: '2027-01-04', endDate: '2027-01-08' },
      { iCible: 5000, cpm: 10, s: 10 },
      createEngineTrace('dispatch', campaignId),
    );
    expect(result.status).toBe('OK');

    const rows = await eventsFor(campaignId);
    const run = rows.find((r) => r.eventType === 'run');
    expect(run?.phase).toBe('dispatch');
    expect(run?.outcome).toBe('committed');
    const excluded = rows.filter((r) => r.eventType === 'venue_excluded');
    expect(
      excluded.some((r) => r.screenhostId === bare?.id && r.payload['reason'] === 'hours_missing'),
    ).toBe(true);
    expect(rows.some((r) => r.eventType === 'pool_assembled')).toBe(true);
    const placed = rows.filter((r) => r.eventType === 'allocation_placed');
    expect(placed.length).toBeGreaterThan(0);
    expect(placed[0]?.payload).toHaveProperty('impressions');
    expect(placed[0]?.payload).toHaveProperty('valueTnd');
  });

  it('an empty-pool refusal journals a ROLLED-BACK run with its trace (nothing frozen)', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    // No venues at all → empty pool → NO_ELIGIBLE refusal (CF-HF4 relabel); nothing persists.
    const campaignId = await seedCampaign(advertiser, { start: '2027-01-04', end: '2027-01-08' });
    const result = await runDispatch(
      { id: campaignId, name: 'LOG1', startDate: '2027-01-04', endDate: '2027-01-08' },
      { iCible: 5000, cpm: 10, s: 10 },
      createEngineTrace('dispatch', campaignId),
    );
    expect(result.status).toBe('NO_ELIGIBLE');

    const [plan] = await db
      .select()
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    expect(plan).toBeUndefined(); // the engine froze nothing — byte-unchanged refusal

    const rows = await eventsFor(campaignId);
    const run = rows.find((r) => r.eventType === 'run');
    expect(run?.outcome).toBe('rolled_back');
    expect(run?.payload).toMatchObject({ reason: 'NO_ELIGIBLE' });
    expect(rows.some((r) => r.eventType === 'pool_assembled')).toBe(true);
  });

  it('a redispatch round journals manquements + rattrapage; a settlement journals the split lines', async () => {
    // Fixture: a frozen plan with an elapsed, undelivered créneau on venue A and a live venue B
    // for the rattrapage; then settle and check the split events match reversement_lines.
    const owner = await seedUser({ role: 'individual_owner' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const shB = await seedVenue(owner, 'Venue B rattrapage');
    const [shA] = await db
      .insert(screenhosts)
      .values({ name: 'Venue A défaillant', ownerId: owner, openingHour: 8, closingHour: 20 })
      .returning();
    const [screenA] = await db
      .insert(screens)
      .values({ screenhostId: shA?.id ?? '', name: 'Écran A' })
      .returning();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: 'log1/spot',
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();

    // Window: yesterday → tomorrow (relative), créneaux yesterday hour 8+9 on A (one delivered).
    const day = (offset: number): string => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const start = day(-1);
    const end = day(2);
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'LOG1 Redisp',
        campaignType: 'standard',
        status: 'active',
        startDate: start,
        endDate: end,
        creativeId: creative?.id,
      })
      .returning();
    const campaignId = c?.id ?? '';
    const creneaux: DispatchCreneau[] = [
      { date: start, hour: 8, reps: 10, impressions: 30000 },
      { date: start, hour: 9, reps: 10, impressions: 30000 },
    ];
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId,
        iCible: 60000,
        cpm: '10',
        sSpotSeconds: 10,
        tTierCoef: '1.0',
        seuilDiffusable: 1000,
        sMin: '10',
        gJour: '3.33',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 60000,
        nMin: 1,
        nMax: 20,
        nRetenus: 1,
      })
      .returning();
    await db.insert(campaignDispatchAllocation).values({
      planId: plan?.id ?? '',
      screenhostId: shA?.id ?? '',
      iiPotentiel: 60000,
      rI: 10,
      revenuPrevisionnel: '600',
      creneaux,
      statutAcceptation: 'ACCEPTE',
    });
    // Deliver hour 8 only (UTC 07:30 = Tunis 08:30); hour 9 stays a manquement.
    await db.insert(proofOfPlay).values({
      screenId: screenA?.id ?? '',
      screenhostId: shA?.id ?? '',
      campaignId,
      creativeId: creative?.id ?? '',
      videoIdAsSent: campaignId,
      eventType: 'VIDEO_ENDED',
      receivedAt: new Date(`${start}T07:30:00Z`),
    });

    const round = await runRedispatchRound(
      { id: campaignId, name: 'LOG1 Redisp', startDate: start, endDate: end },
      new Date(),
      createEngineTrace('redispatch', campaignId),
    );
    expect(['PLACED', 'NOTHING_PLACEABLE']).toContain(round.status);

    const redispRows = (await eventsFor(campaignId)).filter((r) => r.phase === 'redispatch');
    expect(
      redispRows.some(
        (r) => r.eventType === 'manquement_detected' && r.screenhostId === (shA?.id ?? ''),
      ),
    ).toBe(true);
    expect(redispRows.some((r) => r.eventType === 'redispatch_valued')).toBe(true);
    if (round.status === 'PLACED') {
      expect(
        redispRows.some((r) => r.eventType === 'rattrapage_placed' && r.screenhostId === shB),
      ).toBe(true);
    }
    const redispRun = redispRows.find((r) => r.eventType === 'run');
    expect(redispRun?.outcome).toBe('committed');

    // ── settlement: end the campaign, reconcile, and pin the split events vs the ledger.
    await db
      .update(campaigns)
      .set({ endDate: day(-1) })
      .where(eq(campaigns.id, campaignId));
    const admin = await seedUser({ role: 'admin' });
    const settle = await reconcileCampaignById(campaignId, admin);
    expect(settle.status).toBe('OK');

    const settleRows = (await eventsFor(campaignId)).filter((r) => r.phase === 'settlement');
    const splitEvents = settleRows.filter((r) => r.eventType === 'split_recorded');
    const lines = await db
      .select()
      .from(reversementLines)
      .where(eq(reversementLines.campaignId, campaignId));
    expect(splitEvents.length).toBe(lines.length);
    for (const line of lines) {
      const ev = splitEvents.find((e) => e.screenhostId === line.screenhostId);
      expect(ev?.payload).toMatchObject({
        baseTnd: Number(line.baseValueTnd),
        shTnd: Number(line.shAmountTnd),
        toodoohTnd: Number(line.toodoohAmountTnd),
      });
    }
    expect(settleRows.find((r) => r.eventType === 'run')?.outcome).toBe('committed');
  });
});

describe('GET /api/admin/campaigns/:id/engine-journal (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminEngineJournalRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const get = (id: string, qs = '') =>
    app.inject({ method: 'GET', url: `/api/admin/campaigns/${id}/engine-journal${qs}` });
  // (teardown: the file-scoped afterAll above closes the shared connection once)

  const seedRuns = async (): Promise<{ admin: string; campaignId: string; shId: string }> => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: 'Venue Journal', ownerId: owner })
      .returning();
    const campaignId = await seedCampaign(advertiser, { start: '2027-01-04', end: '2027-01-08' });
    const t1 = createEngineTrace('dispatch', campaignId);
    t1.event('venue_excluded', { reason: 'hours_missing' }, sh?.id ?? '');
    t1.event('pool_assembled', { poolSize: 0 });
    await t1.finish('rolled_back', { reason: 'TOO_THIN' });
    const t2 = createEngineTrace('settlement', campaignId);
    t2.event('split_recorded', { baseTnd: 10 }, sh?.id ?? '');
    await t2.finish('committed', { status: 'reussie' });
    return { admin, campaignId, shId: sh?.id ?? '' };
  };

  it('returns runs newest-first with venue-named events in seq order', async () => {
    const s = await seedRuns();
    mockSession(s.admin);
    const res = await get(s.campaignId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_runs).toBe(2);
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0].phase).toBe('settlement'); // newest first
    expect(body.runs[1].phase).toBe('dispatch');
    expect(body.runs[1].outcome).toBe('rolled_back');
    expect(body.runs[1].summary).toMatchObject({ reason: 'TOO_THIN' });
    expect(body.runs[1].events[0]).toMatchObject({
      event_type: 'venue_excluded',
      screenhost_name: 'Venue Journal',
    });
    expect(body.runs[1].events.map((e: { event_type: string }) => e.event_type)).toEqual([
      'venue_excluded',
      'pool_assembled',
    ]);
  });

  it('filters by phase and paginates', async () => {
    const s = await seedRuns();
    mockSession(s.admin);
    const settlementOnly = await get(s.campaignId, '?phase=settlement');
    expect(settlementOnly.json().total_runs).toBe(1);
    expect(settlementOnly.json().runs[0].phase).toBe('settlement');

    const page2 = await get(s.campaignId, '?limit=1&offset=1');
    expect(page2.json().total_runs).toBe(2);
    expect(page2.json().runs).toHaveLength(1);
    expect(page2.json().runs[0].phase).toBe('dispatch');
  });

  it('404s an unknown campaign and 403s a non-admin', async () => {
    const s = await seedRuns();
    mockSession(s.admin);
    expect((await get('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(owner, 'individual_owner');
    expect((await get(s.campaignId)).statusCode).toBe(403);
  });
});
