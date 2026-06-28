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
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  creatives,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { adminReconcileRoutes } from '../src/routes/admin-reconcile.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. Reconcile an active, past-end-date campaign: value plan-promised vs
// proof-aired, refund the residual (B.4), record screenhost earnings. cpm=10 (0.01 TND/imp), s_min=10.
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
      email: `rec${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 8, reps: 100, impressions: 10000 },
  { date: '2024-01-02', hour: 8, reps: 100, impressions: 10000 },
]; // expectedPlays = 200, Σ impressions = ii_potentiel 20000

interface Scenario {
  admin: string;
  advertiser: string;
  campaignId: string;
  planId: string;
  screenhostId: string;
  screenId: string;
  creativeId: string;
}

// active campaign, end-date in the PAST, a frozen plan + one allocation (ii_potentiel 20000,
// expectedPlays 200). status='active' so reconcile is allowed; endDate past so it has ended.
const seedScenario = async (opts: { endDate?: string } = {}): Promise<Scenario> => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({ role: 'advertiser' });
  const owner = await seedUser({ role: 'individual_owner' });
  const [sh] = await db.insert(screenhosts).values({ name: 'Venue', ownerId: owner }).returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'Screen' })
    .returning();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId: advertiser,
      creativeType: 'video',
      storageKey: `creatives/${advertiser}/c`,
      durationSeconds: 20,
      validationStatus: 'approved',
    })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: 'Reconcile Test',
      campaignType: 'standard',
      status: 'active',
      startDate: '2024-01-01',
      endDate: opts.endDate ?? '2024-01-02',
      creativeId: creative?.id,
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible: 20000,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '0.8',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 20000,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: sh?.id ?? '',
    iiPotentiel: 20000,
    rI: 100,
    revenuPrevisionnel: '200',
    creneaux: CRENEAUX,
  });
  return {
    admin,
    advertiser,
    campaignId: campaign?.id ?? '',
    planId: plan?.id ?? '',
    screenhostId: sh?.id ?? '',
    screenId: screen?.id ?? '',
    creativeId: creative?.id ?? '',
  };
};

const insertProofs = async (
  s: Pick<Scenario, 'screenId' | 'screenhostId' | 'campaignId' | 'creativeId'>,
  count: number,
): Promise<void> => {
  if (count <= 0) return;
  await db.insert(proofOfPlay).values(
    Array.from({ length: count }, () => ({
      screenId: s.screenId,
      screenhostId: s.screenhostId,
      campaignId: s.campaignId,
      creativeId: s.creativeId,
      videoIdAsSent: s.campaignId,
      eventType: 'VIDEO_ENDED' as const,
    })),
  );
};

interface ReconResponse {
  status: string;
  expected_imp: number;
  delivered_imp: number;
  manquement_imp: number;
  p_perte_tnd: number;
  refund_tnd: number;
  spend_tnd: number;
  screenhosts: { screenhost_id: string; delivered_imp: number; earnings_tnd: number }[];
}

describe('admin reconciliation (L-redisp, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminReconcileRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const reconcile = (id: string) =>
    app.inject({ method: 'POST', url: `/api/admin/campaigns/${id}/reconcile` });

  it('fully delivered → réussie, P_perte 0, no refund, spend = budget, SH earnings full', async () => {
    const s = await seedScenario();
    await insertProofs(s, 200);
    mockSession(s.admin);
    const res = await reconcile(s.campaignId);
    expect(res.statusCode).toBe(201);
    const body = res.json() as ReconResponse;
    expect(body).toMatchObject({
      status: 'reussie',
      expected_imp: 20000,
      delivered_imp: 20000,
      manquement_imp: 0,
      p_perte_tnd: 0,
      refund_tnd: 0,
      spend_tnd: 200,
    });
    expect(body.screenhosts).toHaveLength(1);
    expect(body.screenhosts[0]).toMatchObject({ delivered_imp: 20000, earnings_tnd: 200 });
  });

  it('partially aired → manquement valued, refund = residual, spend = delivered, SH earns its share', async () => {
    const s = await seedScenario();
    await insertProofs(s, 100); // ratio 0.5 → delivered 10000
    mockSession(s.admin);
    const body = (await reconcile(s.campaignId)).json() as ReconResponse;
    expect(body).toMatchObject({
      status: 'partial',
      delivered_imp: 10000,
      manquement_imp: 10000,
      p_perte_tnd: 100,
      refund_tnd: 100,
      spend_tnd: 100,
    });
    expect(body.screenhosts[0]).toMatchObject({ delivered_imp: 10000, earnings_tnd: 100 });
  });

  it('shortfall below S_min → réussie + no refund (advertiser pays full budget)', async () => {
    const s = await seedScenario();
    await insertProofs(s, 199); // delivered 19900, manquement 100 → P_perte 1 < S_min 10
    mockSession(s.admin);
    const body = (await reconcile(s.campaignId)).json() as ReconResponse;
    expect(body).toMatchObject({
      status: 'reussie',
      refund_tnd: 0,
      spend_tnd: 200,
      p_perte_tnd: 1,
    });
  });

  it('a defaulting screenhost earns 0 on its undiffused part', async () => {
    const s = await seedScenario();
    // Add a second screenhost + allocation that delivers nothing.
    const owner2 = await seedUser({ role: 'individual_owner' });
    const [sh2] = await db
      .insert(screenhosts)
      .values({ name: 'Venue2', ownerId: owner2 })
      .returning();
    await db.insert(campaignDispatchAllocation).values({
      planId: s.planId,
      screenhostId: sh2?.id ?? '',
      iiPotentiel: 10000,
      rI: 100,
      revenuPrevisionnel: '100',
      creneaux: CRENEAUX,
    });
    await insertProofs(s, 200); // SH1 full; SH2 none
    mockSession(s.admin);
    const body = (await reconcile(s.campaignId)).json() as ReconResponse;
    expect(body).toMatchObject({ status: 'partial', expected_imp: 30000, delivered_imp: 20000 });
    const sh2Payout = body.screenhosts.find((p) => p.screenhost_id === sh2?.id);
    expect(sh2Payout).toMatchObject({ delivered_imp: 0, earnings_tnd: 0 });
  });

  it('is idempotent — re-reconcile 409s, no second row / double earnings', async () => {
    const s = await seedScenario();
    await insertProofs(s, 100);
    mockSession(s.admin);
    expect((await reconcile(s.campaignId)).statusCode).toBe(201);
    expect((await reconcile(s.campaignId)).statusCode).toBe(409);
    const rows = await db
      .select()
      .from(campaignReconciliation)
      .where(eq(campaignReconciliation.campaignId, s.campaignId));
    expect(rows).toHaveLength(1);
    const payouts = await db
      .select()
      .from(campaignScreenhostPayout)
      .where(eq(campaignScreenhostPayout.campaignId, s.campaignId));
    expect(payouts).toHaveLength(1);
  });

  it('refuses a campaign that has not ended yet (409)', async () => {
    const s = await seedScenario({ endDate: '2999-12-31' });
    await insertProofs(s, 50);
    mockSession(s.admin);
    expect((await reconcile(s.campaignId)).statusCode).toBe(409);
  });

  it('refuses a non-active campaign (409), 404s a missing one, 403s a non-admin', async () => {
    const s = await seedScenario();
    await db.update(campaigns).set({ status: 'pending' }).where(eq(campaigns.id, s.campaignId));
    mockSession(s.admin);
    expect((await reconcile(s.campaignId)).statusCode).toBe(409);
    expect((await reconcile('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);

    const s2 = await seedScenario();
    mockSession(s2.advertiser, 'advertiser');
    expect((await reconcile(s2.campaignId)).statusCode).toBe(403);
  });
});
