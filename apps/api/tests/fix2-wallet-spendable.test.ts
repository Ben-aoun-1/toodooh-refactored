import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignReconciliation,
  campaignTargeting,
  campaigns,
  creatives,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
  walletAdjustments,
} from '../src/db/schema.js';
import {
  plusCalendarDays,
  premiereDateDisponible,
  tunisDateOf,
} from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { walletSpendable } from '../src/lib/recharges.js';
import { walletLedger } from '../src/lib/wallet-ledger.js';
import { cartRoutes } from '../src/routes/cart.js';
import { rechargesRoutes } from '../src/routes/recharges.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// FIX2 (Option A ruling — reservation semantics) against real Postgres. THE probe inversion: the
// exact sequence that DEMONSTRATED the overdraft hole (fund 550 → confirm 400 → confirm another
// 400, both passing) must now REJECT the second confirm, naming disponible vs demandé. Plus the
// one-money-seam pins: spendable ≡ total − Σ engaged, total ≡ Σ(signed non-engagement ledger
// rows), engagement rows resolve into their settlement row (same campaign linkage).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `fix2-${seq}@example.com`,
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

const seedVenue = async (ownerId: string, categoryId: string): Promise<void> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `FIX2 Venue ${seq}`,
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
};

const seedCreative = async (advertiserId: string): Promise<string> => {
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/fix2/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: 10,
      validationStatus: 'pending', // review path — confirm flips to pending, no dispatch needed
    })
    .returning();
  return c?.id ?? '';
};

const fund = (advertiserId: string, amountTnd: string) =>
  db.insert(recharges).values({
    advertiserId,
    amountTnd,
    status: 'confirmed',
    reference: `FX2-${seq}-${Math.random().toString(16).slice(2, 8)}`,
  });

const seedCampaign = async (
  advertiserId: string,
  over: Partial<typeof campaigns.$inferInsert> = {},
): Promise<string> => {
  seq += 1;
  // FIX2b — default a LIVE diffusion window (today → +7): engagement now requires end_date ≥
  // Tunis today, so status fixtures must carry an open window unless a test overrides it.
  const today = tunisDateOf(new Date());
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `FIX2 campagne ${seq}`,
      campaignType: 'standard',
      status: 'draft',
      requestedBudget: '400.00',
      startDate: today,
      endDate: plusCalendarDays(today, 7),
      ...over,
    })
    .returning();
  return c?.id ?? '';
};

/** A cart-launchable draft: future floor-valid 2-day window, pending creative, sector targeting. */
const seedLaunchable = async (advertiserId: string, sector: string): Promise<string> => {
  const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
  const start = premiereDateDisponible(new Date(), lead);
  const creativeId = await seedCreative(advertiserId);
  const id = await seedCampaign(advertiserId, {
    startDate: start,
    endDate: plusCalendarDays(start, 1),
    creativeId,
  });
  await db.insert(campaignTargeting).values({ campaignId: id, categoryId: sector, class: null });
  return id;
};

const settle = (campaignId: string, spendTnd: string, refundTnd = '0.0000') =>
  db.insert(campaignReconciliation).values({
    campaignId,
    expectedImp: 1000,
    deliveredImp: 800,
    manquementImp: 200,
    pPerteTnd: refundTnd,
    refundTnd,
    spendTnd,
    status: 'partial',
  });

describe('FIX2 — reservation semantics + the served ledger (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(cartRoutes);
    await app.register(rechargesRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  // ── THE INVERSION PIN (charter step 2, ruled Option A) ─────────────────────
  it('the probe sequence INVERTS: 550 funded, first 400 confirms, the second REJECTS naming disponible vs demandé', async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const sector = await ownerSectorId();
    await seedVenue(owner, sector);
    await fund(advertiser, '550.00');
    mockSession(advertiser);

    const a = await seedLaunchable(advertiser, sector);
    await app.inject({ method: 'POST', url: '/api/cart/items', payload: { campaign_id: a } });
    const confirmA = await app.inject({ method: 'POST', url: '/api/cart/confirm' });
    expect(confirmA.statusCode).toBe(200); // 400 ≤ spendable 550

    const b = await seedLaunchable(advertiser, sector);
    await app.inject({ method: 'POST', url: '/api/cart/items', payload: { campaign_id: b } });
    const confirmB = await app.inject({ method: 'POST', url: '/api/cart/confirm' });
    expect(confirmB.statusCode).toBe(400);
    expect(confirmB.json()).toMatchObject({
      error: 'CART_CONFIRM_FAILED',
      solde: { balance: 550, spendable: 150, required: 400 },
    });

    // B stays a draft in the intact cart; A stays engaged.
    const [rowB] = await db.select().from(campaigns).where(eq(campaigns.id, b));
    expect(rowB?.status).toBe('draft');
    const wallet = await walletSpendable(advertiser);
    expect(wallet).toMatchObject({ balance_tnd: 550, engaged_tnd: 400, spendable_tnd: 150 });
  });

  // ── the engaged-set predicate ──────────────────────────────────────────────
  it('engages pending/upcoming/active/completed-unsettled; ignores drafts, rejected and SETTLED campaigns', async () => {
    const advertiser = await seedUser();
    await fund(advertiser, '1000.00');
    await seedCampaign(advertiser, { status: 'draft', requestedBudget: '100.00' });
    await seedCampaign(advertiser, { status: 'rejected', requestedBudget: '100.00' });
    await seedCampaign(advertiser, { status: 'pending', requestedBudget: '50.00' });
    await seedCampaign(advertiser, { status: 'upcoming', requestedBudget: '60.00' });
    await seedCampaign(advertiser, { status: 'active', requestedBudget: '70.00' });
    const settled = await seedCampaign(advertiser, {
      status: 'completed',
      requestedBudget: '250.00',
    });

    // Unsettled completed still engages (owed until reconciliation runs)…
    let wallet = await walletSpendable(advertiser);
    expect(wallet.engaged_tnd).toBe(430); // 50 + 60 + 70 + 250
    expect(wallet.spendable_tnd).toBe(570);

    // …then settlement REPLACES the engagement with the NET debit (never both).
    await settle(settled, '180.0000', '70.0000');
    wallet = await walletSpendable(advertiser);
    expect(wallet.engaged_tnd).toBe(180); // 50 + 60 + 70 — the settled one left the set
    expect(wallet.balance_tnd).toBe(820); // 1000 − 180 net
    expect(wallet.spendable_tnd).toBe(640);
  });

  // ── FIX2b — the WINDOW clause (the prod zombie sweep: −14 462 spendable) ───
  it('an ENDED-unreconciled campaign is NOT engaged — the zombie case, the exact prod shape', async () => {
    const advertiser = await seedUser();
    await fund(advertiser, '5500.00');
    const today = tunisDateOf(new Date());
    // The prod shapes: completed long ago, never reconciled (settlements never ran) — and an
    // active row whose window closed (the tick not yet flipped). NEITHER may reserve funds.
    await seedCampaign(advertiser, {
      status: 'completed',
      requestedBudget: '14000.00',
      startDate: '2026-07-01',
      endDate: '2026-07-15',
    });
    await seedCampaign(advertiser, {
      status: 'active',
      requestedBudget: '500.00',
      startDate: '2026-07-20',
      endDate: plusCalendarDays(today, -1),
    });
    // A still-open window IS engaged — the boundary day (end = today) included (gte).
    await seedCampaign(advertiser, {
      status: 'active',
      requestedBudget: '300.00',
      endDate: today,
    });

    const wallet = await walletSpendable(advertiser);
    expect(wallet.engaged_tnd).toBe(300); // only the live window
    expect(wallet.spendable_tnd).toBe(5200); // never −14 462-shaped again

    // The ledger mirrors the SAME predicate: the zombies show NEITHER an « Engagé » row NOR a
    // settlement row (limbo pending settlement — the settlement lane's territory, not a display).
    mockSession(advertiser);
    const res = await app.inject({ method: 'GET', url: '/api/wallet/transactions' });
    const body = res.json<Awaited<ReturnType<typeof walletLedger>>>();
    expect(body.transactions.filter((r) => r.type === 'engagement')).toHaveLength(1);
    expect(body.transactions.filter((r) => r.type === 'settlement')).toHaveLength(0);
    expect(body.solde).toEqual({
      total_tnd: 5500,
      engaged_tnd: 300,
      spendable_tnd: 5200,
      currency: 'TND',
    });
  });

  it('excludeCampaignId (the ACTIVATION gate) removes exactly the campaign’s own engagement', async () => {
    const advertiser = await seedUser();
    await fund(advertiser, '400.00');
    const own = await seedCampaign(advertiser, { status: 'pending', requestedBudget: '400.00' });

    const including = await walletSpendable(advertiser);
    expect(including.spendable_tnd).toBe(0);
    const excluding = await walletSpendable(advertiser, { excludeCampaignId: own });
    expect(excluding.spendable_tnd).toBe(400); // its own ask no longer double-charges it
  });

  // ── the served ledger + the Σ-reconciliation pins ──────────────────────────
  it('serves the COMPLETE signed ledger; total ≡ Σ(non-engagement rows), spendable ≡ total + Σ(engagement rows)', async () => {
    const advertiser = await seedUser();
    await fund(advertiser, '1000.00');
    const engagedCampaign = await seedCampaign(advertiser, {
      status: 'pending',
      requestedBudget: '400.00',
      submittedAt: new Date('2026-08-05T10:00:00Z'),
      name: 'FT1',
    });
    const settledCampaign = await seedCampaign(advertiser, {
      status: 'completed',
      requestedBudget: '250.00',
      submittedAt: new Date('2026-07-20T10:00:00Z'),
      name: 'ky',
    });
    await settle(settledCampaign, '180.0000', '70.0000');
    await db.insert(walletAdjustments).values({
      advertiserId: advertiser,
      amountTnd: '-50.00',
      reason: 'Correction test',
      adminId: advertiser,
    });
    mockSession(advertiser);

    const res = await app.inject({ method: 'GET', url: '/api/wallet/transactions' });
    expect(res.statusCode).toBe(200);
    const body = res.json<Awaited<ReturnType<typeof walletLedger>>>();

    // The solde block: total = 1000 − 180 − 50 = 770; spendable = 770 − 400 = 370.
    expect(body.solde).toEqual({
      total_tnd: 770,
      engaged_tnd: 400,
      spendable_tnd: 370,
      currency: 'TND',
    });

    const byType = (t: string) => body.transactions.filter((r) => r.type === t);
    expect(byType('recharge')).toHaveLength(1);
    expect(byType('engagement')).toHaveLength(1);
    expect(byType('settlement')).toHaveLength(1);
    expect(byType('adjustment')).toHaveLength(1);

    // Signs + linkage: the engagement carries FT1 (still engaged); ky appears ONLY as its NET
    // settlement row (never both), same campaign_id an earlier engagement row would have carried.
    expect(byType('engagement')[0]).toMatchObject({
      label: 'FT1',
      amount_tnd: -400,
      campaign_id: engagedCampaign,
    });
    expect(byType('settlement')[0]).toMatchObject({
      label: 'ky',
      amount_tnd: -180,
      campaign_id: settledCampaign,
    });
    expect(
      body.transactions.some((r) => r.type === 'engagement' && r.campaign_id === settledCampaign),
    ).toBe(false);

    // THE Σ-reconciliation (the acceptance bar — hand-reconcilable to the dinar):
    const sum = (rows: { amount_tnd: number }[]) => rows.reduce((s, r) => s + r.amount_tnd, 0);
    const nonEngagement = body.transactions.filter((r) => r.type !== 'engagement');
    expect(sum(nonEngagement)).toBe(body.solde.total_tnd);
    expect(body.solde.total_tnd + sum(byType('engagement'))).toBe(body.solde.spendable_tnd);
  });

  it('GET /api/wallet/balance now carries engaged_tnd + spendable_tnd (additive)', async () => {
    const advertiser = await seedUser();
    await fund(advertiser, '500.00');
    await seedCampaign(advertiser, { status: 'active', requestedBudget: '120.00' });
    mockSession(advertiser);

    const res = await app.inject({ method: 'GET', url: '/api/wallet/balance' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      balance_tnd: 500,
      engaged_tnd: 120,
      spendable_tnd: 380,
      currency: 'TND',
    });
  });
});
