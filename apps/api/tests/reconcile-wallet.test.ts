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
  proofOfPlay,
  recharges,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { walletBalance } from '../src/lib/recharges.js';
import { adminReconcileRoutes } from '../src/routes/admin-reconcile.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — the wallet DEBIT seam (L-redisp §2). Reconciliation writes campaign_reconciliation
// .spend_tnd (= budget − refund, the NET owed); walletBalance subtracts it. balance = credited −
// debited, with the refund already netted into spend. Idempotent per campaign.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'admin', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `rw${seq}@example.com`,
      contactName: `U${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const CRENEAUX: DispatchCreneau[] = [
  { date: '2024-01-01', hour: 8, reps: 100, impressions: 10000 },
  { date: '2024-01-02', hour: 8, reps: 100, impressions: 10000 },
]; // expectedPlays 200, ii_potentiel 20000

interface S {
  admin: string;
  advertiser: string;
  campaignId: string;
  screenId: string;
  screenhostId: string;
  creativeId: string;
}
const seed = async (): Promise<S> => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({ role: 'advertiser' });
  const owner = await seedUser({ role: 'individual_owner' });
  const [sh] = await db.insert(screenhosts).values({ name: 'V', ownerId: owner }).returning();
  const [screen] = await db
    .insert(screens)
    .values({ screenhostId: sh?.id ?? '', name: 'S' })
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
      name: 'C',
      campaignType: 'standard',
      status: 'active',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
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
    screenId: screen?.id ?? '',
    screenhostId: sh?.id ?? '',
    creativeId: creative?.id ?? '',
  };
};

const fund = async (advertiserId: string, amountTnd: number): Promise<void> => {
  seq += 1;
  await db.insert(recharges).values({
    advertiserId,
    amountTnd: String(amountTnd),
    status: 'confirmed',
    reference: `RW-${seq}`,
  });
};
// Deliver a créneau (date, tunisHour) — Africa/Tunis = UTC+1, so received_at = (H−1):30 UTC.
const deliverSlot = async (s: S, date: string, tunisHour: number): Promise<void> => {
  const utcHour = String(tunisHour - 1).padStart(2, '0');
  await db.insert(proofOfPlay).values({
    screenId: s.screenId,
    screenhostId: s.screenhostId,
    campaignId: s.campaignId,
    creativeId: s.creativeId,
    videoIdAsSent: s.campaignId,
    eventType: 'VIDEO_ENDED' as const,
    receivedAt: new Date(`${date}T${utcHour}:30:00Z`),
  });
};

describe('walletBalance — reconciliation debit seam (real Postgres)', () => {
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

  it('before reconciliation the balance is just the confirmed credit (debited 0)', async () => {
    const s = await seed();
    await fund(s.advertiser, 500);
    const bal = await walletBalance(s.advertiser);
    expect(bal).toMatchObject({ credited_tnd: 500, debited_tnd: 0, balance_tnd: 500 });
  });

  it('a fully-delivered reconciliation debits the full budget', async () => {
    const s = await seed();
    await fund(s.advertiser, 500);
    await deliverSlot(s, '2024-01-01', 8); // both créneaux delivered → spend = budget 200
    await deliverSlot(s, '2024-01-02', 8);
    mockSession(s.admin);
    expect((await reconcile(s.campaignId)).statusCode).toBe(201);
    const bal = await walletBalance(s.advertiser);
    expect(bal).toMatchObject({ credited_tnd: 500, debited_tnd: 200, balance_tnd: 300 });
  });

  it('a partial reconciliation debits only the delivered (the refund is netted in)', async () => {
    const s = await seed();
    await fund(s.advertiser, 500);
    await deliverSlot(s, '2024-01-01', 8); // 1 of 2 créneaux → spend = budget 200 − refund 100 = 100
    mockSession(s.admin);
    expect((await reconcile(s.campaignId)).statusCode).toBe(201);
    const bal = await walletBalance(s.advertiser);
    expect(bal).toMatchObject({ debited_tnd: 100, balance_tnd: 400 });
  });

  it('re-reconcile (409) does not double-debit', async () => {
    const s = await seed();
    await fund(s.advertiser, 500);
    await deliverSlot(s, '2024-01-01', 8);
    mockSession(s.admin);
    expect((await reconcile(s.campaignId)).statusCode).toBe(201);
    expect((await reconcile(s.campaignId)).statusCode).toBe(409);
    const bal = await walletBalance(s.advertiser);
    expect(bal.debited_tnd).toBe(100); // not 200
    expect(bal.balance_tnd).toBe(400);
  });
});
