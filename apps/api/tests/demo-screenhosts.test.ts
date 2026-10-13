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
  campaignTargeting,
  campaigns,
  creatives,
  demoScreenhosts,
  dispatchConfig,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays, tunisDateOf } from '../src/lib/campaign-dates.js';
import { randomAffluenceGrid } from '../src/lib/demo-screenhosts.js';
import { poolExclusionReason } from '../src/lib/dispatch/exclusion-reason.js';
import { loadDeliveredSlots } from '../src/lib/reconcile/delivered-slots.js';
import { adminDemoRoutes } from '../src/routes/admin-demo.js';
import { campaignTargetingRoutes } from '../src/routes/campaign-targeting.js';
import { cartRoutes } from '../src/routes/cart.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// DEMO-2 (operator 2026-10-13, rulings A A) — demo screenhosts on a real Postgres: the admin
// creates one (a map point with a random typical week); only a demo screencaster sees it on the
// map and lands on it (Q1 A); its planned créneaux count as aired at settlement (Q2 A); every
// other reader leaves it out.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const mockSession = (userId: string, role = 'advertiser'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `demo2-${seq}@example.com`,
      contactName: `User ${seq}`,
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

const seedRealVenue = async (ownerId: string, sector: string): Promise<string> => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Real ${seq}`,
      ownerId,
      businessSectorId: sector,
      latitude: '36.80000000',
      longitude: '10.18000000',
      openingHour: 0,
      closingHour: 23,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 0; h < 23; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);
  return id;
};

const seedDraft = async (advertiserId: string, sector: string, startDate: string) => {
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/demo2/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: 10,
      validationStatus: 'approved',
      fileHash: `hash-demo2-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Démo 2 campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate,
      endDate: plusCalendarDays(startDate, 3),
      requestedBudget: '100.00',
      creativeId: creative?.id ?? null,
    })
    .returning();
  const id = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId: sector, class: null });
  return id;
};

const buildApp = () => Fastify({ logger: false });

describe('DEMO-2 — demo screenhosts (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(demoScreenhosts);
    await db.update(dispatchConfig).set({ demoDelayMinutes: 5 });
    app = buildApp();
    await app.register(adminDemoRoutes);
    await app.register(cartRoutes);
    await app.register(campaignTargetingRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  /** An admin, one real venue (NOT opened to demos), and a demo screenhost made through the API. */
  const world = async () => {
    const admin = await seedUser({ role: 'admin' });
    const owner = await seedUser({ role: 'individual_owner' });
    const sector = await ownerSectorId();
    const realVenue = await seedRealVenue(owner, sector);
    mockSession(admin, 'admin');
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/demo/screenhosts',
      payload: {
        name: 'Café Démo',
        latitude: 36.81,
        longitude: 10.17,
        city: 'Tunis',
        business_sector_id: sector,
        opening_hour: 0,
        closing_hour: 23,
        audience_min: 80,
        audience_max: 120,
      },
    });
    expect(created.statusCode).toBe(201);
    const demoVenue = created.json<{ id: string }>().id;
    const account = await app.inject({
      method: 'POST',
      url: '/api/admin/demo/accounts',
      payload: {
        email: `prospect2-${seq}@example.com`,
        password: 'demo-password-123',
        business_name: 'Prospect 2',
        balance_tnd: 2000,
      },
    });
    expect(account.statusCode).toBe(201);
    const demo = account.json<{ id: string }>().id;
    vi.restoreAllMocks();
    return { admin, owner, sector, realVenue, demoVenue, demo };
  };

  it('randomAffluenceGrid — every half-hour of every open hour, 7 days, inside [min, max]', () => {
    const grid = randomAffluenceGrid(22, 2, 10, 20, () => 0.999);
    expect(grid).toHaveLength(7 * 4 * 2);
    expect(new Set(grid.map((c) => c.hour))).toEqual(new Set([22, 23, 0, 1]));
    expect(grid.every((c) => c.slot === c.hour * 2 || c.slot === c.hour * 2 + 1)).toBe(true);
    expect(grid.every((c) => c.estimatedImpressions === 20)).toBe(true);
    expect(randomAffluenceGrid(8, 9, 10, 20, () => 0).map((c) => c.estimatedImpressions)).toEqual(
      Array(14).fill(10),
    );
  });

  it('the admin creates a demo screenhost: no owner, no event switch, a random typical week', async () => {
    const w = await world();
    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, w.demoVenue));
    expect(row).toMatchObject({
      demoOnly: true,
      isActive: true,
      ownerId: null,
      broadcastCapacity: null,
      openingHour: 0,
      closingHour: 23,
    });
    const cells = await db
      .select()
      .from(screenhostAffluence)
      .where(eq(screenhostAffluence.screenhostId, w.demoVenue));
    expect(cells).toHaveLength(7 * 23 * 2);
    expect(cells.every((c) => c.estimatedImpressions >= 80 && c.estimatedImpressions <= 120)).toBe(
      true,
    );

    mockSession(w.admin, 'admin');
    const page = (await app.inject({ method: 'GET', url: '/api/admin/demo' })).json<{
      venues: { id: string }[];
      demo_screenhosts: { id: string; name: string }[];
      sectors: { id: string }[];
    }>();
    expect(page.sectors.map((x) => x.id)).toContain(w.sector);
    // The real-venue picker lists only real venues; the demo one has its own list.
    expect(page.venues.map((v) => v.id)).toEqual([w.realVenue]);
    expect(page.demo_screenhosts.map((v) => v.name)).toEqual(['Café Démo']);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/admin/demo/screenhosts',
      payload: {
        name: 'X',
        latitude: 36.8,
        longitude: 10.1,
        opening_hour: 8,
        closing_hour: 8,
        audience_min: 50,
        audience_max: 10,
      },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('Q1 A — only a demo screencaster sees the demo screenhost on the coverage map', async () => {
    const w = await world();
    const start = plusCalendarDays(tunisDateOf(new Date()), 5);
    const realAdvertiser = await seedUser();
    const realDraft = await seedDraft(realAdvertiser, w.sector, start);
    mockSession(realAdvertiser);
    const realMap = (
      await app.inject({ method: 'GET', url: `/api/campaigns/${realDraft}/coverage` })
    ).json<{ screenhosts: { id: string }[] }>();
    expect(realMap.screenhosts.map((s) => s.id)).toEqual([w.realVenue]);
    vi.restoreAllMocks();

    const demoDraft = await seedDraft(w.demo, w.sector, start);
    mockSession(w.demo);
    const demoMap = (
      await app.inject({ method: 'GET', url: `/api/campaigns/${demoDraft}/coverage` })
    ).json<{ screenhosts: { id: string }[] }>();
    // The real venue was not opened to demos: the demo account sees the demo screenhost only.
    expect(demoMap.screenhosts.map((s) => s.id)).toEqual([w.demoVenue]);
  });

  it('a demo campaign lands on the demo screenhost and settles it as aired (Q2 A)', async () => {
    const w = await world();
    const id = await seedDraft(w.demo, w.sector, tunisDateOf(new Date()));
    mockSession(w.demo);
    const add = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: id },
    });
    expect(add.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/cart/confirm' })).statusCode).toBe(200);
    const allocations = await db
      .select({
        screenhostId: campaignDispatchAllocation.screenhostId,
        statut: campaignDispatchAllocation.statutAcceptation,
        creneaux: campaignDispatchAllocation.creneaux,
      })
      .from(campaignDispatchAllocation)
      .innerJoin(
        campaignDispatchPlan,
        eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
      )
      .where(eq(campaignDispatchPlan.campaignId, id));
    expect(allocations.map((a) => [a.screenhostId, a.statut])).toEqual([[w.demoVenue, 'ACCEPTE']]);
    const planned = new Set((allocations[0]?.creneaux ?? []).map((c) => `${c.date}|${c.hour}`));
    expect(planned.size).toBeGreaterThan(0);
    const delivered = await loadDeliveredSlots(id);
    expect(delivered.get(w.demoVenue)?.size).toBe(planned.size);
  });

  it('a real campaign never places on a demo screenhost', () => {
    const venue = {
      id: 'v',
      ownerApproved: false,
      installedScreen: false,
      businessSectorId: null,
      class: null,
      zoneId: null,
      openingHour: 8,
      closingHour: 20,
      demoOnly: true,
    };
    const ctx = { lines: [], zoneIds: [], excluded: new Set<string>() };
    expect(poolExclusionReason(venue, ctx)).toBe('not_demo_venue');
    expect(poolExclusionReason(venue, { ...ctx, demoVenues: new Set(['v']) })).toBeNull();
  });

  it('removing a demo screenhost deactivates it and drops it from the page', async () => {
    const w = await world();
    mockSession(w.admin, 'admin');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/demo/screenhosts/${w.demoVenue}`,
    });
    expect(res.json()).toEqual({ deleted: w.demoVenue });
    const [row] = await db.select().from(screenhosts).where(eq(screenhosts.id, w.demoVenue));
    expect(row?.isActive).toBe(false);
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/admin/demo/screenhosts/${w.realVenue}`,
    });
    expect(again.statusCode).toBe(404);
    const page = (await app.inject({ method: 'GET', url: '/api/admin/demo' })).json<{
      demo_screenhosts: unknown[];
    }>();
    expect(page.demo_screenhosts).toEqual([]);
  });
});
