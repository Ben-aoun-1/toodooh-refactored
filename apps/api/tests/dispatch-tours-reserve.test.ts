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
  campaigns,
  creatives,
  dispatchConfig,
  notifications,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { activateCampaign } from '../src/lib/activation-service.js';
import { decideAllocation } from '../src/lib/allocation-decision.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { walletSpendable } from '../src/lib/recharges.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { cartRoutes } from '../src/routes/cart.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// DISP-TOURS Q1 (Mariem, 03/11: « ok ») — « on fige et on réserve au clic sur « Lancer » dans
// tous les cas ; la campagne ne diffuse qu'une fois le spot validé ; un spot refusé libère les
// créneaux et le montant revient au wallet. » A cart campaign whose spot awaits validation is
// frozen at « Lancer » with RESERVE allocations (its places held, the exact price engaged, no
// owner told); the validation proposes it to the owners; a refusal gives everything back.

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
      email: `tours-reserve${seq}@example.com`,
      contactName: `Reserve ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const asUser = (id: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

describe('DISP-TOURS Q1 — a spot under review is reserved at « Lancer » (real Postgres)', () => {
  let app: ReturnType<typeof Fastify>;
  let advertiser = '';
  let owner = '';
  let creativeId = '';
  let campaignId = '';
  let priceTnd = 0; // the exact price the cart showed, to the centime

  beforeEach(async () => {
    await resetAuthTables();
    await db.update(dispatchConfig).set({ fMaxSeconds: 600 });
    app = Fastify({ logger: false });
    await app.register(cartRoutes);
    await app.register(adminCampaignsRoutes);
    await app.ready();

    owner = await seedUser({ role: 'individual_owner' });
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
    await db.insert(recharges).values({
      advertiserId: advertiser,
      amountTnd: '5000.00',
      status: 'confirmed',
      reference: `RESERVE-${seq}`,
    });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/tours-reserve/${seq}`,
        durationSeconds: 30,
        validationStatus: 'pending', // awaits the admin
      })
      .returning();
    creativeId = creative?.id ?? '';
    const start = premiereDateDisponible(
      new Date(),
      (await getDispatchConfig()).campaignLeadWorkingDays,
    );
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'Sous validation',
        campaignType: 'standard',
        status: 'draft',
        startDate: start,
        endDate: plusCalendarDays(start, 9),
        creativeId,
        requestedBudget: '150.00',
        standardCpmTnd: '12.000',
        t10s: '0.60',
        t20s: '0.70',
        t30s: '0.80',
      })
      .returning();
    campaignId = c?.id ?? '';

    asUser(advertiser, 'advertiser');
    const added = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      payload: { campaign_id: campaignId },
    });
    expect(added.statusCode).toBe(200);
    const read = await app.inject({ method: 'GET', url: '/api/cart' });
    const quote = (
      read.json() as { items: { quote: { prix_tnd: number; impressions: number } | null }[] }
    ).items[0]?.quote;
    if (!quote) throw new Error('no quote');
    priceTnd = Math.round(quote.prix_tnd * 100) / 100;
    expect(priceTnd).toBeLessThan(150);
    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/cart/confirm',
      payload: { quotes: [{ campaign_id: campaignId, ...quote }] },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ launched: [], pending_review: [{ id: campaignId }] });
  }, 60_000); // the hook runs a whole cart flow (a calculation, a dispatch)

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    await db.update(dispatchConfig).set({ fMaxSeconds: 300 });
  });

  afterAll(async () => {
    await sql.end();
  });

  const allocations = async () => {
    const [plan] = await db
      .select()
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    if (!plan) return null;
    return db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan.id));
  };
  const campaign = async () =>
    (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)))[0];
  const ownerNotices = () =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, owner), eq(notifications.campaignId, campaignId)));

  it('« Lancer » freezes and reserves: places held, price engaged, no owner told, not decidable', async () => {
    const rows = await allocations();
    expect(rows?.length).toBeGreaterThan(0);
    expect(rows?.every((a) => a.statutAcceptation === 'RESERVE')).toBe(true);
    const row = await campaign();
    expect(row?.status).toBe('pending');
    expect(row?.requestedBudget).toBe(priceTnd.toFixed(2));
    expect(await ownerNotices()).toHaveLength(0);
    // The owner cannot decide a campaign they were never proposed.
    const decided = await decideAllocation({
      allocationId: rows?.[0]?.id ?? '',
      ownerId: owner,
      statut: 'ACCEPTE',
    });
    expect(decided.kind).toBe('not_found');
    // The wallet engages the exact price.
    expect((await walletSpendable(advertiser)).engaged_tnd).toBeCloseTo(priceTnd, 2);
  });

  it('the validation proposes it: allocations EN_ATTENTE, the owner told the amount', async () => {
    await db.update(creatives).set({ validationStatus: 'approved' }).where(eq(creatives.id, creativeId));
    const row = await campaign();
    if (!row) throw new Error('campaign missing');
    const outcome = await activateCampaign({
      campaign: row,
      contentValidationStatus: 'approved',
      creativeDurationSeconds: 30,
      activatedBy: null,
      fromStatus: 'pending',
    });
    expect(outcome.status).toBe('OK');
    expect((await allocations())?.every((a) => a.statutAcceptation === 'EN_ATTENTE')).toBe(true);
    const notices = await ownerNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body).toContain('vous rapporte');
    expect(notices[0]?.body).toContain('DT');
    expect((await campaign())?.status).toBe('upcoming');
  });

  it('a refusal frees the places and gives the amount back', async () => {
    const admin = await seedUser({ role: 'admin' });
    asUser(admin, 'admin');
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/campaigns/${campaignId}/reject`,
      payload: { reason: 'Spot refusé' },
    });
    expect(res.statusCode).toBe(200);
    expect(await allocations()).toBeNull();
    const row = await campaign();
    expect(row?.status).toBe('rejected');
    expect(row?.requestedBudget).toBe('150.00'); // the budget aimed at, back
    expect((await walletSpendable(advertiser)).engaged_tnd).toBe(0);
    expect(await ownerNotices()).toHaveLength(0);
  });
});
