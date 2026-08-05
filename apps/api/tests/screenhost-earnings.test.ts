import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignReconciliation,
  campaignScreenhostPayout,
  campaigns,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. getSession is mocked to drive the owner identity. This exercises
// the first OWNER-FACING reader of campaign_screenhost_payout (L-redisp is the only writer): the
// owner sees ONLY their own screenhosts' earnings, owner-scoped in the WHERE like the WiFi routes —
// a two-owner test pins the no-cross-owner-leak invariant.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
interface EarningsLine {
  campaign_id: string;
  campaign_name: string;
  screenhost_id: string;
  screenhost_name: string;
  expected_imp: number;
  delivered_imp: number;
  earnings_tnd: number;
  reconciled_at: string;
}
interface EarningsResponse {
  total_tnd: number;
  lines: EarningsLine[];
}

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'individual_owner', status = 'approved'): void => {
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
      email: `earn${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (ownerId: string | null, name = 'Café Test'): Promise<string> => {
  const [s] = await db
    .insert(screenhosts)
    .values({ name, ...(ownerId ? { ownerId } : {}) })
    .returning();
  return s?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  name: string,
  values: Partial<typeof campaigns.$inferInsert> = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({ advertiserId, name, campaignType: 'standard', status: 'active', ...values })
    .returning();
  return c?.id ?? '';
};

// A campaign is reconciled ONCE (campaign_reconciliation has unique(campaign_id)), producing one
// payout row per screenhost. We write these directly (the reconcile pipeline itself is exercised by
// admin-reconcile.test) since this lane only adds the owner-facing READ over the joined tables.
const seedReconciliation = async (
  campaignId: string,
  reconciledBy: string,
  reconciledAt?: Date,
): Promise<string> => {
  const [recon] = await db
    .insert(campaignReconciliation)
    .values({
      campaignId,
      expectedImp: 0,
      deliveredImp: 0,
      manquementImp: 0,
      pPerteTnd: '0',
      refundTnd: '0',
      spendTnd: '0',
      status: 'reussie',
      reconciledBy,
      ...(reconciledAt ? { reconciledAt } : {}),
    })
    .returning();
  return recon?.id ?? '';
};

const seedPayout = async (params: {
  reconciliationId: string;
  campaignId: string;
  screenhostId: string;
  expectedImp: number;
  deliveredImp: number;
  earningsTnd: string;
}): Promise<void> => {
  await db.insert(campaignScreenhostPayout).values({
    reconciliationId: params.reconciliationId,
    campaignId: params.campaignId,
    screenhostId: params.screenhostId,
    expectedImp: params.expectedImp,
    deliveredImp: params.deliveredImp,
    earningsTnd: params.earningsTnd,
  });
};

afterAll(async () => {
  await sql.end();
});

describe('screenhost earnings read (owner-scoped, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const get = () => app.inject({ method: 'GET', url: '/api/screenhosts/earnings' });

  it('returns ONLY the caller’s payouts + a numeric total (no cross-owner leak)', async () => {
    const me = await seedUser();
    const advertiser = await seedUser({ role: 'advertiser' });
    const admin = await seedUser({ role: 'admin' });
    const myShA = await seedScreenhost(me, 'Mon Café A');
    const myShB = await seedScreenhost(me, 'Mon Café B');

    // Another owner with their OWN screenhost + payout — must NOT bleed into my read.
    const other = await seedUser();
    const otherSh = await seedScreenhost(other, 'Autre Café');

    const campaign1 = await seedCampaign(advertiser, 'Campagne Été');
    const campaign2 = await seedCampaign(advertiser, 'Campagne Hiver');

    // campaign1 reconciled once → payouts for MY venue A AND the other owner's venue (same
    // reconciliation, exactly as L-redisp writes them). The other owner's row is the leak surface.
    const recon1 = await seedReconciliation(campaign1, admin, new Date('2026-06-20T10:00:00Z'));
    await seedPayout({
      reconciliationId: recon1,
      campaignId: campaign1,
      screenhostId: myShA,
      expectedImp: 10000,
      deliveredImp: 8000,
      earningsTnd: '80.5000',
    });
    await seedPayout({
      reconciliationId: recon1,
      campaignId: campaign1,
      screenhostId: otherSh,
      expectedImp: 9999,
      deliveredImp: 9999,
      earningsTnd: '999.0000',
    });
    // campaign2 reconciled later → payout for MY venue B.
    const recon2 = await seedReconciliation(campaign2, admin, new Date('2026-06-25T10:00:00Z'));
    await seedPayout({
      reconciliationId: recon2,
      campaignId: campaign2,
      screenhostId: myShB,
      expectedImp: 5000,
      deliveredImp: 5000,
      earningsTnd: '50.2500',
    });

    mockSession(me);
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json() as EarningsResponse;

    // Exactly my two lines, none of the other owner's.
    expect(body.lines).toHaveLength(2);
    expect(body.lines.every((l) => l.screenhost_id === myShA || l.screenhost_id === myShB)).toBe(
      true,
    );
    expect(body.lines.some((l) => l.screenhost_id === otherSh)).toBe(false);

    // Sum is NUMERIC (80.5 + 50.25 = 130.75), not the string-concatenated "80.500050.2500".
    expect(body.total_tnd).toBeCloseTo(130.75, 4);
    expect(typeof body.total_tnd).toBe('number');

    // Newest reconciliation first (desc).
    expect(body.lines[0]?.campaign_name).toBe('Campagne Hiver');
    expect(body.lines[1]?.campaign_name).toBe('Campagne Été');

    // Per-line projection is faithful (campaign + venue labels, imps, earnings as a number).
    const winter = body.lines.find((l) => l.campaign_name === 'Campagne Hiver');
    expect(winter).toMatchObject({
      screenhost_name: 'Mon Café B',
      expected_imp: 5000,
      delivered_imp: 5000,
      earnings_tnd: 50.25,
    });
    // NET-IMP1 — display_imp rides every line: affichées = prédites − perdues, which for a
    // settled row converges to delivered (no manquement here → equals expected too).
    expect((winter as unknown as Record<string, unknown>)['display_imp']).toBe(5000);
  });

  it('Lane F additivity: lines gain campaign_start/_end/_type/_status; the OLD keys are unchanged', async () => {
    const me = await seedUser();
    const advertiser = await seedUser({ role: 'advertiser' });
    const admin = await seedUser({ role: 'admin' });
    const mySh = await seedScreenhost(me, 'Mon Café');
    const campaign = await seedCampaign(advertiser, 'Campagne Datée', {
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      campaignType: 'standard',
      status: 'active',
    });
    const recon = await seedReconciliation(campaign, admin, new Date('2026-06-01T10:00:00Z'));
    await seedPayout({
      reconciliationId: recon,
      campaignId: campaign,
      screenhostId: mySh,
      expectedImp: 10000,
      deliveredImp: 8000,
      earningsTnd: '80.5000',
    });
    mockSession(me);

    const res = await get();
    expect(res.statusCode).toBe(200);
    const line = (res.json() as EarningsResponse).lines[0] as unknown as Record<string, unknown>;

    // Old contract byte-identical (OwnerRevenue + OwnerDashboard consume these).
    expect(line).toMatchObject({
      campaign_id: campaign,
      campaign_name: 'Campagne Datée',
      screenhost_id: mySh,
      screenhost_name: 'Mon Café',
      expected_imp: 10000,
      delivered_imp: 8000,
      earnings_tnd: 80.5,
    });
    // The additive Lane F keys.
    expect(line).toMatchObject({
      campaign_start: '2026-05-01',
      campaign_end: '2026-05-31',
      campaign_type: 'standard',
      campaign_status: 'active',
    });
    // NET-IMP1 additive key — a settled row with manquement: affichées = 10000 − 2000 = 8000,
    // reconcile's own identity (= delivered, NEVER raw expected).
    expect(line).toMatchObject({ display_imp: 8000 });
    // The FULL key set is pinned — an accidental rename/removal of an old key fails here.
    expect(Object.keys(line).sort()).toEqual([
      'campaign_end',
      'campaign_id',
      'campaign_name',
      'campaign_start',
      'campaign_status',
      'campaign_type',
      'delivered_imp',
      'display_imp',
      'earnings_tnd',
      'expected_imp',
      'reconciled_at',
      'screenhost_id',
      'screenhost_name',
    ]);
  });

  it('returns an empty list + zero total when nothing is reconciled (honest empty state)', async () => {
    const me = await seedUser();
    await seedScreenhost(me, 'Café Sans Revenus');
    mockSession(me);

    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json() as EarningsResponse;
    expect(body.lines).toEqual([]);
    expect(body.total_tnd).toBe(0);
  });

  it('does not leak a payout written for an ownerless (null-owner) screenhost', async () => {
    const me = await seedUser();
    const advertiser = await seedUser({ role: 'advertiser' });
    const admin = await seedUser({ role: 'admin' });
    const orphan = await seedScreenhost(null, 'Orphan');
    const campaign = await seedCampaign(advertiser, 'Campagne Orpheline');
    const recon = await seedReconciliation(campaign, admin);
    await seedPayout({
      reconciliationId: recon,
      campaignId: campaign,
      screenhostId: orphan,
      expectedImp: 1000,
      deliveredImp: 1000,
      earningsTnd: '10.0000',
    });
    mockSession(me);

    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json() as EarningsResponse;
    // eq(ownerId, userId) never matches NULL — the orphan's payout stays invisible to everyone.
    expect(body.lines).toEqual([]);
    expect(body.total_tnd).toBe(0);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    expect((await get()).statusCode).toBe(401);
  });

  it('forbids a rejected owner (403, requireActiveAccount)', async () => {
    const me = await seedUser({ status: 'rejected' });
    await seedScreenhost(me, 'Café Rejeté');
    mockSession(me, 'individual_owner', 'rejected');
    expect((await get()).statusCode).toBe(403);
  });

  it('forbids a banned owner (403, requireActiveAccount)', async () => {
    const me = await seedUser({ status: 'banned' });
    mockSession(me, 'individual_owner', 'banned');
    expect((await get()).statusCode).toBe(403);
  });
});
