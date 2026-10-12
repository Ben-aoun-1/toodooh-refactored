import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignScreenhostPayout,
  campaignTargeting,
  campaigns,
  creatives,
  demoScreenhosts,
  dispatchConfig,
  notifications,
  recharges,
  reversementLines,
  screenhostAffluence,
  screenhosts,
  sessions,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays, tunisDateOf } from '../src/lib/campaign-dates.js';
import { runDemoAirTick } from '../src/lib/demo-air.js';
import { demoAirsAt } from '../src/lib/demo.js';
import { activeAllocationsForScreenhost } from '../src/lib/playout/active-allocations.js';
import { walletSpendable } from '../src/lib/recharges.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import { adminDemoRoutes } from '../src/routes/admin-demo.js';
import { cartRoutes } from '../src/routes/cart.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// The screenhost router imports the wedooh sync — mocked so the test never touches the wire.
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: vi.fn(() => Promise.resolve()) };
});

// DEMO-1 (operator 2026-10-12, rulings A A A A A A) — demo mode end to end on a real Postgres:
// the admin creates a demo screencaster, opens ONE of two real venues to demos and sets the
// delay; the demo confirm launches at once (spot approved, start today allowed), lands ACCEPTE on
// the demo venue only with no owner notice, airs exactly `delay` minutes later, and settles
// without paying the owner. Deleting the account stops its campaigns.

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
      email: `demo${seq}@example.com`,
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

const seedVenue = async (ownerId: string, categoryId: string): Promise<string> => {
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Demo Venue ${seq}`,
      ownerId,
      businessSectorId: categoryId,
      class: 'premium',
      openingHour: 0,
      closingHour: 23,
      broadcastCapacity: 4,
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

/** A complete draft starting TODAY with a PENDING spot (the demo path approves it). */
const seedDraft = async (advertiserId: string, sector: string): Promise<string> => {
  seq += 1;
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/demo/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: 10,
      validationStatus: 'pending',
      fileHash: `hash-demo-${seq}-${Math.random().toString(16).slice(2)}`,
    })
    .returning();
  const today = tunisDateOf(new Date());
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Démo campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate: today,
      endDate: plusCalendarDays(today, 3),
      requestedBudget: '100.00',
      creativeId: creative?.id ?? null,
    })
    .returning();
  const id = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId: sector, class: null });
  return id;
};

const buildApp = () => Fastify({ logger: false });

describe('DEMO-1 — demo mode (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(demoScreenhosts);
    await db.update(dispatchConfig).set({ demoDelayMinutes: 5 });
    app = buildApp();
    await app.register(adminDemoRoutes);
    await app.register(cartRoutes);
    await app.register(screenhostsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  /** Two real venues (one opened to demos), an admin, and a demo account made through the API. */
  const world = async () => {
    const admin = await seedUser({ role: 'admin' });
    const owner = await seedUser({ role: 'individual_owner' });
    const sector = await ownerSectorId();
    const demoVenue = await seedVenue(owner, sector);
    const otherVenue = await seedVenue(owner, sector);
    mockSession(admin, 'admin');
    const venues = await app.inject({
      method: 'PUT',
      url: '/api/admin/demo/venues',
      payload: { screenhost_ids: [demoVenue] },
    });
    expect(venues.statusCode).toBe(200);
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/demo/accounts',
      payload: {
        email: `Prospect${seq}@Example.com`,
        password: 'demo-password-123',
        business_name: 'Prospect SARL',
        balance_tnd: 2000,
      },
    });
    expect(created.statusCode).toBe(201);
    const demo = created.json<{ id: string; balance_tnd: number }>();
    vi.restoreAllMocks();
    return { admin, owner, sector, demoVenue, otherVenue, demo };
  };

  const launch = async (userId: string, campaignId: string) => {
    mockSession(userId);
    const add = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: campaignId },
    });
    expect(add.statusCode).toBe(200);
    return app.inject({ method: 'POST', url: '/api/cart/confirm' });
  };

  it('creates an approved demo screencaster with its pre-filled profile and balance', async () => {
    const w = await world();
    expect(w.demo.balance_tnd).toBe(2000);
    const [u] = await db.select().from(users).where(eq(users.id, w.demo.id));
    expect(u).toMatchObject({
      isDemo: true,
      role: 'advertiser',
      status: 'approved',
      emailVerified: true,
      onboardingCompleted: true,
      businessName: 'Prospect SARL',
      city: 'Tunis',
    });
    expect(u?.email).toBe(u?.email.toLowerCase());
    expect((await walletSpendable(w.demo.id)).spendable_tnd).toBe(2000);
  });

  it('a demo confirm launches today, on the demo venue only, accepted, unannounced, airing after the delay', async () => {
    const w = await world();
    const id = await seedDraft(w.demo.id, w.sector);
    const before = Date.now();
    const res = await launch(w.demo.id, id);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ launched: { id: string }[] }>().launched.map((c) => c.id)).toEqual([id]);

    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(c?.status).toBe('active');
    const airsAt = c?.airsAt?.getTime() ?? 0;
    expect(airsAt).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(airsAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    const [spot] = await db
      .select()
      .from(creatives)
      .where(eq(creatives.id, c?.creativeId ?? ''));
    expect(spot?.validationStatus).toBe('approved');

    const allocations = await db
      .select({
        screenhostId: campaignDispatchAllocation.screenhostId,
        statut: campaignDispatchAllocation.statutAcceptation,
      })
      .from(campaignDispatchAllocation)
      .innerJoin(
        campaignDispatchPlan,
        eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
      )
      .where(eq(campaignDispatchPlan.campaignId, id));
    expect(allocations).toEqual([{ screenhostId: w.demoVenue, statut: 'ACCEPTE' }]);
    const ownerNotices = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, w.owner), eq(notifications.campaignId, id)));
    expect(ownerNotices).toEqual([]);

    // The playout gate holds it back until airs_at, then airs it.
    expect(await activeAllocationsForScreenhost(w.demoVenue, new Date())).toEqual([]);
    const onAir = await activeAllocationsForScreenhost(w.demoVenue, new Date(airsAt + 1000));
    expect(onAir.map((a) => a.campaignId)).toEqual([id]);

    // The air tick puts it on the TVs once, at airs_at.
    expect(await runDemoAirTick(undefined, new Date(airsAt - 1000))).toBe(0);
    expect(await runDemoAirTick(undefined, new Date(airsAt + 1000))).toBe(1);
    expect(await runDemoAirTick(undefined, new Date(airsAt + 2000))).toBe(0);
    const [pushed] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(pushed?.airsPushedAt).not.toBeNull();
  });

  it('a demo campaign settles without paying the screenhost', async () => {
    const w = await world();
    const id = await seedDraft(w.demo.id, w.sector);
    expect((await launch(w.demo.id, id)).statusCode).toBe(200);
    const settled = await reconcileCampaignById(id, null);
    expect(settled.status).toBe('OK');
    expect(
      await db
        .select()
        .from(campaignScreenhostPayout)
        .where(eq(campaignScreenhostPayout.campaignId, id)),
    ).toEqual([]);
    expect(
      await db.select().from(reversementLines).where(eq(reversementLines.campaignId, id)),
    ).toEqual([]);
  });

  it('a REAL screencaster keeps the start-date floor (today refused)', async () => {
    const w = await world();
    const real = await seedUser();
    await db.insert(recharges).values({
      advertiserId: real,
      amountTnd: '2000.00',
      status: 'confirmed',
      reference: `DEMO-REAL-${seq}`,
    });
    const id = await seedDraft(real, w.sector);
    mockSession(real);
    const add = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: id },
    });
    expect(add.statusCode).toBe(400);
    expect(add.json<{ error: string }>().error).toBe('INVALID_START_DATE');
  });

  it('the delay is admin-set in minutes (0–1440) and drives airs_at', async () => {
    const w = await world();
    mockSession(w.admin, 'admin');
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/admin/demo/config',
      payload: { delay_minutes: 1441 },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/admin/demo/config',
      payload: { delay_minutes: 12 },
    });
    expect(ok.json()).toEqual({ delay_minutes: 12 });
    vi.restoreAllMocks();

    const id = await seedDraft(w.demo.id, w.sector);
    const before = Date.now();
    expect((await launch(w.demo.id, id)).statusCode).toBe(200);
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(c?.airsAt?.getTime() ?? 0).toBeGreaterThanOrEqual(before + 12 * 60_000);
  });

  it('demoAirsAt — never before the first day starts (Tunis midnight)', () => {
    const confirm = new Date('2026-10-12T10:00:00Z');
    expect(demoAirsAt(confirm, 5, '2026-10-12').toISOString()).toBe('2026-10-12T10:05:00.000Z');
    // A later start: its Tunis midnight (UTC+1) wins.
    expect(demoAirsAt(confirm, 5, '2026-10-14').toISOString()).toBe('2026-10-13T23:00:00.000Z');
  });

  it('only admins reach the demo API', async () => {
    const someone = await seedUser();
    mockSession(someone);
    const res = await app.inject({ method: 'GET', url: '/api/admin/demo' });
    expect(res.statusCode).toBe(403);
  });

  it("the owner's campaign list and calendar do not show a demo campaign", async () => {
    const w = await world();
    const id = await seedDraft(w.demo.id, w.sector);
    expect((await launch(w.demo.id, id)).statusCode).toBe(200);
    vi.restoreAllMocks();
    mockSession(w.owner, 'individual_owner');
    const list = await app.inject({ method: 'GET', url: '/api/screenhosts/campaigns' });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(id);
    const calendar = await app.inject({ method: 'GET', url: '/api/screenhosts/calendar' });
    expect(calendar.statusCode).toBe(200);
    expect(calendar.json()).toEqual([]);
  });

  it('deleting a demo account stops its campaigns and bans it', async () => {
    const w = await world();
    const id = await seedDraft(w.demo.id, w.sector);
    expect((await launch(w.demo.id, id)).statusCode).toBe(200);
    await db.insert(sessions).values({
      token: `tok-${seq}`,
      userId: w.demo.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    vi.restoreAllMocks();
    mockSession(w.admin, 'admin');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/demo/accounts/${w.demo.id}`,
    });
    expect(res.json()).toEqual({ deleted: w.demo.id, campaigns_stopped: 1 });
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(c?.status).toBe('rejected');
    const [u] = await db.select().from(users).where(eq(users.id, w.demo.id));
    expect(u?.status).toBe('banned');
    expect(await db.select().from(sessions).where(eq(sessions.userId, w.demo.id))).toEqual([]);
    const page = await app.inject({ method: 'GET', url: '/api/admin/demo' });
    expect(page.json<{ accounts: unknown[] }>().accounts).toEqual([]);
  });
});
