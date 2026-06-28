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

// Integration — real Postgres. Reconcile an active, past-end-date campaign: a créneau is DELIVERED iff
// a VIDEO_ENDED proof's SERVER received_at falls in its date+hour (Africa/Tunis = UTC+1, so a hour-H
// créneau is delivered by a proof at H−1:30 UTC). cpm=10 (0.01 TND/imp), s_min=10.
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

// Default plan: two créneaux (Jan 1 & 2, hour 8), 10000 impressions each → ii_potentiel 20000.
const DEFAULT_CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 8, reps: 100, impressions: 10000 },
  { date: '2024-01-02', hour: 8, reps: 100, impressions: 10000 },
];

interface Scenario {
  admin: string;
  advertiser: string;
  campaignId: string;
  planId: string;
  screenhostId: string;
  screenId: string;
  creativeId: string;
}

const seedScenario = async (
  opts: { endDate?: string; creneaux?: DispatchCreneau[] } = {},
): Promise<Scenario> => {
  const creneaux = opts.creneaux ?? DEFAULT_CRENEAUX;
  const iiPotentiel = creneaux.reduce((s, c) => s + c.impressions, 0);
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
      iCible: iiPotentiel,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '0.8',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: iiPotentiel,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: sh?.id ?? '',
    iiPotentiel,
    rI: 100,
    revenuPrevisionnel: String((iiPotentiel * 10) / 1000),
    creneaux,
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

// Deliver a créneau by inserting `count` VIDEO_ENDED proofs whose server received_at lands in
// (date, tunisHour) — Africa/Tunis is UTC+1, so a tunisHour-H slot is hit at H−1:30 UTC.
const deliverSlot = async (
  s: Pick<Scenario, 'screenId' | 'screenhostId' | 'campaignId' | 'creativeId'>,
  date: string,
  tunisHour: number,
  count = 1,
): Promise<void> => {
  const utcHour = String(tunisHour - 1).padStart(2, '0');
  const receivedAt = new Date(`${date}T${utcHour}:30:00Z`);
  await db.insert(proofOfPlay).values(
    Array.from({ length: count }, () => ({
      screenId: s.screenId,
      screenhostId: s.screenhostId,
      campaignId: s.campaignId,
      creativeId: s.creativeId,
      videoIdAsSent: s.campaignId,
      eventType: 'VIDEO_ENDED' as const,
      receivedAt,
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
    await deliverSlot(s, '2024-01-01', 8);
    await deliverSlot(s, '2024-01-02', 8);
    mockSession(s.admin);
    const res = await reconcile(s.campaignId);
    expect(res.statusCode).toBe(201);
    const body = res.json() as ReconResponse;
    expect(body).toMatchObject({
      status: 'reussie',
      expected_imp: 20000,
      delivered_imp: 20000,
      manquement_imp: 0,
      refund_tnd: 0,
      spend_tnd: 200,
    });
    expect(body.screenhosts[0]).toMatchObject({ delivered_imp: 20000, earnings_tnd: 200 });
  });

  it('partially aired → manquement valued, refund = residual, spend == Σ earnings, SH earns its share', async () => {
    const s = await seedScenario();
    await deliverSlot(s, '2024-01-01', 8); // 1 of 2 créneaux → 10000
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
    expect(body.spend_tnd).toBe(body.screenhosts.reduce((sum, p) => sum + p.earnings_tnd, 0));
  });

  it('SPAM-RESISTANCE: many VIDEO_ENDED in ONE hour credit that créneau ONCE (not inflated)', async () => {
    const s = await seedScenario();
    await deliverSlot(s, '2024-01-01', 8, 50); // 50 proofs, all in the SAME hour/slot
    mockSession(s.admin);
    const body = (await reconcile(s.campaignId)).json() as ReconResponse;
    // Only the one slot is credited → 10000, NOT 20000 (and the second créneau stays a manquement).
    expect(body).toMatchObject({ delivered_imp: 10000, manquement_imp: 10000, status: 'partial' });
  });

  it('SPAM-RESISTANCE: proofs in 2 of 10 scheduled hours → exactly those 2 hours’ impressions', async () => {
    const creneaux: DispatchCreneau[] = Array.from({ length: 10 }, (_, i) => ({
      date: '2024-01-01',
      hour: 8 + i,
      reps: 10,
      impressions: 1000,
    })); // 10 slots × 1000 = 10000
    const s = await seedScenario({ creneaux });
    await deliverSlot(s, '2024-01-01', 8, 30); // hour 8, spammed
    await deliverSlot(s, '2024-01-01', 9, 5); // hour 9
    mockSession(s.admin);
    const body = (await reconcile(s.campaignId)).json() as ReconResponse;
    expect(body.delivered_imp).toBe(2000); // 2 hours × 1000, NOT inflated by the 35 proofs
    expect(body.manquement_imp).toBe(8000);
  });

  it('shortfall below S_min → réussie + no refund (advertiser pays full budget)', async () => {
    const creneaux: DispatchCreneau[] = [
      { date: '2024-01-01', hour: 8, reps: 100, impressions: 19900 },
      { date: '2024-01-02', hour: 8, reps: 100, impressions: 100 },
    ];
    const s = await seedScenario({ creneaux });
    await deliverSlot(s, '2024-01-01', 8); // miss the 100-imp slot → manquement 100 → P_perte 1 < 10
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
      creneaux: DEFAULT_CRENEAUX,
    });
    await deliverSlot(s, '2024-01-01', 8); // SH1 delivers one slot; SH2 nothing
    await deliverSlot(s, '2024-01-02', 8);
    mockSession(s.admin);
    const body = (await reconcile(s.campaignId)).json() as ReconResponse;
    const sh2Payout = body.screenhosts.find((p) => p.screenhost_id === sh2?.id);
    expect(sh2Payout).toMatchObject({ delivered_imp: 0, earnings_tnd: 0 });
  });

  it('is idempotent — re-reconcile 409s, no second row', async () => {
    const s = await seedScenario();
    await deliverSlot(s, '2024-01-01', 8);
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

  it('refuses not-ended (409), non-active (409), missing (404), non-admin (403)', async () => {
    const future = await seedScenario({ endDate: '2999-12-31' });
    mockSession(future.admin);
    expect((await reconcile(future.campaignId)).statusCode).toBe(409); // not ended

    const s = await seedScenario();
    await db.update(campaigns).set({ status: 'pending' }).where(eq(campaigns.id, s.campaignId));
    mockSession(s.admin);
    expect((await reconcile(s.campaignId)).statusCode).toBe(409); // non-active
    expect((await reconcile('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);

    const s2 = await seedScenario();
    mockSession(s2.advertiser, 'advertiser');
    expect((await reconcile(s2.campaignId)).statusCode).toBe(403);
  });
});
