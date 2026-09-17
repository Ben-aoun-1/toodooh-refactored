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
import { adminDispatchConfigRoutes } from '../src/routes/admin-dispatch-config.js';
import { campaignDispatchRoutes } from '../src/routes/campaign-dispatch.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

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
  durationSeconds: number | null = 20,
): Promise<string> => {
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/${advertiserId}/c`,
      durationSeconds,
      validationStatus,
    })
    .returning();
  return c?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  opts: {
    status?: 'draft' | 'pending' | 'active' | 'rejected';
    creativeId?: string | null;
    // The advertiser's indicative ask (TND); the activation derives i_cible from it. Defaults to a
    // budget that yields a coverable target at the standard CPM (300 → ⌊300·1000/15⌋ = 20000). `null`
    // = no budget (the no_budget gate).
    requestedBudgetTnd?: number | null;
    campaignType?: string;
    startDate?: string;
    endDate?: string;
  } = {},
): Promise<string> => {
  const requestedBudget =
    opts.requestedBudgetTnd === undefined
      ? '300'
      : opts.requestedBudgetTnd === null
        ? null
        : String(opts.requestedBudgetTnd);
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Activate Test',
      campaignType: opts.campaignType ?? 'standard',
      status: opts.status ?? 'pending',
      startDate: opts.startDate ?? '2024-01-01', // Mon
      endDate: opts.endDate ?? '2024-01-02', // Tue
      creativeId: opts.creativeId ?? null,
      requestedBudget,
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
  await db.insert(screenhostAffluence).values(bothHalves(rows));
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
    requestedBudgetTnd?: number | null;
    durationSeconds?: number | null;
    campaignType?: string;
  } = {},
): Promise<{ admin: string; advertiser: string; campaignId: string }> => {
  const admin = await seedUser({ role: 'admin' });
  const advertiser = await seedUser({ role: 'advertiser' });
  const owner = await seedUser({ role: 'individual_owner' });
  const cat = await ownerSectorId();
  const creativeId = await seedCreative(
    advertiser,
    over.validationStatus ?? 'approved',
    over.durationSeconds === undefined ? 20 : over.durationSeconds,
  );
  const campaignId = await seedCampaign(advertiser, {
    status: 'pending',
    creativeId,
    requestedBudgetTnd: over.requestedBudgetTnd,
    campaignType: over.campaignType,
  });
  await seedTargeting(campaignId, cat, 'premium');
  await seedEligibleScreenhost(owner, cat, over.affluence ?? 100);
  if (over.fundTnd !== undefined) await fund(advertiser, over.fundTnd);
  return { admin, advertiser, campaignId };
};

// The reshaped activate takes NO body — the engine inputs are derived. The public /dispatch endpoint
// (used by the ALREADY_DISPATCHED test) is unchanged and still takes explicit inputs.
const DISPATCH_BODY = { i_cible: 20000, cpm: 10, s: 10, t: 0.8 };

describe('admin campaign moderation — activation keystone (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminCampaignsRoutes);
    await app.register(adminDispatchConfigRoutes);
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

  const activate = (id: string) =>
    app.inject({ method: 'POST', url: `/api/admin/campaigns/${id}/activate` });
  const reject = (id: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/admin/campaigns/${id}/reject`, payload: body });

  it('activates a pending, approved, funded campaign with a dispatchable plan (→ active + frozen plan)', async () => {
    // budget 300 @ standard CPM 15 → i_cible 20000; creative duration 20 → s; t 1.0. capacité (s=20)
    // = ⌊100·20·15⌋ = 30000 ≥ 20000 → covered by 1 allocation.
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

    // It now satisfies the L-playout gate's campaign side: status='active' + a frozen plan. The
    // allocation lands EN_ATTENTE (the new default): dispatch no longer auto-airs — the screenhost
    // owner must accept it first (the gate also checks creative-approved + window, owned elsewhere).
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
    // The plan snapshots the DERIVED inputs (not an admin body): i_cible from budget@CPM, cpm=15,
    // s=creative duration 20 → E1: t = t_20s = 0.7 (the attention index, duration-derived).
    expect(plan?.iCible).toBe(20000);
    expect(Number(plan?.cpm)).toBe(15);
    expect(plan?.sSpotSeconds).toBe(20);
    expect(Number(plan?.tTierCoef)).toBe(0.7);
    const allocs = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
    expect(allocs[0]?.statutAcceptation).toBe('EN_ATTENTE');
  });

  it('prices an event campaign at event_cpm_tnd (plan cpm = 30)', async () => {
    // event campaign, budget 600 @ event CPM 30 → i_cible 20000 (coverable); funded 700.
    // EV2 (architect override): the 30 is THIS test's explicit fixture, self-seeded on the live
    // dispatch_config singleton and restored after — migration 0056 moved the column's default
    // to 15, so inheriting the row's value would couple the pin to migration/test order.
    // FIX2 hygiene — the previous bare UPDATE was a NO-OP whenever an earlier suite's cleanup
    // left dispatch_config EMPTY (order-luck: the read then fell back to the 15 default and this
    // pin failed). Insert-or-update, and drop the row again only if THIS test created it.
    const [cfgBefore] = await sql`select event_cpm_tnd from dispatch_config`;
    if (cfgBefore === undefined) {
      await sql`insert into dispatch_config (seuil_diffusable, g_mois, jours_actifs, r_min_efficace, event_cpm_tnd)
        values (1000, '100', 30, 2, '30.000')`;
    } else {
      await sql`update dispatch_config set event_cpm_tnd = '30.000'`;
    }
    try {
      const { admin, campaignId } = await seedActivatable({
        fundTnd: 700,
        requestedBudgetTnd: 600,
        campaignType: 'event',
      });
      mockSession(admin);
      const res = await activate(campaignId);
      expect(res.statusCode).toBe(200);
      const [plan] = await db
        .select()
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, campaignId))
        .limit(1);
      expect(Number(plan?.cpm)).toBe(30);
      expect(plan?.iCible).toBe(20000);
    } finally {
      const restore = cfgBefore?.['event_cpm_tnd'] as string | undefined;
      if (restore !== undefined) await sql`update dispatch_config set event_cpm_tnd = ${restore}`;
      else await sql`delete from dispatch_config`;
    }
  });

  // CPM-ADMIN SEAM (Mejri 05/08), amended by CPM-1 (user rule, 2026-09-17) — the engine consumes
  // the ADMIN-SAVED CPM for the campaigns CREATED AFTER the save (PATCH /api/admin/dispatch-config,
  // not SQL — the exact write the Tarification page performs). A campaign that already existed
  // keeps the CPM in effect at its creation: budget 300 @ 15 → i_cible 20000. One created after
  // the save derives at 20 → i_cible = ⌊300·1000/20⌋ = 15000 (capacité 30000 still covers).
  // Snapshot/restore mirrors the event-CPM pin above: the route self-heals an EMPTY singleton, so
  // drop the row again only if this test's PATCH created it.
  it('a CPM saved via the admin route prices the campaigns created after it; an existing one keeps its own', async () => {
    const [cfgBefore] = await sql`select standard_cpm_tnd from dispatch_config`;
    try {
      if (cfgBefore !== undefined)
        await sql`update dispatch_config set standard_cpm_tnd = '15.000'`;
      const { admin, campaignId: existing } = await seedActivatable({ fundTnd: 500 });
      mockSession(admin);

      const saved = await app.inject({
        method: 'PATCH',
        url: '/api/admin/dispatch-config',
        payload: { standard_cpm_tnd: 20 },
      });
      expect(saved.statusCode).toBe(200);
      expect((saved.json() as { standard_cpm_tnd: number }).standard_cpm_tnd).toBe(20);
      const { campaignId: created } = await seedActivatable({ fundTnd: 500 });

      const planOf = async (campaignId: string) => {
        const [plan] = await db
          .select()
          .from(campaignDispatchPlan)
          .where(eq(campaignDispatchPlan.campaignId, campaignId))
          .limit(1);
        return plan;
      };
      expect((await activate(existing)).statusCode).toBe(200);
      const kept = await planOf(existing);
      expect(Number(kept?.cpm)).toBe(15);
      expect(kept?.iCible).toBe(20000);

      expect((await activate(created)).statusCode).toBe(200);
      const repriced = await planOf(created);
      expect(Number(repriced?.cpm)).toBe(20);
      expect(repriced?.iCible).toBe(15000);
    } finally {
      const restore = cfgBefore?.['standard_cpm_tnd'] as string | undefined;
      if (restore !== undefined)
        await sql`update dispatch_config set standard_cpm_tnd = ${restore}`;
      else await sql`delete from dispatch_config`;
    }
  });

  it('blocks activation when the campaign has no indicative budget (422 no_budget; not activated)', async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 500, requestedBudgetTnd: null });
    mockSession(admin);
    const res = await activate(campaignId);
    expect(res.statusCode).toBe(422);
    expect((res.json() as { reason: string }).reason).toBe('no_budget');
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    expect(c?.status).toBe('pending');
  });

  it('blocks activation when the linked creative has no duration (422 no_duration; not activated)', async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 500, durationSeconds: null });
    mockSession(admin);
    const res = await activate(campaignId);
    expect(res.statusCode).toBe(422);
    expect((res.json() as { reason: string }).reason).toBe('no_duration');
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    expect(c?.status).toBe('pending');
  });

  it('activates a campaign that was already dispatched (ALREADY_DISPATCHED → active)', async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 500 });
    mockSession(admin);
    // Freeze a plan via the existing (unchanged) entrypoint first (campaign stays pending).
    const pre = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/dispatch`,
      payload: DISPATCH_BODY,
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
    const { admin, campaignId } = await seedActivatable({ fundTnd: 50 }); // balance 50 < budget 300
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
    // affluence 1, s=20 → capacité = ⌊1·20·15⌋ = 300 < seuil 1000. budget 22.5 @ CPM 15 → i_cible
    // 1500 → N_min ⌈1500/300⌉ = 5 > N_max ⌊1500/1000⌋ = 1 → too thin.
    const { admin, campaignId } = await seedActivatable({
      fundTnd: 500,
      affluence: 1,
      requestedBudgetTnd: 22.5,
    });
    mockSession(admin);
    const res = await activate(campaignId);
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

  it('the review queue lists campaigns with content-gate + wallet balance + requested_budget + derived pricing', async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 300, requestedBudgetTnd: 450 });
    mockSession(admin);
    const res = await app.inject({ method: 'GET', url: '/api/admin/campaigns?status=pending' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as {
      id: string;
      status: string;
      content_validation_status: string | null;
      wallet_balance_tnd: number;
      requested_budget: number | null;
      cpm_tnd: number;
      derived_i_cible: number | null;
    }[];
    const mine = rows.find((r) => r.id === campaignId);
    expect(mine?.status).toBe('pending');
    expect(mine?.content_validation_status).toBe('approved');
    expect(mine?.wallet_balance_tnd).toBe(300);
    expect(mine?.requested_budget).toBe(450);
    // Derived for the operator: standard CPM 15 → i_cible ⌊450·1000/15⌋ = 30000.
    expect(mine?.cpm_tnd).toBe(15);
    expect(mine?.derived_i_cible).toBe(30000);
  });

  // FIX2 amendment pin — the queue serves THE FIGURE THE ACTIVATION GATE ENFORCES: spendable
  // excluding the row's own campaign. Funds engaged by ANOTHER unsettled campaign drop the
  // figure; the row's own ask never double-charges it (the 300-funded case above stays 300).
  it("the queue figure is spendable EXCLUDING the row's own ask — other engagements drop it (FIX2)", async () => {
    const { admin, advertiser, campaignId } = await seedActivatable({
      fundTnd: 300,
      requestedBudgetTnd: 450,
    });
    // FIX2b — engagement requires a LIVE window (end ≥ Tunis today); the helper's default
    // 2024 dates would make this a zombie and the figure would not drop.
    await seedCampaign(advertiser, {
      status: 'active',
      requestedBudgetTnd: 120,
      startDate: '2026-01-01',
      endDate: '2030-01-01',
    });
    mockSession(admin);
    const res = await app.inject({ method: 'GET', url: '/api/admin/campaigns?status=pending' });
    const rows = res.json() as { id: string; wallet_balance_tnd: number }[];
    // 300 funded − 120 engaged elsewhere = 180; the row's own 450 ask is EXCLUDED.
    expect(rows.find((r) => r.id === campaignId)?.wallet_balance_tnd).toBe(180);
  });

  it('the review queue surfaces a null derived_i_cible for a budget-less campaign', async () => {
    const { admin, campaignId } = await seedActivatable({ requestedBudgetTnd: null });
    mockSession(admin);
    const res = await app.inject({ method: 'GET', url: '/api/admin/campaigns?status=pending' });
    const rows = res.json() as { id: string; derived_i_cible: number | null }[];
    expect(rows.find((r) => r.id === campaignId)?.derived_i_cible).toBeNull();
  });

  it("CF-S1: a FUTURE-dated approval routes to 'upcoming' (dispatch still runs at approval)", async () => {
    const { admin, campaignId } = await seedActivatable({ fundTnd: 500 });
    mockSession(admin);
    // Re-window the pending campaign into the future (Mon/Tue 2027 — same weekdays as the
    // affluence fixture, so dispatch still covers).
    await db
      .update(campaigns)
      .set({ startDate: '2027-01-04', endDate: '2027-01-05' })
      .where(eq(campaigns.id, campaignId));
    const res = await activate(campaignId);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { campaign: { status: string }; plan: unknown };
    expect(body.campaign.status).toBe('upcoming');
    expect(body.plan).toBeDefined(); // the plan froze at approval regardless of the routing
    const [row] = await db
      .select({ status: campaigns.status, activatedAt: campaigns.activatedAt })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(row?.status).toBe('upcoming');
    expect(row?.activatedAt).not.toBeNull(); // the approval stamp is set either way
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
