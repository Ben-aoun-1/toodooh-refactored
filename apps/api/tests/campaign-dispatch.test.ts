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
  campaignZones,
  campaigns,
  notifications,
  screenhostAffluence,
  screenhosts,
  users,
  zones,
} from '../src/db/schema.js';
import { campaignDispatchRoutes } from '../src/routes/campaign-dispatch.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. End-to-end dispatch: a well-formed campaign + targeting + eligible
// screenhosts + affluence → a frozen PlanDiffusion. Config is the seeded V1 singleton.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type PlanResponse = {
  plan: {
    couvert: number;
    n_retenus: number;
    s_min: number;
    g_jour: number;
    is_partial: boolean;
    is_too_thin: boolean;
  };
  allocations: { screenhost_id: string; ii_potentiel: number; r_i: number; creneaux: unknown[] }[];
};

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
      email: `disp${seq}@example.com`,
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

const seedCampaign = async (
  advertiserId: string,
  opts: { start?: string | null; end?: string | null } = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Dispatch Test',
      campaignType: 'standard',
      status: 'draft',
      startDate: opts.start === undefined ? '2024-01-01' : opts.start, // Mon
      endDate: opts.end === undefined ? '2024-01-02' : opts.end, // Tue
    })
    .returning();
  return c?.id ?? '';
};

const seedTargeting = async (campaignId: string, categoryId: string | null, cls: string | null) => {
  await db.insert(campaignTargeting).values({ campaignId, categoryId, class: cls as never });
};

// An eligible venue: category × class set, horaires 8–18, capacity present, affluence on Mon+Tue.
const seedEligibleScreenhost = async (
  ownerId: string,
  categoryId: string,
  cls: string,
  affluence = 100,
): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: 'Venue',
      ownerId,
      businessSectorId: categoryId,
      class: cls as never,
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

describe('campaign dispatch entrypoint (L-disp, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
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

  const dispatch = (id: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/campaigns/${id}/dispatch`, payload: body });

  it('builds + freezes a covering plan; re-dispatch is 409 (irrevocable)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await seedEligibleScreenhost(owner, cat, 'premium', 100);
    mockSession(admin);

    // Ai=100, Hi=2×10=20, R=min((3600/10)·0.8, 300/10)=30 → capacité=60000. i_cible 20000 < 60000.
    const res = await dispatch(campaignId, { i_cible: 20000, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(body.plan.couvert).toBe(20000);
    expect(body.plan.n_retenus).toBe(1);
    expect(body.plan.is_partial).toBe(false);
    expect(body.plan.is_too_thin).toBe(false);
    expect(body.plan.s_min).toBe(10); // 1000 × 10 / 1000
    expect(body.plan.g_jour).toBeCloseTo(100 / 30, 4);
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0]?.ii_potentiel).toBe(20000);
    expect(body.allocations[0]?.r_i).toBe(10); // clamp(20000/(100·20)=10, 2, 30)
    expect(body.allocations[0]?.creneaux.length).toBe(20); // 2 days × 10 broadcast hours

    expect(
      (await dispatch(campaignId, { i_cible: 20000, cpm: 10, s: 10, t: 0.8 })).statusCode,
    ).toBe(409);
  });

  // ── CF-Z1 — the zone clause: [Grand Tunis] ≡ no zones today (prod is entirely Grand Tunis);
  // a foreign zone empties the pool. ─────────────────────────────────────────────────────────────
  const GRAND_TUNIS_ID = '2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f';

  it('NO-BEHAVIOR-CHANGE: a campaign zoned [Grand Tunis] dispatches EXACTLY like a no-zones one', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await db.insert(campaignZones).values({ campaignId, zoneId: GRAND_TUNIS_ID });
    await seedEligibleScreenhost(owner, cat, 'premium', 100); // zone_id: the GT column DEFAULT
    mockSession(admin);

    // The SAME fixture + assertions as the no-zones happy path above — the clause changes nothing.
    const res = await dispatch(campaignId, { i_cible: 20000, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(body.plan.couvert).toBe(20000);
    expect(body.plan.n_retenus).toBe(1);
    expect(body.plan.is_partial).toBe(false);
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0]?.ii_potentiel).toBe(20000);
    expect(body.allocations[0]?.r_i).toBe(10);
  });

  it('a campaign zoned to a DIFFERENT zone excludes Grand-Tunis venues (422 empty pool)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const [sfax] = await db
      .insert(zones)
      .values({ name: `Grand Sfax ${Date.now()}-${(seq += 1)}`, active: true })
      .returning();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await db.insert(campaignZones).values({ campaignId, zoneId: sfax?.id ?? '' });
    await seedEligibleScreenhost(owner, cat, 'premium', 100); // Grand Tunis by default
    mockSession(admin);

    const res = await dispatch(campaignId, { i_cible: 20000, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(422); // NOT_DELIVERABLE — the zone clause emptied the pool
  });

  it('flags PARTIAL when the pool cannot cover I_cible', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await seedEligibleScreenhost(owner, cat, 'premium', 100); // capacité 60000
    mockSession(admin);

    const res = await dispatch(campaignId, { i_cible: 200000, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(body.plan.is_partial).toBe(true);
    expect(body.plan.couvert).toBeLessThan(200000);
  });

  it('too-thin → 422 NOT_DELIVERABLE, not frozen, re-dispatchable (never 409-locks)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await seedEligibleScreenhost(owner, cat, 'premium', 1); // capacité = ⌊1·20·30⌋ = 600 < seuil 1000
    mockSession(admin);

    // N_min ⌈1500/600⌉=3 > N_max ⌊1500/1000⌋=1 → too thin → clôture alert, NOT frozen.
    const res = await dispatch(campaignId, { i_cible: 1500, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { reason: string }).reason).toBe('too_thin');

    // Nothing was persisted...
    const plans = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    expect(plans).toHaveLength(0);

    // ...so a re-dispatch is the SAME 422 (renvoi curseur), never a 409 irrevocable lock.
    expect((await dispatch(campaignId, { i_cible: 1500, cpm: 10, s: 10, t: 0.8 })).statusCode).toBe(
      422,
    );
  });

  it('non-uniform affluence does not crash persistence (integer couvert/ii_potentiel)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    // 20 broadcast slots; total 2001 → avg 100.05 → capacité = ⌊100.05·20·30⌋ = 60030. The raw FP
    // product is 60030.0000…7, which would crash an `integer` column if persisted unrounded.
    const [sh] = await db
      .insert(screenhosts)
      .values({
        name: 'NonUniform',
        ownerId: owner,
        businessSectorId: cat,
        class: 'premium' as never,
        openingHour: 8,
        closingHour: 18,
        broadcastCapacity: 4,
      })
      .returning();
    const rows: {
      screenhostId: string;
      dayOfWeek: number;
      hour: number;
      estimatedImpressions: number;
    }[] = [];
    let bumped = false;
    for (const dow of [1, 2])
      for (let h = 8; h < 18; h += 1) {
        rows.push({
          screenhostId: sh?.id ?? '',
          dayOfWeek: dow,
          hour: h,
          estimatedImpressions: bumped ? 100 : 101, // one slot 101, the rest 100 → total 2001
        });
        bumped = true;
      }
    await db.insert(screenhostAffluence).values(rows);
    mockSession(admin);

    // i_cible 100000 > capacité 60030 → the SH's full residual is allocated (the fractional path).
    const res = await dispatch(campaignId, { i_cible: 100000, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(Number.isInteger(body.plan.couvert)).toBe(true);
    expect(body.plan.couvert).toBe(60030);
    expect(body.plan.is_partial).toBe(true);
    expect(Number.isInteger(body.allocations[0]?.ii_potentiel ?? -1)).toBe(true);
  });

  it('400 when the campaign has no targeting', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const campaignId = await seedCampaign(advertiser);
    mockSession(admin);
    expect((await dispatch(campaignId, { i_cible: 1000, cpm: 10, s: 10, t: 0.8 })).statusCode).toBe(
      400,
    );
  });

  it('400 when the campaign has no window (start/end date)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser, { start: null, end: null });
    await seedTargeting(campaignId, cat, 'premium');
    mockSession(admin);
    expect((await dispatch(campaignId, { i_cible: 1000, cpm: 10, s: 10, t: 0.8 })).statusCode).toBe(
      400,
    );
  });

  it('404 for a nonexistent campaign', async () => {
    const admin = await seedUser({ role: 'admin' });
    mockSession(admin);
    expect(
      (
        await dispatch('00000000-0000-0000-0000-000000000000', {
          i_cible: 1000,
          cpm: 10,
          s: 10,
          t: 0.8,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('403 for a non-admin', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const campaignId = await seedCampaign(advertiser);
    mockSession(advertiser, 'advertiser');
    expect((await dispatch(campaignId, { i_cible: 1000, cpm: 10, s: 10, t: 0.8 })).statusCode).toBe(
      403,
    );
  });

  // ── cross-campaign F-second cap (mixed spot durations) ───────────────────────
  const allocsFor = async (campaignId: string) => {
    const [plan] = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId))
      .limit(1);
    return db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
  };

  it('a 30s campaign filling the hour (300s) blocks a 10s campaign on the same screen', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advA = await seedUser({ role: 'advertiser' });
    const advB = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    await seedEligibleScreenhost(owner, cat, 'premium', 100); // Hi=20; capacity is not the binding limit
    const a = await seedCampaign(advA);
    await seedTargeting(a, cat, 'premium');
    const b = await seedCampaign(advB);
    await seedTargeting(b, cat, 'premium');
    mockSession(admin);

    // A: S=30 → R_eff = MIN[(3600/30)·0.8=96, 300/30=10] = 10 → r_i 10 → 10×30 = 300s (full hour).
    expect((await dispatch(a, { i_cible: 20000, cpm: 10, s: 30, t: 0.8 })).statusCode).toBe(201);
    const [aAlloc] = await allocsFor(a);
    expect(aAlloc?.rI).toBe(10);
    expect((aAlloc?.rI ?? 0) * 30).toBe(300);

    // B: S=10 → the screen's residual budget is 0 → no eligible screenhost → 422 (NOT double-booked
    // onto the full hour, which the old impression-based residual would have allowed).
    expect((await dispatch(b, { i_cible: 20000, cpm: 10, s: 10, t: 0.8 })).statusCode).toBe(422);
  });

  it('mixed durations on a shared screen honour the invariant Σ(r_i × S) ≤ 300', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advA = await seedUser({ role: 'advertiser' });
    const advB = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    await seedEligibleScreenhost(owner, cat, 'premium', 100); // Hi=20
    const a = await seedCampaign(advA);
    await seedTargeting(a, cat, 'premium');
    const b = await seedCampaign(advB);
    await seedTargeting(b, cat, 'premium');
    mockSession(admin);

    // A: S=30, T=0.05 → R_eff = MIN[(3600/30)·0.05=6, 10] = 6; a huge I_cible fills the SH → r_i 6.
    expect((await dispatch(a, { i_cible: 10_000_000, cpm: 10, s: 30, t: 0.05 })).statusCode).toBe(
      201,
    );
    const [aAlloc] = await allocsFor(a);
    expect(aAlloc?.rI).toBe(6); // 6×30 = 180s

    // B: S=10, T=0.8. Engaged 180s → residual 120s → R_eff = MIN[288, ⌊120/10⌋=12] = 12 → r_i 12
    // (the old impression-residual would have given 24 → 240s → 420s/hr total — the bug).
    expect((await dispatch(b, { i_cible: 10_000_000, cpm: 10, s: 10, t: 0.8 })).statusCode).toBe(
      201,
    );
    const [bAlloc] = await allocsFor(b);
    expect(bAlloc?.rI).toBe(12); // 12×10 = 120s

    // INVARIANT: Σ over both campaigns of (reps/hr × S) ≤ 300s/hr on the shared screen.
    const totalSeconds = (aAlloc?.rI ?? 0) * 30 + (bAlloc?.rI ?? 0) * 10;
    expect(totalSeconds).toBe(300);
    expect(totalSeconds).toBeLessThanOrEqual(300);
  });

  // ── PRODUCER — dispatch notifies each allocated screenhost owner ─────────────
  const notifsFor = (userId: string) =>
    db.select().from(notifications).where(eq(notifications.userId, userId));

  it('notifies EACH distinct allocated screenhost owner once (pending acceptance)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner1 = await seedUser({ role: 'individual_owner' });
    const owner2 = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser); // name 'Dispatch Test'
    await seedTargeting(campaignId, cat, 'premium');
    const sh1 = await seedEligibleScreenhost(owner1, cat, 'premium', 100); // capacité 60000
    const sh2 = await seedEligibleScreenhost(owner2, cat, 'premium', 100); // capacité 60000
    mockSession(admin);

    // i_cible 100000 > a single SH's 60000 → N_min=2 → both SHs allocated → both owners notified.
    const res = await dispatch(campaignId, { i_cible: 100000, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(201);

    const allocs = await allocsFor(campaignId);
    const allocatedScreenhostIds = new Set(allocs.map((a) => a.screenhostId));
    expect(allocatedScreenhostIds).toEqual(new Set([sh1, sh2]));

    const n1 = await notifsFor(owner1);
    const n2 = await notifsFor(owner2);
    expect(n1).toHaveLength(1);
    expect(n2).toHaveLength(1);
    expect(n1[0]).toMatchObject({
      type: 'dispatch_pending_acceptance',
      title: 'Campagne en attente de votre acceptation',
      campaignId,
    });
    expect(n1[0]?.body).toContain('Dispatch Test');
    expect(n1[0]?.readAt).toBeNull();
  });

  it('dedupes — an owner with several allocated venues gets ONE notification', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await seedEligibleScreenhost(owner, cat, 'premium', 100);
    await seedEligibleScreenhost(owner, cat, 'premium', 100);
    mockSession(admin);

    const res = await dispatch(campaignId, { i_cible: 100000, cpm: 10, s: 10, t: 0.8 });
    expect(res.statusCode).toBe(201);

    // Two allocations (both venues), one owner → exactly one notification.
    const allocs = await allocsFor(campaignId);
    expect(allocs).toHaveLength(2);
    expect(await notifsFor(owner)).toHaveLength(1);
  });
});
