import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignTargeting,
  campaigns,
  cartItems,
  creatives,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { cartRoutes } from '../src/routes/cart.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CF-C1 (spec §1.10–1.14) — the panier. Real Postgres; session mocked. A "launchable" fixture
// mirrors the E5 hand-computation: one venue (all-dow affluence 100, 8–18h) → C_max 540 for a
// 2-day window at S=10 — budgets ≤ 540 pass the ceiling, the floor is 100. NO
// business_sectors/zones rows are added (the exact-seed-count footgun).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `cart${seq}@example.com`,
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
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Cart Venue ${seq}`,
      ownerId,
      businessSectorId: categoryId,
      class: 'premium',
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 7])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(rows);
  return id;
};

const seedCreative = async (advertiserId: string): Promise<string> => {
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/cart/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: 10,
      // CF-SK1 — these fixtures exercise the REVIEW path (draft → pending): an APPROVED spot
      // now SKIPS pending entirely (that path is owned by cart-approved-skip.test.ts).
      validationStatus: 'pending',
    })
    .returning();
  return c?.id ?? '';
};

const fund = (advertiserId: string, amountTnd: string) =>
  db.insert(recharges).values({
    advertiserId,
    amountTnd,
    status: 'confirmed',
    reference: `CART-${seq}-${Math.random().toString(16).slice(2, 8)}`,
  });

// A LAUNCHABLE draft: future floor-valid 2-day window, creative linked, budget in [100, 540].
const seedLaunchable = async (
  advertiserId: string,
  sector: string,
  over: Partial<typeof campaigns.$inferInsert> = {},
): Promise<string> => {
  const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
  const start = premiereDateDisponible(new Date(), lead);
  const creativeId =
    over.creativeId === undefined ? await seedCreative(advertiserId) : over.creativeId;
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Cart campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      startDate: start,
      endDate: plusCalendarDays(start, 1),
      requestedBudget: '200.00',
      ...over,
      creativeId,
    })
    .returning();
  const id = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId: sector, class: null });
  return id;
};

describe('CF-C1 — the cart (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(cartRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const add = (campaignId: string) =>
    app.inject({ method: 'POST', url: '/api/cart/items', payload: { campaign_id: campaignId } });
  const remove = (campaignId: string) =>
    app.inject({ method: 'DELETE', url: `/api/cart/items/${campaignId}` });
  const read = () => app.inject({ method: 'GET', url: '/api/cart' });
  const confirm = () => app.inject({ method: 'POST', url: '/api/cart/confirm' });

  const fullFixture = async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const sector = await ownerSectorId();
    await seedVenue(owner, sector);
    return { advertiser, owner, sector };
  };

  // ── the add gates matrix ───────────────────────────────────────────────────
  it('adds a COMPLETE draft (200) and re-adds idempotently (still ONE row)', async () => {
    const f = await fullFixture();
    const id = await seedLaunchable(f.advertiser, f.sector);
    mockSession(f.advertiser);
    const first = await add(id);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ campaign_id: id });
    const again = await add(id);
    expect(again.statusCode).toBe(200);
    const rows = await db.select().from(cartItems).where(eq(cartItems.campaignId, id));
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['MISSING_DATES', { startDate: null, endDate: null }],
    ['INVALID_START_DATE', { startDate: '2024-01-01', endDate: '2024-01-02' }],
    ['MISSING_CREATIVE', { creativeId: null }],
    ['MISSING_BUDGET', { requestedBudget: null }],
    ['BUDGET_BELOW_MINIMUM', { requestedBudget: '50.00' }],
    ['BUDGET_EXCEEDS_CMAX', { requestedBudget: '5000.00' }],
    ['NOT_DRAFT', { status: 'pending' as const }],
  ])('refuses an incomplete draft with the precise code %s', async (code, over) => {
    const f = await fullFixture();
    const id = await seedLaunchable(f.advertiser, f.sector, over);
    mockSession(f.advertiser);
    const res = await add(id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: code });
  });

  it('foreign ≡ missing 404 on add', async () => {
    const f = await fullFixture();
    const stranger = await seedUser();
    const id = await seedLaunchable(f.advertiser, f.sector);
    mockSession(stranger);
    const foreign = await add(id);
    const missing = await add('00000000-0000-4000-8000-000000000000');
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
  });

  // ── remove keeps the draft ─────────────────────────────────────────────────
  it('remove (« conserver en brouillon ») deletes the item, the campaign stays draft', async () => {
    const f = await fullFixture();
    const id = await seedLaunchable(f.advertiser, f.sector);
    mockSession(f.advertiser);
    await add(id);
    const res = await remove(id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ removed: true, campaign_id: id });
    const [row] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, id));
    expect(row?.status).toBe('draft');
    expect((await remove(id)).statusCode).toBe(404); // already gone
  });

  // ── the cart read ──────────────────────────────────────────────────────────
  it('GET /api/cart joins the projection and totals HT', async () => {
    const f = await fullFixture();
    const a = await seedLaunchable(f.advertiser, f.sector, { requestedBudget: '200.00' });
    const b = await seedLaunchable(f.advertiser, f.sector, { requestedBudget: '150.00' });
    mockSession(f.advertiser);
    await add(a);
    await add(b);
    const res = await read();
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      items: { id: string; requested_budget: number; added_at: string }[];
      total_ht: number;
      count: number;
    }>();
    expect(body.count).toBe(2);
    expect(body.total_ht).toBe(350);
    expect(body.items.map((i) => i.id)).toEqual([a, b]); // added_at order
    expect(body.items[0]).toMatchObject({ requested_budget: 200, status: 'draft' });
  });

  // ── confirm: happy path ────────────────────────────────────────────────────
  it('confirm flips EVERY carted draft → pending atomically, stamps submitted_at, clears the cart', async () => {
    const f = await fullFixture();
    const a = await seedLaunchable(f.advertiser, f.sector, { requestedBudget: '200.00' });
    const b = await seedLaunchable(f.advertiser, f.sector, { requestedBudget: '140.00' });
    await fund(f.advertiser, '340.00'); // exactly Σ HT — the boundary passes
    mockSession(f.advertiser);
    await add(a);
    await add(b);
    const res = await confirm();
    expect(res.statusCode).toBe(200);
    const confirmed = res.json<{ confirmed: { id: string; status: string }[] }>().confirmed;
    expect(confirmed.map((c) => c.id).sort()).toEqual([a, b].sort());
    for (const id of [a, b]) {
      const [row] = await db
        .select({ status: campaigns.status, submittedAt: campaigns.submittedAt })
        .from(campaigns)
        .where(eq(campaigns.id, id));
      expect(row?.status).toBe('pending');
      expect(row?.submittedAt).not.toBeNull();
    }
    expect(await db.select().from(cartItems).where(eq(cartItems.userId, f.advertiser))).toEqual([]);
  });

  // ── confirm: failure matrix — ALL-or-nothing, cart INTACT ──────────────────
  it('one stale item blocks ALL with its per-item reason; nothing flips; the cart stays', async () => {
    const f = await fullFixture();
    const good = await seedLaunchable(f.advertiser, f.sector, { requestedBudget: '200.00' });
    const stale = await seedLaunchable(f.advertiser, f.sector, { requestedBudget: '150.00' });
    await fund(f.advertiser, '1000.00');
    mockSession(f.advertiser);
    await add(good);
    await add(stale);
    // The stale item loses its creative AFTER being carted (live revalidation must catch it).
    await db.update(campaigns).set({ creativeId: null }).where(eq(campaigns.id, stale));

    const res = await confirm();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'CART_CONFIRM_FAILED',
      items: [{ campaign_id: stale, reason: 'MISSING_CREATIVE' }],
    });
    for (const id of [good, stale]) {
      const [row] = await db
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, id));
      expect(row?.status).toBe('draft'); // nothing launched
    }
    expect(
      await db.select().from(cartItems).where(eq(cartItems.userId, f.advertiser)),
    ).toHaveLength(2); // cart intact
  });

  it('insufficient solde → the {balance, required} payload, cart intact', async () => {
    const f = await fullFixture();
    const a = await seedLaunchable(f.advertiser, f.sector, { requestedBudget: '200.00' });
    const b = await seedLaunchable(f.advertiser, f.sector, { requestedBudget: '150.00' });
    await fund(f.advertiser, '349.99'); // one centime short of Σ 350 HT
    mockSession(f.advertiser);
    await add(a);
    await add(b);
    const res = await confirm();
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'CART_CONFIRM_FAILED',
      items: [],
      solde: { balance: 349.99, required: 350 },
    });
    expect(
      await db.select().from(cartItems).where(eq(cartItems.userId, f.advertiser)),
    ).toHaveLength(2);
  });

  it('an empty cart cannot confirm', async () => {
    const f = await fullFixture();
    mockSession(f.advertiser);
    expect((await confirm()).statusCode).toBe(400);
    expect((await confirm()).json()).toMatchObject({ error: 'CART_EMPTY' });
  });

  // ── auth ───────────────────────────────────────────────────────────────────
  it('401s every cart route without a session', async () => {
    mockNoSession();
    expect((await add('00000000-0000-4000-8000-000000000000')).statusCode).toBe(401);
    expect((await remove('00000000-0000-4000-8000-000000000000')).statusCode).toBe(401);
    expect((await read()).statusCode).toBe(401);
    expect((await confirm()).statusCode).toBe(401);
  });
});
