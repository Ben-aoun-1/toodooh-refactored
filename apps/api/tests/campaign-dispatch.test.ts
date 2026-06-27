import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignTargeting,
  campaigns,
  screenhostAffluence,
  screenhosts,
  users,
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
});
