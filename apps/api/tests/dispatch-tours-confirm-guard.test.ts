import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchPlan,
  campaigns,
  creatives,
  dispatchConfig,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { prepareActivation } from '../src/lib/activation-service.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { cartRoutes } from '../src/routes/cart.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// DISP-TOURS §3.4 — the « garde-fou au lancement »: « si une place a été prise entre l'ouverture
// du panier et le clic, réafficher les chiffres à jour avant de débiter ». The cart sends the
// figures it showed; a launch that would price differently stops before anything moves — at the
// confirm, and again under the dispatch's locks. And R13: the wallet covers the EXACT price.
// One venue (Mariem's Café A week, 16 h → 20 h), a 30 s approved spot (launched at confirm), CPM
// 12, F = 600 s; the dates follow today (the cart refuses a start inside the lead).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const WEEK_A = [
  [20, 30, 25, 10],
  [20, 25, 30, 15],
  [15, 20, 25, 30],
  [30, 25, 20, 10],
  [20, 30, 35, 25],
  [25, 35, 40, 30],
  [30, 25, 20, 15],
];

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `tours-guard${seq}@example.com`,
      contactName: `Guard ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

interface CartQuoteWire {
  prix_tnd: number;
  impressions: number;
}

describe('DISP-TOURS — « Lancer » re-checks the figures the cart showed (real Postgres)', () => {
  let app: ReturnType<typeof Fastify>;
  let advertiser = '';
  let campaignId = '';

  const fund = (amountTnd: string) =>
    db.insert(recharges).values({
      advertiserId: advertiser,
      amountTnd,
      status: 'confirmed',
      reference: `GUARD-${seq}-${amountTnd}`,
    });

  beforeEach(async () => {
    await resetAuthTables();
    await db.update(dispatchConfig).set({ fMaxSeconds: 600 });
    app = Fastify({ logger: false });
    await app.register(cartRoutes);
    await app.ready();

    const owner = await seedUser({ role: 'individual_owner' });
    const [sector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .limit(1);
    const [venue] = await db
      .insert(screenhosts)
      .values({
        name: 'Café A',
        ownerId: owner,
        businessSectorId: sector?.id ?? '',
        class: 'moyen',
        openingHour: 16,
        closingHour: 20,
        broadcastCapacity: 4,
      })
      .returning();
    await db.insert(screenhostAffluence).values(
      bothHalves(
        WEEK_A.flatMap((row, d) =>
          row.map((estimatedImpressions, i) => ({
            screenhostId: venue?.id ?? '',
            dayOfWeek: d + 1,
            hour: 16 + i,
            estimatedImpressions,
          })),
        ),
      ),
    );
    await seedInstalledScreen(venue?.id ?? '');

    advertiser = await seedUser();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/tours-guard/${seq}`,
        durationSeconds: 30,
        validationStatus: 'approved',
      })
      .returning();
    const start = premiereDateDisponible(
      new Date(),
      (await getDispatchConfig()).campaignLeadWorkingDays,
    );
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Garde-fou',
        campaignType: 'standard',
        status: 'draft',
        startDate: start,
        endDate: plusCalendarDays(start, 9),
        creativeId: creative?.id ?? null,
        requestedBudget: '150.00',
        standardCpmTnd: '12.000',
        t10s: '0.60',
        t20s: '0.70',
        t30s: '0.80',
      })
      .returning();
    campaignId = c?.id ?? '';
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: advertiser, role: 'advertiser', status: 'approved' },
    } as unknown as GetSessionResult);
    const added = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: campaignId },
    });
    expect(added.statusCode).toBe(200);
  }, 60_000); // the hook runs a whole cart flow (a calculation, a dispatch)

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    await db.update(dispatchConfig).set({ fMaxSeconds: 300 });
  });

  afterAll(async () => {
    await sql.end();
  });

  const shownQuote = async (): Promise<CartQuoteWire> => {
    const read = await app.inject({ method: 'GET', url: '/api/cart' });
    const item = (read.json() as { items: { id: string; quote: CartQuoteWire | null }[] }).items[0];
    if (!item?.quote) throw new Error('no quote');
    return item.quote;
  };
  const confirm = (quote: CartQuoteWire) =>
    app.inject({
      method: 'POST',
      url: '/api/cart/confirm',
      payload: { quotes: [{ campaign_id: campaignId, ...quote }] },
    });
  const planOf = async () =>
    db.select().from(campaignDispatchPlan).where(eq(campaignDispatchPlan.campaignId, campaignId));
  const statusOf = async () =>
    (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)))[0];

  it('figures that moved since the cart was read: nothing launched, the item says why', async () => {
    await fund('5000.00');
    const seen = await shownQuote();
    const res = await confirm({ ...seen, prix_tnd: seen.prix_tnd + 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'CART_CONFIRM_FAILED',
      items: [{ campaign_id: campaignId, reason: 'QUOTE_CHANGED' }],
    });
    expect((await statusOf())?.status).toBe('draft');
    expect(await planOf()).toHaveLength(0);
  });

  it('the figures shown are the ones launched: the plan’s price, the amount engaged', async () => {
    await fund('5000.00');
    const seen = await shownQuote();
    expect(seen.prix_tnd).toBeLessThanOrEqual(150);
    const res = await confirm(seen);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { launched: unknown[] }).launched).toHaveLength(1);
    const [plan] = await planOf();
    expect(Number(plan?.priceTnd)).toBeCloseTo(seen.prix_tnd, 4);
    expect(plan?.couvert).toBe(seen.impressions);
    expect((await statusOf())?.requestedBudget).toBe(seen.prix_tnd.toFixed(2));
  });

  it('under the launch’s locks too: a moved quote writes no plan', async () => {
    await fund('5000.00');
    const seen = await shownQuote();
    const row = await statusOf();
    if (!row) throw new Error('campaign missing');
    const prepared = await prepareActivation({
      campaign: row,
      contentValidationStatus: 'approved',
      creativeDurationSeconds: 30,
      fromStatus: 'draft',
      expectedQuote: { prixTnd: seen.prix_tnd, impressions: seen.impressions + 1 },
    });
    expect(prepared.status).toBe('QUOTE_CHANGED');
    expect(await planOf()).toHaveLength(0);
  });

  it('R13 — the wallet covers the exact price, not the budget aimed at', async () => {
    const seen = await shownQuote();
    const price = Math.round(seen.prix_tnd * 100) / 100;
    expect(price).toBeLessThan(150);
    await fund((price - 0.01).toFixed(2));
    const short = await confirm(seen);
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ error: 'CART_CONFIRM_FAILED', solde: { required: price } });
    await fund('0.01');
    const enough = await confirm(seen);
    expect(enough.statusCode).toBe(200);
  });
});
