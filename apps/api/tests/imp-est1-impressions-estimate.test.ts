import { eq, sql as dsql } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaigns,
  creatives,
  engineEvents,
  eventAllocations,
  events,
  hourReservations,
  notifications,
  screenhostAffluence,
  screenhostAmax,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { deriveICible } from '../src/lib/activation-service.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { runEventDispatch } from '../src/lib/event-dispatch/dispatch.js';
import { campaignImpressionsEstimateRoutes } from '../src/routes/campaign-impressions-estimate.js';

import { campaignTiersOf } from './helpers/cpm-config.js';
import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// IMP-EST1 (ruled Q1 A · Q2 A · Q3 A) — « Impressions estimées » = a READ-ONLY dry-run of the real
// dispatch: the live semaine type over the campaign's own window, in PHYSICAL impressions
// (Σ créneau.impressions, what « prédites » reads), never ⌊budget × 1000 ÷ CPM⌋.
//
// Hand-computed fixture (defaults: F = 300 s, R_min_efficace = 2, the campaign's CPM 15 and
// t_10s 0.60, S = 10 s → R = min(360, 30) = 30; seuil = ⌈20 000 ÷ 15⌉ = 1 334):
//   one venue open 8–18 (10 hours), the SAME value every hour of a weekday, a DIFFERENT value per
//   weekday — Mon 10 · Tue 20 · Wed 30 · Thu 40 · Fri 500 · Sat 600 · Sun 700.
//   budget 150 TND → I_cible = 10 000 facturable → 16 666.67 physical to air.
// No business_sectors/zones rows are added (the exact-seed-count footgun).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'advertiser'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

const WEEKDAY_AFFLUENCE: Record<number, number> = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 500,
  6: 600,
  7: 700,
};
const OPEN = 8;
const CLOSE = 18; // 10 broadcastable hours

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `impest1-${seq}@example.com`,
      contactName: `IMP-EST1 ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectorId = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return s?.id ?? '';
};

/** An approved owner's venue with an installed screen; `affluence(dow, hour)` fills the grid. */
const seedVenue = async (
  affluence: (dow: number, hour: number) => number,
  opts: { openingHour?: number; closingHour?: number } = {},
): Promise<string> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  const openingHour = opts.openingHour ?? OPEN;
  const closingHour = opts.closingHour ?? CLOSE;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `IMP-EST1 Venue ${seq}-${Math.random().toString(16).slice(2, 6)}`,
      ownerId,
      businessSectorId: await ownerSectorId(),
      class: 'premium',
      openingHour,
      closingHour,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (let dow = 1; dow <= 7; dow += 1)
    for (let h = openingHour; h < closingHour; h += 1)
      rows.push({
        screenhostId: id,
        dayOfWeek: dow,
        hour: h,
        estimatedImpressions: affluence(dow, h),
      });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);
  return id;
};

const seedCreative = async (advertiserId: string, durationSeconds = 10): Promise<string> => {
  seq += 1;
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/impest1/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds,
      validationStatus: 'approved',
    })
    .returning();
  return c?.id ?? '';
};

/** A standard draft at the pinned CPM 15 / T 0.60, targeting the owner sector. */
const seedCampaign = async (
  advertiserId: string,
  over: Partial<typeof campaigns.$inferInsert> = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Estimation',
      campaignType: 'standard',
      status: 'draft',
      startDate: '2027-05-03', // Monday
      endDate: '2027-05-06', // Thursday
      requestedBudget: '150.00',
      standardCpmTnd: '15',
      eventCpmTnd: '15',
      t10s: '0.60',
      t20s: '0.70',
      t30s: '0.80',
      creativeId: await seedCreative(advertiserId),
      ...over,
    })
    .returning();
  const id = c?.id ?? '';
  await db
    .insert(campaignTargeting)
    .values({ campaignId: id, categoryId: await ownerSectorId(), class: null });
  return id;
};

interface EstimateBody {
  status: string;
  source: string | null;
  impressions: number | null;
  venues_count: number | null;
  days_count: number | null;
}

/** Every table a dispatch (classic or event) writes, plus the A_max ratchet. */
const writeCounts = async (): Promise<Record<string, number>> => {
  const n = async (q: Promise<{ n: number }[]>): Promise<number> => (await q)[0]?.n ?? 0;
  return {
    plans: await n(db.select({ n: dsql<number>`count(*)::int` }).from(campaignDispatchPlan)),
    allocations: await n(
      db.select({ n: dsql<number>`count(*)::int` }).from(campaignDispatchAllocation),
    ),
    eventAllocations: await n(db.select({ n: dsql<number>`count(*)::int` }).from(eventAllocations)),
    reservations: await n(db.select({ n: dsql<number>`count(*)::int` }).from(hourReservations)),
    notifications: await n(db.select({ n: dsql<number>`count(*)::int` }).from(notifications)),
    journal: await n(db.select({ n: dsql<number>`count(*)::int` }).from(engineEvents)),
    amax: await n(db.select({ n: dsql<number>`count(*)::int` }).from(screenhostAmax)),
  };
};

const advisoryLocks = async (): Promise<number> => {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_locks
    where locktype = 'advisory'
      and database = (select oid from pg_database where datname = current_database())`;
  return row?.n ?? 0;
};

describe('IMP-EST1 — GET /api/campaigns/:id/impressions-estimate (real Postgres)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    app = Fastify({ logger: false });
    await app.register(campaignImpressionsEstimateRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const estimate = async (campaignId: string, query = ''): Promise<EstimateBody> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/impressions-estimate${query}`,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as EstimateBody;
  };

  const weekdayVenue = () => seedVenue((dow) => WEEKDAY_AFFLUENCE[dow] ?? 0);

  it('a Monday → Thursday window prices ONLY the Mon–Thu semaine-type cells', async () => {
    await weekdayVenue();
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId);

    // Hi = 4 days × 10 h = 40; ΣAi = 10 × (10+20+30+40) = 1 000 → avg 25.
    // capacité = ⌊25 × 40 × 30 × 0.6⌋ = 18 000 ≥ I_cible 10 000 → one allocation.
    // r_i = ⌊min(30, max(2, 16 666.67 ÷ 1 000))⌋ = 16 → Σ créneaux = 16 × 10 × (10+20+30+40).
    const body = await estimate(campaignId);
    expect(body).toEqual({
      status: 'ok',
      source: 'simulation',
      impressions: 16 * 10 * (10 + 20 + 30 + 40), // 16 000 — no Fri/Sat/Sun cell leaks in
      venues_count: 1,
      days_count: 4,
    });
    // Never the retired CPM formula (⌊150 × 1000 ÷ 15⌋ = 10 000 BILLABLE impressions).
    expect(body.impressions).not.toBe(10_000);
  });

  it('a 10-day window counts the weekdays it holds twice, twice', async () => {
    await weekdayVenue();
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const tenDays = await seedCampaign(advertiserId, {
      startDate: '2027-05-03', // Mon
      endDate: '2027-05-12', // the Wednesday after — Mon, Tue, Wed appear twice
    });
    const oneWeek = await seedCampaign(advertiserId, {
      startDate: '2027-05-03', // Mon
      endDate: '2027-05-09', // Sun
    });

    // Both windows are affluent enough that r_i sits at R_min_efficace = 2
    // (16 666.67 ÷ (ΣAi) < 1), so Σ créneaux = 2 × 10 h × Σ(window's weekday values).
    const week = 10 + 20 + 30 + 40 + 500 + 600 + 700;
    const ten = await estimate(tenDays);
    expect(ten).toMatchObject({ status: 'ok', days_count: 10, venues_count: 1 });
    expect(ten.impressions).toBe(2 * 10 * (week + 10 + 20 + 30));
    const seven = await estimate(oneWeek);
    expect(seven).toMatchObject({ status: 'ok', days_count: 7 });
    expect(seven.impressions).toBe(2 * 10 * week);
    // The three extra days are exactly the second Monday, Tuesday and Wednesday.
    expect((ten.impressions ?? 0) - (seven.impressions ?? 0)).toBe(2 * 10 * (10 + 20 + 30));
  });

  it('the estimate IS « prédites »: equal to Σ créneaux of the plan runDispatch then freezes', async () => {
    // Two venues with non-uniform grids (rounding matters) and a budget one venue can't cover.
    await seedVenue((dow, h) => 40 + ((h * 7 + dow * 3) % 23));
    await seedVenue((dow, h) => 25 + ((h * 5 + dow) % 11));
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId, {
      startDate: '2027-05-03',
      endDate: '2027-05-04',
      requestedBudget: '500.00',
    });

    const before = await estimate(campaignId);
    expect(before.status).toBe('ok');
    expect(before.source).toBe('simulation');
    expect(before.venues_count).toBe(2);

    const iCible = deriveICible(500, 15);
    expect(iCible).not.toBeNull();
    const result = await runDispatch(
      { id: campaignId, name: 'Estimation', startDate: '2027-05-03', endDate: '2027-05-04' },
      { iCible: iCible ?? 0, cpm: 15, s: 10, tiers: await campaignTiersOf(campaignId) },
    );
    expect(result.status).toBe('OK');
    const [plan] = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    const allocations = await db
      .select({ creneaux: campaignDispatchAllocation.creneaux })
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
    const predites = allocations.reduce(
      (sum, a) => sum + a.creneaux.reduce((s, c) => s + c.impressions, 0),
      0,
    );
    expect(allocations).toHaveLength(2);
    expect(before.impressions).toBe(predites);

    // Once dispatched, the estimate reads the real plan — the same number.
    expect(await estimate(campaignId)).toEqual({
      status: 'ok',
      source: 'plan',
      impressions: predites,
      venues_count: 2,
      days_count: 2,
    });
  });

  it('writes NOTHING and holds no lock (row counts before/after)', async () => {
    await weekdayVenue();
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId);

    const before = await writeCounts();
    const body = await estimate(campaignId);
    expect(body.status).toBe('ok');
    expect(await writeCounts()).toEqual(before);
    expect(await advisoryLocks()).toBe(0);
    const [row] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(row?.status).toBe('draft');
  });

  it('budget_tnd sizes the dry-run with the unsaved cursor (the stored budget otherwise)', async () => {
    await weekdayVenue();
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    const campaignId = await seedCampaign(advertiserId);

    // 225 TND → I_cible 15 000 → 25 000 physical ÷ 1 000 → r_i = 25 → 25 × 10 × 100.
    expect((await estimate(campaignId, '?budget_tnd=225')).impressions).toBe(25 * 10 * 100);
    expect((await estimate(campaignId)).impressions).toBe(16 * 10 * 100);
  });

  it('prices at the campaign’s OWN CPM (CPM-1), never the live config', async () => {
    await weekdayVenue();
    const advertiserId = await seedUser();
    mockSession(advertiserId);
    // CPM 30 → I_cible 5 000 → 8 333.33 physical ÷ 1 000 → r_i = 8 → 8 × 10 × 100.
    const campaignId = await seedCampaign(advertiserId, { standardCpmTnd: '30' });
    expect((await estimate(campaignId)).impressions).toBe(8 * 10 * 100);
  });

  it('refusals are statuses, never a number', async () => {
    const advertiserId = await seedUser();
    mockSession(advertiserId);

    const noVenue = await seedCampaign(advertiserId);
    expect(await estimate(noVenue)).toEqual({
      status: 'no_eligible',
      source: null,
      impressions: null,
      venues_count: null,
      days_count: null,
    });

    const noDates = await seedCampaign(advertiserId, { startDate: null, endDate: null });
    expect((await estimate(noDates)).status).toBe('no_dates');
    const noBudget = await seedCampaign(advertiserId, { requestedBudget: null });
    expect((await estimate(noBudget)).status).toBe('no_budget');
    const noCreative = await seedCampaign(advertiserId, { creativeId: null });
    expect((await estimate(noCreative)).status).toBe('no_creative');

    // Too thin: one venue whose whole window is worth 900 facturable (⌊5 × 10 × 30 × 0.6⌋) —
    // N_min = ⌈10 000 ÷ 900⌉ = 12 > N_max = ⌊10 000 ÷ 1 334⌋ = 7.
    await seedVenue(() => 5);
    const thin = await seedCampaign(advertiserId, {
      startDate: '2027-05-03',
      endDate: '2027-05-03',
    });
    expect((await estimate(thin)).status).toBe('too_thin');
  });

  it('ownership: a foreign or missing campaign is 404; a bad id or budget is 400', async () => {
    await weekdayVenue();
    const owner = await seedUser();
    const campaignId = await seedCampaign(owner);
    const stranger = await seedUser();
    mockSession(stranger);

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/impressions-estimate`,
    });
    expect(foreign.statusCode).toBe(404);
    const missing = await app.inject({
      method: 'GET',
      url: '/api/campaigns/00000000-0000-4000-8000-000000000000/impressions-estimate',
    });
    expect(missing.statusCode).toBe(404);
    const badId = await app.inject({
      method: 'GET',
      url: '/api/campaigns/not-a-uuid/impressions-estimate',
    });
    expect(badId.statusCode).toBe(400);

    vi.restoreAllMocks();
    mockSession(owner);
    const badBudget = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaignId}/impressions-estimate?budget_tnd=-5`,
    });
    expect(badBudget.statusCode).toBe(400);
  });

  describe('event positioning — a dry-run of the EVENT dispatch', () => {
    // Kickoff 20:00, ends 22:00 Tunis → the fenêtre 19:00–23:00 on one date; venues open 8–23.
    const KICKOFF = new Date('2027-06-10T20:00:00+01:00');
    const ENDS = new Date('2027-06-10T22:00:00+01:00');

    const seedPositioning = async (advertiserId: string, budget: string) => {
      seq += 1;
      const [ev] = await db
        .insert(events)
        .values({
          name: `IMP-EST1 Match ${seq}`,
          type: 'sport',
          kickoffAt: KICKOFF,
          endsAt: ENDS,
          source: 'official',
        })
        .returning();
      const [c] = await db
        .insert(campaigns)
        .values({
          advertiserId,
          name: `Positionnement ${seq}`,
          campaignType: 'event',
          status: 'draft',
          startDate: '2027-06-10',
          endDate: '2027-06-10',
          requestedBudget: budget,
          standardCpmTnd: '15',
          eventCpmTnd: '15',
          eventId: ev?.id ?? null,
          creativeId: await seedCreative(advertiserId),
        })
        .returning();
      return { campaignId: c?.id ?? '', event: ev };
    };

    it('equals the impressions the event dispatch then places (and reads them once placed)', async () => {
      await seedVenue(() => 100, { openingHour: 8, closingHour: 23 });
      await seedVenue(() => 60, { openingHour: 8, closingHour: 23 });
      const advertiserId = await seedUser();
      mockSession(advertiserId);
      const { campaignId, event } = await seedPositioning(advertiserId, '600.00');

      const before = await estimate(campaignId);
      expect(before).toMatchObject({ status: 'ok', source: 'simulation', days_count: null });

      const outcome = await runEventDispatch(
        { id: campaignId, name: 'Positionnement', advertiserId, requestedBudget: 600 },
        { id: event?.id ?? '', kickoffAt: KICKOFF, endsAt: ENDS },
        15,
      );
      expect(outcome.status).toBe('OK');
      const placed = await db
        .select({ impressions: eventAllocations.impressionsTotal })
        .from(eventAllocations)
        .where(eq(eventAllocations.campaignId, campaignId));
      const total = placed.reduce((s, p) => s + p.impressions, 0);
      expect(total).toBeGreaterThan(0);
      expect(before.impressions).toBe(total);
      expect(before.venues_count).toBe(placed.length);

      expect(await estimate(campaignId)).toMatchObject({
        status: 'ok',
        source: 'plan',
        impressions: total,
        venues_count: placed.length,
      });
    });

    it('places nothing: no allocation, reservation, notification or journal row', async () => {
      await seedVenue(() => 100, { openingHour: 8, closingHour: 23 });
      const advertiserId = await seedUser();
      mockSession(advertiserId);
      const { campaignId } = await seedPositioning(advertiserId, '150.00');

      const before = await writeCounts();
      expect((await estimate(campaignId)).status).toBe('ok');
      const after = await writeCounts();
      // The A_max ratchet is the event pool's own read (the same write GET /:id/cmax makes) —
      // every DISPATCH table stays untouched.
      expect({ ...after, amax: 0 }).toEqual({ ...before, amax: 0 });
      expect(await advisoryLocks()).toBe(0);
    });

    it('a cancelled event or an empty pool is a status, never a number', async () => {
      const advertiserId = await seedUser();
      mockSession(advertiserId);
      const { campaignId, event } = await seedPositioning(advertiserId, '150.00');
      expect((await estimate(campaignId)).status).toBe('no_eligible');

      await db
        .update(events)
        .set({ annule: true })
        .where(eq(events.id, event?.id ?? ''));
      expect((await estimate(campaignId)).status).toBe('event_cancelled');
    });
  });
});
