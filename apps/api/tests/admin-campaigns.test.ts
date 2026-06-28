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
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';
import { campaignDispatchRoutes } from '../src/routes/campaign-dispatch.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. The ACTIVATION keystone: gate (pending + approved creative + funded)
// → dispatch (reuse runDispatch) → status='active'. Covering scenario mirrors campaign-dispatch.test:
// Ai=100, Hi=20, R=30 → capacité 60000; i_cible 20000 (budget 200 TND) is covered by 1 allocation.
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
      email: `act${seq}@example.com`,
      contactName: `User ${seq}`,
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

const seedCreative = async (
  advertiserId: string,
  validationStatus: 'pending' | 'approved' | 'rejected' = 'approved',
): Promise<string> => {
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/${advertiserId}/c`,
      durationSeconds: 20,
      validationStatus,
    })
    .returning();
  return c?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  opts: { status?: 'draft' | 'pending' | 'active' | 'rejected'; creativeId?: string | null } = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Activate Test',
      campaignType: 'standard',
      status: opts.status ?? 'pending',
      startDate: '2024-01-01', // Mon
      endDate: '2024-01-02', // Tue
      creativeId: opts.creativeId ?? null,
    })
    .returning();
  return c?.id ?? '';
};

const seedTargeting = async (campaignId: string, categoryId: string, cls: string) => {
  await db.insert(campaignTargeting).values({ campaignId, categoryId, class: cls as never });
};

const seedEligibleScreenhost = async (
  ownerId: string,
  categoryId: string,
  affluence: number,
): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: 'Venue',
      ownerId,
      businessSectorId: categoryId,
      class: 'premium' as never,
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: affluence });
  await db.insert(screenhostAffluence).values(rows);
  return id;
};

const fund = async (advertiserId: string, amountTnd: number): Promise<void> => {
  seq += 1;
  await db.insert(recharges).values({
    advertiserId,
    amountTnd: String(amountTnd),
    status: 'confirmed',
    reference: `REF-${seq}-${advertiserId.slice(0, 8)}`,
  });
};

// A fully activatable scenario: pending campaign + approved creative + a funded advertiser + targeting
// + one covering screenhost. Returns the ids the tests assert on.
const seedActivatable = async (
  over: {
    validationStatus?: 'pending' | 'approved' | 'rejected';
    fundTnd?: number;
    affluence?: number;
  } = {},
): Promise<{ admin: string; advertiser: string; campaignId: string }> => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({ role: 'advertiser' });
  const owner = await seedUser({ role: 'individual_owner' });
  const cat = await ownerSectorId();
  const creativeId = await seedCreative(advertiser, over.validationStatus ?? 'approved');
  const campaignId = await seedCampaign(advertiser, { status: 'pending', creativeId });
  await seedTargeting(campaignId, cat, 'premium');
  await seedEligibleScreenhost(owner, cat, over.affluence ?? 100);
  if (over.fundTnd !== undefined) await fund(advertiser, over.fundTnd);
  return { admin, advertiser, campaignId };
};

const ACTIVATE_BODY = { i_cible: 20000, cpm: 10, s: 10, t: 0.8 }; // budget = 200 TND

describe('admin campaign moderation — activation keystone (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminCampaignsRoutes);
    await app.register(campaignDispatchRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const activate = (id: string, body: Record<string, unknown> = ACTIVATE_BODY) =>
    app.inject({ method: 'POST', url: `/api/admin/campaigns/${id}/activate`, payload: body });
  const reject = (id: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/admin/campaigns/${id}/reject`, payload: body });

  it('activates a pending, approved, funded campaign with a dispatchable plan (→ active + frozen plan)', async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 500 });
    mockSession(admin);

    const res = await activate(campaignId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      campaign: { status: string; activated_by: string; activated_at: string };
      plan: { n_retenus: number };
      allocations: { screenhost_id: string }[];
    };
    expect(body.campaign.status).toBe('active');
    expect(body.campaign.activated_by).toBe(admin);
    expect(body.campaign.activated_at).not.toBeNull();
    expect(body.plan.n_retenus).toBe(1);
    expect(body.allocations).toHaveLength(1);

    // It now satisfies the L-playout gate's campaign side: status='active' + a frozen plan whose
    // allocation is ACCEPTE (the gate also checks creative-approved + window, asserted/owned elsewhere).
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    expect(campaign?.status).toBe('active');
    const [plan] = await db
      .select()
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId))
      .limit(1);
    expect(plan).toBeDefined();
    const allocs = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
    expect(allocs[0]?.statutAcceptation).toBe('ACCEPTE');
  });

  it('activates a campaign that was already dispatched (ALREADY_DISPATCHED → active)', async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 500 });
    mockSession(admin);
    // Freeze a plan via the existing entrypoint first (campaign stays pending).
    const pre = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/dispatch`,
      payload: ACTIVATE_BODY,
    });
    expect(pre.statusCode).toBe(201);

    const res = await activate(campaignId);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { campaign: { status: string } }).campaign.status).toBe('active');
  });

  it('blocks when the linked creative is not approved (422; not activated)', async () => {
    const { admin, campaignId } = await seedActivatable({
      validationStatus: 'pending',
      fundTnd: 500,
    });
    mockSession(admin);
    const res = await activate(campaignId);
    expect(res.statusCode).toBe(422);
    expect((res.json() as { reason: string }).reason).toBe('content_not_approved');
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    expect(c?.status).toBe('pending');
  });

  it('blocks when the advertiser is under-funded (422; not activated)', async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 50 }); // balance 50 < budget 200
    mockSession(admin);
    const res = await activate(campaignId);
    expect(res.statusCode).toBe(422);
    expect((res.json() as { reason: string }).reason).toBe('insufficient_balance');
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    expect(c?.status).toBe('pending');
  });

  it('blocks a non-pending campaign (409)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const creativeId = await seedCreative(advertiser, 'approved');
    const campaignId = await seedCampaign(advertiser, { status: 'draft', creativeId });
    await fund(advertiser, 500);
    mockSession(admin);
    const res = await activate(campaignId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { currentStatus: string }).currentStatus).toBe('draft');
  });

  it('too-thin dispatch → NOT activated; 422 alert; campaign stays pending; no plan frozen', async () => {
    // affluence 1 → capacité = ⌊1·20·30⌋ = 600 < seuil 1000; i_cible 1500 → N_min 3 > N_max 1.
    const { admin, campaignId } = await seedActivatable({ fundTnd: 500, affluence: 1 });
    mockSession(admin);
    const res = await activate(campaignId, { i_cible: 1500, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { reason: string }).reason).toBe('too_thin');
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    expect(c?.status).toBe('pending');
    const plans = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    expect(plans).toHaveLength(0);
  });

  it('rejects a pending campaign with a reason (→ rejected + reject_reason); re-reject 409s', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const campaignId = await seedCampaign(advertiser, { status: 'pending' });
    mockSession(admin);

    const res = await reject(campaignId, { reason: 'Creative violates guidelines' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; reject_reason: string; rejected_at: string };
    expect(body.status).toBe('rejected');
    expect(body.reject_reason).toBe('Creative violates guidelines');
    expect(body.rejected_at).not.toBeNull();

    const re = await reject(campaignId, { reason: 'again' });
    expect(re.statusCode).toBe(409);
  });

  it('reject requires a reason (400)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const campaignId = await seedCampaign(advertiser, { status: 'pending' });
    mockSession(admin);
    expect((await reject(campaignId, {})).statusCode).toBe(400);
  });

  it('the review queue lists campaigns with content-gate + wallet balance', async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 300 });
    mockSession(admin);
    const res = await app.inject({ method: 'GET', url: '/api/admin/campaigns?status=pending' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as {
      id: string;
      status: string;
      content_validation_status: string | null;
      wallet_balance_tnd: number;
    }[];
    const mine = rows.find((r) => r.id === campaignId);
    expect(mine?.status).toBe('pending');
    expect(mine?.content_validation_status).toBe('approved');
    expect(mine?.wallet_balance_tnd).toBe(300);
  });

  it('404 for a nonexistent campaign; 403 for a non-admin', async () => {
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    expect((await activate('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);

    const advertiser = await seedUser({ role: 'advertiser' });
    const campaignId = await seedCampaign(advertiser, { status: 'pending' });
    mockSession(advertiser, 'advertiser');
    expect((await activate(campaignId)).statusCode).toBe(403);
  });
});
