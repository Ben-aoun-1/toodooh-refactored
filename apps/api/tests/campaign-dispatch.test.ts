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

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';
import { sweepZones } from './helpers/zones.js';

// Integration — real Postgres. End-to-end dispatch: a well-formed campaign + targeting + eligible
// screenhosts + affluence → a frozen PlanDiffusion. Config is the seeded V1 singleton.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type PlanResponse = {
  plan: {
    couvert: number;
    n_retenus: number;
    s_min: number;
    g_jour: number;
    seuil_diffusable: number;
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
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);
  return id;
};

describe('campaign dispatch entrypoint (L-disp, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  // TEST-ISO1 — zones survive resetAuthTables (global table) and another file pins the exact
  // zone catalogue: every zone a test inserts is tracked here and swept in afterEach.
  const createdZoneIds: string[] = [];

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(campaignDispatchRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await sweepZones(createdZoneIds.splice(0));
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

    // E1: s=10 → T=0.6. Ai=100, Hi=2×10=20, R=min(3600/10, 300/10)=30 → brut 60000 →
    // FACTURABLE = 36000. i_cible 20000 < 36000.
    const res = await dispatch(campaignId, { i_cible: 20000, cpm: 10, s: 10 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(body.plan.couvert).toBe(20000);
    expect(body.plan.n_retenus).toBe(1);
    expect(body.plan.is_partial).toBe(false);
    expect(body.plan.is_too_thin).toBe(false);
    // E3 amendment — the seuil is VALUE-based: seuilImpressions(10) = 2000 → S_min = 20 TND
    // (was 10 when config seuil_diffusable=1000 fed dispatch).
    expect(body.plan.s_min).toBe(20);
    expect(body.plan.seuil_diffusable).toBe(2000); // the plan snapshots the DERIVED threshold
    expect(body.plan.g_jour).toBeCloseTo(100 / 30, 4);
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0]?.ii_potentiel).toBe(20000);
    // E1 back-conversion: 20000 fact / 0.6 = 33333 physical → clamp(33333/(100·20)=16.7, 2, 30) → 16.
    expect(body.allocations[0]?.r_i).toBe(16);
    expect(body.allocations[0]?.creneaux.length).toBe(20); // 2 days × 10 broadcast hours

    expect((await dispatch(campaignId, { i_cible: 20000, cpm: 10, s: 10 })).statusCode).toBe(409);
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
    const res = await dispatch(campaignId, { i_cible: 20000, cpm: 10, s: 10 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(body.plan.couvert).toBe(20000);
    expect(body.plan.n_retenus).toBe(1);
    expect(body.plan.is_partial).toBe(false);
    expect(body.allocations).toHaveLength(1);
    expect(body.allocations[0]?.ii_potentiel).toBe(20000);
    expect(body.allocations[0]?.r_i).toBe(16);
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
    if (sfax) createdZoneIds.push(sfax.id);
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await db.insert(campaignZones).values({ campaignId, zoneId: sfax?.id ?? '' });
    await seedEligibleScreenhost(owner, cat, 'premium', 100); // Grand Tunis by default
    mockSession(admin);

    const res = await dispatch(campaignId, { i_cible: 20000, cpm: 10, s: 10 });
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

    const res = await dispatch(campaignId, { i_cible: 200000, cpm: 10, s: 10 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(body.plan.is_partial).toBe(true);
    expect(body.plan.couvert).toBeLessThan(200000);
    // E3 amendment — a MATERIAL (≥ seuil) shortfall is the partial path: nothing is stored.
    const [plan] = await db
      .select({ reliquatStocke: campaignDispatchPlan.reliquatStocke })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    expect(plan?.reliquatStocke).toBe(0);
  });

  // E3 (Mariem 2026-07-15 amendment) — a sub-seuil uncovered remainder is « stocké », not dropped
  // and not a clôture-1: E6 (redispatch) folds it into its own loss total.
  it('stores a sub-seuil reliquat on the plan (crumb → reliquat_stocke, NOT partial)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await seedEligibleScreenhost(owner, cat, 'premium', 100); // facturable capacity 36000
    mockSession(admin);

    // i_cible 37000 → the SH's full 36000 is allocated; the 1000 remainder is < seuil (2000 at
    // CPM 10, worth 10 TND < S_min 20) → stored for E6, and the plan is NOT flagged partial.
    const res = await dispatch(campaignId, { i_cible: 37000, cpm: 10, s: 10 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(body.plan.couvert).toBe(36000);
    expect(body.plan.is_partial).toBe(false);
    const [plan] = await db
      .select({ reliquatStocke: campaignDispatchPlan.reliquatStocke })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    expect(plan?.reliquatStocke).toBe(1000);
  });

  it('too-thin → 422 NOT_DELIVERABLE, not frozen, re-dispatchable (never 409-locks)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    await seedEligibleScreenhost(owner, cat, 'premium', 1); // fact = ⌊1·20·30 × 0.6⌋ = 360 < seuil 1000
    mockSession(admin);

    // N_min ⌈1500/360⌉=5 > N_max ⌊1500/1000⌋=1 → too thin → clôture alert, NOT frozen.
    const res = await dispatch(campaignId, { i_cible: 1500, cpm: 10, s: 10 });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { reason: string }).reason).toBe('too_thin');

    // Nothing was persisted...
    const plans = await db
      .select({ id: campaignDispatchPlan.id })
      .from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, campaignId));
    expect(plans).toHaveLength(0);

    // ...so a re-dispatch is the SAME 422 (renvoi curseur), never a 409 irrevocable lock.
    expect((await dispatch(campaignId, { i_cible: 1500, cpm: 10, s: 10 })).statusCode).toBe(422);
  });

  it('non-uniform affluence does not crash persistence (integer couvert/ii_potentiel)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser);
    await seedTargeting(campaignId, cat, 'premium');
    // 20 broadcast slots; total 2001 → avg 100.05 → fact = ⌊100.05·20·30 × 0.6⌋ = 36018. The raw
    // FP product carries …000000004 noise, which would crash an `integer` column unfloored.
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
    await db.insert(screenhostAffluence).values(bothHalves(rows));
    await seedInstalledScreen(sh?.id ?? '');
    mockSession(admin);

    // i_cible 100000 > fact 36018 → the SH's full residual is allocated (the fractional path).
    const res = await dispatch(campaignId, { i_cible: 100000, cpm: 10, s: 10 });
    expect(res.statusCode).toBe(201);
    const body = res.json() as PlanResponse;
    expect(Number.isInteger(body.plan.couvert)).toBe(true);
    expect(body.plan.couvert).toBe(36018);
    expect(body.plan.is_partial).toBe(true);
    expect(Number.isInteger(body.allocations[0]?.ii_potentiel ?? -1)).toBe(true);
  });

  it('E5.1 — a zero-line campaign PROCEEDS (whole network); with no venues at all it is a clôture 422, never the retired 400', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const campaignId = await seedCampaign(advertiser);
    mockSession(admin);
    const res = await dispatch(campaignId, { i_cible: 1000, cpm: 10, s: 10 });
    expect(res.statusCode).toBe(422); // empty pool on its own merits (NOT_DELIVERABLE)
    expect(res.json()).toMatchObject({ error: 'NOT_DELIVERABLE' });
  });

  it('400 when the campaign has no window (start/end date)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const advertiser = await seedUser({ role: 'advertiser' });
    const cat = await ownerSectorId();
    const campaignId = await seedCampaign(advertiser, { start: null, end: null });
    await seedTargeting(campaignId, cat, 'premium');
    mockSession(admin);
    expect((await dispatch(campaignId, { i_cible: 1000, cpm: 10, s: 10 })).statusCode).toBe(400);
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
        })
      ).statusCode,
    ).toBe(404);
  });

  it('403 for a non-admin', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const campaignId = await seedCampaign(advertiser);
    mockSession(advertiser, 'advertiser');
    expect((await dispatch(campaignId, { i_cible: 1000, cpm: 10, s: 10 })).statusCode).toBe(403);
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

  it('CAP-F1 — a 30s campaign at its full F (300s) no longer blocks a 10s campaign on the same screen', async () => {
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

    // A: S=30 → T=0.8, R_eff = MIN[3600/30=120, 300/30=10] = 10; fact capacity 16000 < i_cible
    // 20000 → the full screen is allocated: physical 16000/0.8 = 20000 → r_i 10 → 300s (full hour).
    expect((await dispatch(a, { i_cible: 20000, cpm: 10, s: 30 })).statusCode).toBe(201);
    const [aAlloc] = await allocsFor(a);
    expect(aAlloc?.rI).toBe(10);
    expect((aAlloc?.rI ?? 0) * 30).toBe(300);

    // B: S=10 — CAP-F1 (operator ruling 2026-09-24): F is PER CAMPAIGN, the screen holds 3600 s.
    // A's 300 s leave 3300 s, so B keeps its own F: R_eff = MIN[360, 300/10] = 30; fact capacity
    // 100·20·30·0.6 = 36 000 ≥ 20 000 → physical 33 334 over Hi 20 × Ai 100 → r_i 16 (160 s).
    // (Before CAP-F1 the 300 s was shared: A's full hour answered 422 here.)
    expect((await dispatch(b, { i_cible: 20000, cpm: 10, s: 10 })).statusCode).toBe(201);
    const [bAlloc] = await allocsFor(b);
    expect(bAlloc?.rI).toBe(16);
  });

  it('mixed durations on a shared screen: each campaign ≤ F (300s), the screen ≤ 3600s (CAP-F1)', async () => {
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

    // A: S=30 → T=0.8 (E1: derived), R_eff = MIN[120, 300/30=10] = 10. A MODEST i_cible sizes
    // r_i to 6: fact capacity = ⌊100·20·10 × 0.8⌋ = 16000 ≥ 10000 → allocation 10000 fact →
    // physical 10000/0.8 = 12500 → clamp(12500/(100·20)=6.25, 2, 10) → floor 6.
    expect((await dispatch(a, { i_cible: 10_000, cpm: 10, s: 30 })).statusCode).toBe(201);
    const [aAlloc] = await allocsFor(a);
    expect(aAlloc?.rI).toBe(6); // 6×30 = 180s

    // B: S=10 → T=0.6. CAP-F1: A's 180 s leave the screen 3420 s, so B's cap is its OWN F:
    // R_eff = MIN[360, ⌊300/10⌋] = 30; a huge I_cible takes all of it → r_i 30 (300 s).
    // (Before CAP-F1 the 300 s was shared: B got the 120 s A left → r_i 12.)
    expect((await dispatch(b, { i_cible: 10_000_000, cpm: 10, s: 10 })).statusCode).toBe(201);
    const [bAlloc] = await allocsFor(b);
    expect(bAlloc?.rI).toBe(30); // 30×10 = 300s — its full F

    // INVARIANTS: each campaign ≤ F (300 s/h) on the screen; the screen ≤ 3600 s/h in total.
    expect((aAlloc?.rI ?? 0) * 30).toBeLessThanOrEqual(300);
    expect((bAlloc?.rI ?? 0) * 10).toBeLessThanOrEqual(300);
    const totalSeconds = (aAlloc?.rI ?? 0) * 30 + (bAlloc?.rI ?? 0) * 10;
    expect(totalSeconds).toBe(480);
    expect(totalSeconds).toBeLessThanOrEqual(3600);
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
    const sh1 = await seedEligibleScreenhost(owner1, cat, 'premium', 100); // fact 36000
    const sh2 = await seedEligibleScreenhost(owner2, cat, 'premium', 100); // fact 36000
    mockSession(admin);

    // i_cible 100000 > a single SH's 36000 → both SHs allocated → both owners notified.
    const res = await dispatch(campaignId, { i_cible: 100000, cpm: 10, s: 10 });
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

    const res = await dispatch(campaignId, { i_cible: 100000, cpm: 10, s: 10 });
    expect(res.statusCode).toBe(201);

    // Two allocations (both venues), one owner → exactly one notification.
    const allocs = await allocsFor(campaignId);
    expect(allocs).toHaveLength(2);
    expect(await notifsFor(owner)).toHaveLength(1);
  });
});
