import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignReconciliation,
  campaignTargeting,
  campaignZones,
  campaigns,
  creatives,
  users,
  zones,
} from '../src/db/schema.js';
import { isJourOuvre, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres (DATABASE_URL). auth.api.getSession is mocked so we drive the
// session identity (id/role/status) directly; resetAuthTables TRUNCATE ... CASCADE wipes campaigns
// via the advertiser_id FK between tests. Every assertion targets the advertiser draft lifecycle:
// owner-scoping (a foreign id is a 404, never a leak) and the draft→pending status guard.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
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
      email: `camp${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  opts: {
    name?: string;
    type?: string;
    status?: 'draft' | 'pending' | 'upcoming' | 'active' | 'rejected' | 'completed';
    startDate?: string | null;
    endDate?: string | null;
  } = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: opts.name ?? 'Campaign Test',
      campaignType: opts.type ?? 'standard',
      status: opts.status ?? 'draft',
      startDate: opts.startDate ?? null,
      endDate: opts.endDate ?? null,
    })
    .returning();
  return c?.id ?? '';
};

// CF-Q2 — route fixtures compute VALID dates through the same lib the route enforces (the floor
// moves with real time; no clock mocking). prevWorkingDay/nextSaturday build the invalid cases.
const plusDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const floorDate = (): string => premiereDateDisponible();
const prevWorkingDay = (iso: string): string => {
  let d = plusDays(iso, -1);
  while (!isJourOuvre(d)) d = plusDays(d, -1);
  return d;
};
const nextSaturday = (iso: string): string => {
  let d = plusDays(iso, 1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 6) d = plusDays(d, 1);
  return d;
};

const readCampaign = async (id: string): Promise<typeof campaigns.$inferSelect | undefined> => {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return c;
};

const seedCreative = async (
  advertiserId: string,
  status: 'pending' | 'approved' | 'rejected' = 'pending',
): Promise<string> => {
  seq += 1;
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/${advertiserId}/seed${seq}`,
      durationSeconds: 20,
      validationStatus: status,
    })
    .returning();
  return c?.id ?? '';
};

// An OWNER business sector id from the PRE-SEEDED reference data (audience='owner'). business_sectors
// is seeded, NOT truncated by resetAuthTables (no FK to users) — so we must READ an existing sector,
// never INSERT one, or the shared reference table pollutes reference.test.ts's exact-count assertions.
const ownerSectorId = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return s?.id ?? '';
};

// The 1:1 per-campaign settlement row. delivered_imp + spend_tnd are what GET /mine surfaces; the
// other NOT NULL columns mirror the admin-reconcile seed values (partial-delivery shape).
const seedReconciliation = async (
  campaignId: string,
  opts: { deliveredImp?: number; spendTnd?: string } = {},
): Promise<void> => {
  await db.insert(campaignReconciliation).values({
    campaignId,
    expectedImp: 20000,
    deliveredImp: opts.deliveredImp ?? 10000,
    manquementImp: 10000,
    pPerteTnd: '100',
    refundTnd: '100',
    spendTnd: opts.spendTnd ?? '100',
    status: 'partial',
  });
};

type TargetingClass = 'populaire' | 'moyen' | 'premium' | null;
const seedTargeting = async (
  campaignId: string,
  lines: { categoryId?: string | null; class?: TargetingClass }[],
): Promise<void> => {
  await db.insert(campaignTargeting).values(
    lines.map((l) => ({
      campaignId,
      categoryId: l.categoryId ?? null,
      class: l.class ?? null,
    })),
  );
};

interface MineRow {
  id: string;
  name: string;
  delivered_impressions: number | null;
  spend_tnd: number | null;
  reconciled_at: string | null;
  targeting: { category_id: string | null; category_name: string | null; class: string | null }[];
}

describe('campaigns draft lifecycle (advertiser, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(campaignsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── POST /api/campaigns ──────────────────────────────────────────────────────
  it('creates a draft owned by the advertiser (201, status=draft, dates persisted)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: {
        name: 'Ramadan Promo',
        campaign_type: 'standard',
        start_date: floorDate(),
        end_date: plusDays(floorDate(), 30),
        description: 'A test campaign',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Ramadan Promo',
      campaign_type: 'standard',
      status: 'draft',
      start_date: floorDate(),
      end_date: plusDays(floorDate(), 30),
      description: 'A test campaign',
    });
    expect(body['id']).toBeDefined();

    const row = await readCampaign(body['id'] as string);
    expect(row?.advertiserId).toBe(me);
    expect(row?.status).toBe('draft');
    expect(row?.submittedAt).toBeNull();
  });

  it('creates a draft with only the required fields (dates/description default to null)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'Minimal', campaign_type: 'event' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'Minimal',
      campaign_type: 'event',
      status: 'draft',
      start_date: null,
      end_date: null,
      description: null,
    });
  });

  it('persists + updates requested_budget (the interim manual cart budget)', async () => {
    const me = await seedUser();
    mockSession(me);
    const created = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'Budgeted', campaign_type: 'standard', requested_budget: 1500 },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as Record<string, unknown>)['requested_budget']).toBe(1500);
    const id = (created.json() as { id: string }).id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { requested_budget: 2000 },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as Record<string, unknown>)['requested_budget']).toBe(2000);
  });

  it('defaults requested_budget to null when omitted', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'NoBudget', campaign_type: 'standard' },
    });
    expect((res.json() as Record<string, unknown>)['requested_budget']).toBeNull();
  });

  // ── CF-Z1 — zone_ids: replace-set junction, active-zone validation, projection ──────────────
  const GRAND_TUNIS_ID = '2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f';

  it('create persists zone_ids into campaign_zones; /mine + GET /:id expose the names', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'Zonée', campaign_type: 'standard', zone_ids: [GRAND_TUNIS_ID] },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    const junction = await db.select().from(campaignZones).where(eq(campaignZones.campaignId, id));
    expect(junction).toHaveLength(1);
    expect(junction[0]?.zoneId).toBe(GRAND_TUNIS_ID);

    const one = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect((one.json() as { zones: { zone_id: string; name: string }[] }).zones).toEqual([
      { zone_id: GRAND_TUNIS_ID, name: 'Grand Tunis' },
    ]);
    const mine = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    const row = (mine.json() as { id: string; zones: { name: string }[] }[]).find(
      (r) => r.id === id,
    );
    expect(row?.zones.map((z) => z.name)).toEqual(['Grand Tunis']);
  });

  it('rejects an unknown or inactive zone id (400 INVALID_ZONE), nothing persisted', async () => {
    const me = await seedUser();
    mockSession(me);
    const ghost = '99999999-9999-4999-8999-999999999999';
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'Zone fantôme', campaign_type: 'standard', zone_ids: [ghost] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_ZONE', unknown_zone_ids: [ghost] });
    expect(await db.select().from(campaigns)).toHaveLength(0);

    const inactiveName = `Zone inactive ${Date.now()}`;
    const [inactive] = await db
      .insert(zones)
      .values({ name: inactiveName, active: false })
      .returning();
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'Zone éteinte', campaign_type: 'standard', zone_ids: [inactive?.id ?? ''] },
    });
    expect(res2.statusCode).toBe(400);
    expect((res2.json() as { error: string }).error).toBe('INVALID_ZONE');
  });

  it('PATCH replace-sets zones; an explicit [] clears (whole network); zone-only PATCH works', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    // zone-only PATCH (no column change) — sets [Grand Tunis]
    const set = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { zone_ids: [GRAND_TUNIS_ID] },
    });
    expect(set.statusCode).toBe(200);
    expect(
      await db.select().from(campaignZones).where(eq(campaignZones.campaignId, id)),
    ).toHaveLength(1);
    // duplicate ids in the payload collapse (UNIQUE pair; Set dedup)
    const dup = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { zone_ids: [GRAND_TUNIS_ID, GRAND_TUNIS_ID] },
    });
    expect(dup.statusCode).toBe(200);
    expect(
      await db.select().from(campaignZones).where(eq(campaignZones.campaignId, id)),
    ).toHaveLength(1);
    // [] clears — whole network on the zone criterion
    const clear = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { zone_ids: [] },
    });
    expect(clear.statusCode).toBe(200);
    expect(
      await db.select().from(campaignZones).where(eq(campaignZones.campaignId, id)),
    ).toHaveLength(0);
  });

  // ── CF-Q2 (spec §1.4) — the J+2-working-days start floor, enforced at every write ───────────
  it('rejects a create whose start is an ouvré day BEFORE the floor (400 TOO_SOON + the floor)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: {
        name: 'Trop tôt',
        campaign_type: 'standard',
        start_date: prevWorkingDay(floorDate()),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'INVALID_START_DATE',
      reason: 'TOO_SOON',
      message: 'The start date must be at least two working days ahead.',
      first_available_start_date: floorDate(),
    });
    expect(await db.select().from(campaigns)).toHaveLength(0); // nothing persisted
  });

  it('ACCEPTS a week-end start past the floor on create, PATCH and submit (ruling #10)', async () => {
    const me = await seedUser();
    mockSession(me);
    const saturday = nextSaturday(plusDays(floorDate(), 7));
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: {
        name: 'Départ samedi',
        campaign_type: 'standard',
        start_date: saturday,
        end_date: plusDays(saturday, 30),
      },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { start_date: nextSaturday(plusDays(saturday, 1)) },
    });
    expect(patched.statusCode).toBe(200);

    const submitted = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(submitted.statusCode).toBe(200);
    expect((submitted.json() as { status: string }).status).toBe('pending');
  });

  it('rejects a too-soon start on PATCH; an explicit null still clears the date', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const tooSoon = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { start_date: prevWorkingDay(floorDate()) },
    });
    expect(tooSoon.statusCode).toBe(400);
    expect((tooSoon.json() as { reason: string }).reason).toBe('TOO_SOON');
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { start_date: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as { start_date: string | null }).start_date).toBeNull();
  });

  it('re-checks the floor at SUBMIT: a stale draft (start now too soon) is refused, stays draft', async () => {
    const me = await seedUser();
    // Seeded straight into the DB with yesterday-ish ouvré start — as a draft saved days ago.
    const id = await seedCampaign(me, {
      startDate: prevWorkingDay(floorDate()),
      endDate: plusDays(floorDate(), 30),
    });
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { reason: string }).reason).toBe('TOO_SOON');
    expect((await readCampaign(id))?.status).toBe('draft'); // unchanged
    expect((await readCampaign(id))?.submittedAt).toBeNull();
  });

  it('CF-S1 HARDENING: a date-less draft no longer submits (400 MISSING_DATES, stays draft)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('MISSING_DATES');
    expect((await readCampaign(id))?.status).toBe('draft');
  });

  it('an existing draft with a PAST start stays fully READABLE (no retroactive breakage)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { startDate: '2025-01-06' }); // a long-gone lundi
    mockSession(me);
    const one = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect(one.statusCode).toBe(200);
    expect((one.json() as { start_date: string }).start_date).toBe('2025-01-06');
    const list = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { id: string }[]).some((r) => r.id === id)).toBe(true);
  });

  it('rejects a create missing a required field (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'No type given' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication to create (401)', async () => {
    mockNoSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'X', campaign_type: 'y' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('forbids a non-advertiser from creating (403)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(owner, 'individual_owner', 'approved');
    const res = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: 'X', campaign_type: 'y' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /api/campaigns/mine ──────────────────────────────────────────────────
  it('lists only the caller’s own campaigns', async () => {
    const me = await seedUser();
    const other = await seedUser();
    await seedCampaign(me, { name: 'Mine 1' });
    await seedCampaign(me, { name: 'Mine 2' });
    await seedCampaign(other, { name: 'Theirs' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body).toHaveLength(2);
    expect(body.map((r) => r.name).sort()).toEqual(['Mine 1', 'Mine 2']);
  });

  it('forbids a non-advertiser from listing (403)', async () => {
    const owner = await seedUser({ role: 'fleet_owner' });
    mockSession(owner, 'fleet_owner', 'approved');
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /api/campaigns/mine — reconciled performance + targeting (advertiser scope) ──
  it('surfaces delivered impressions, net spend, reconciled_at + targeting per campaign', async () => {
    const me = await seedUser();
    const sector = await ownerSectorId();
    const campaignId = await seedCampaign(me, { name: 'Reconciled' });
    await seedReconciliation(campaignId, { deliveredImp: 12000, spendTnd: '150.5000' });
    await seedTargeting(campaignId, [{ categoryId: sector, class: 'premium' }]);
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as MineRow[];
    expect(body).toHaveLength(1);
    const [row] = body;
    expect(row?.delivered_impressions).toBe(12000);
    expect(row?.spend_tnd).toBe(150.5); // numeric(14,4) → Number, trailing zeros dropped
    expect(row?.reconciled_at).not.toBeNull();
    expect(row?.targeting).toEqual([
      { category_id: sector, category_name: expect.any(String), class: 'premium' },
    ]);
  });

  it('returns nulls + empty targeting for a campaign with no reconciliation', async () => {
    const me = await seedUser();
    await seedCampaign(me, { name: 'Unreconciled' });
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    const [row] = res.json() as MineRow[];
    expect(row?.delivered_impressions).toBeNull();
    expect(row?.spend_tnd).toBeNull();
    expect(row?.reconciled_at).toBeNull();
    expect(row?.targeting).toEqual([]);
  });

  it('reflects NULL targeting axes (toutes catégories / toutes classes)', async () => {
    const me = await seedUser();
    const sector = await ownerSectorId();
    const campaignId = await seedCampaign(me);
    await seedTargeting(campaignId, [
      { categoryId: null, class: 'moyen' }, // toutes catégories · moyen
      { categoryId: sector, class: null }, // sector · toutes classes
    ]);
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    const [row] = res.json() as MineRow[];
    expect(row?.targeting).toHaveLength(2);
    expect(row?.targeting).toContainEqual({
      category_id: null,
      category_name: null,
      class: 'moyen',
    });
    expect(row?.targeting).toContainEqual({
      category_id: sector,
      category_name: expect.any(String),
      class: null,
    });
  });

  it('NEVER leaks another advertiser’s reconciliation or targeting (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const sector = await ownerSectorId();
    const mine = await seedCampaign(me, { name: 'Mine' });
    const theirs = await seedCampaign(other, { name: 'Theirs' });
    await seedReconciliation(mine, { deliveredImp: 5000, spendTnd: '50' });
    await seedReconciliation(theirs, { deliveredImp: 999999, spendTnd: '9999' });
    await seedTargeting(mine, [{ categoryId: sector, class: 'populaire' }]);
    await seedTargeting(theirs, [{ categoryId: sector, class: 'premium' }]);
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    const body = res.json() as MineRow[];
    expect(body).toHaveLength(1);
    const [row] = body;
    expect(row?.id).toBe(mine);
    expect(row?.delivered_impressions).toBe(5000);
    expect(row?.spend_tnd).toBe(50);
    expect(row?.targeting.map((t) => t.class)).toEqual(['populaire']);
  });

  it('does not multiply campaign rows for multiple targeting lines (1:1 spend intact)', async () => {
    const me = await seedUser();
    const sector = await ownerSectorId();
    const campaignId = await seedCampaign(me);
    await seedReconciliation(campaignId, { deliveredImp: 8000, spendTnd: '80' });
    await seedTargeting(campaignId, [
      { categoryId: sector, class: 'populaire' },
      { categoryId: sector, class: 'moyen' },
      { categoryId: sector, class: 'premium' },
    ]);
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    const body = res.json() as MineRow[];
    expect(body).toHaveLength(1); // NOT 3 — targeting is batched, never joined into the main SELECT
    const [row] = body;
    expect(row?.spend_tnd).toBe(80); // spend not multiplied by the 3 lines
    expect(row?.targeting).toHaveLength(3);
  });

  // ── GET /api/campaigns/:id ───────────────────────────────────────────────────
  it('returns the caller’s own campaign (200)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { name: 'Readable' });
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { name: string }).name).toBe('Readable');
  });

  it('returns 404 reading another advertiser’s campaign (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other);
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${foreign}` });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-uuid id (400)', async () => {
    const me = await seedUser();
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: '/api/campaigns/not-a-uuid' });
    expect(res.statusCode).toBe(400);
  });

  // ── CF-Q1 — reject_reason exposure: the admin stores a mandatory reason on reject; the
  // advertiser projection must surface it (and rejected_at) so the owner learns WHY. ────────────
  it('a rejected campaign carries reject_reason + rejected_at in GET /:id AND the list', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { name: 'Refusée', status: 'rejected' });
    const rejectedAt = new Date('2026-07-01T10:00:00Z');
    await db
      .update(campaigns)
      .set({ rejectedAt, rejectReason: 'Visuel non conforme à la charte.' })
      .where(eq(campaigns.id, id));
    mockSession(me);

    const one = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect(one.statusCode).toBe(200);
    const row = one.json() as { reject_reason: string | null; rejected_at: string | null };
    expect(row.reject_reason).toBe('Visuel non conforme à la charte.');
    expect(row.rejected_at).toBe(rejectedAt.toISOString());

    const list = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    const mine = (list.json() as { id: string; reject_reason: string | null }[]).find(
      (r) => r.id === id,
    );
    expect(mine?.reject_reason).toBe('Visuel non conforme à la charte.');
  });

  // ── CF-S1 — Non validé is RECOVERABLE + the projection carries creative_id ──────────────────
  it('recovery round-trip: rejected → PATCH → resubmit → pending with the rejection audit CLEARED', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, {
      status: 'rejected',
      startDate: floorDate(),
      endDate: plusDays(floorDate(), 20),
    });
    await db
      .update(campaigns)
      .set({ rejectedAt: new Date(), rejectReason: 'Visuel non conforme.' })
      .where(eq(campaigns.id, id));
    mockSession(me);

    // A rejected campaign is editable again…
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { name: 'Corrigée' },
    });
    expect(patched.statusCode).toBe(200);

    // …and resubmits to pending, shedding reject_reason + rejected_at.
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      reject_reason: string | null;
      rejected_at: string | null;
    };
    expect(body.status).toBe('pending');
    expect(body.reject_reason).toBeNull();
    expect(body.rejected_at).toBeNull();

    // Pending is NOT editable/submittable (recovery is for rejected only).
    const again = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(again.statusCode).toBe(409);
  });

  it('a rejected resubmit still re-checks the date floor (stale start → 400 TOO_SOON)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, {
      status: 'rejected',
      startDate: prevWorkingDay(floorDate()),
      endDate: plusDays(floorDate(), 20),
    });
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { reason: string }).reason).toBe('TOO_SOON');
    expect((await readCampaign(id))?.status).toBe('rejected'); // unchanged
  });

  it('the projection exposes creative_id on GET /:id and /mine (Reprendre rehydration)', async () => {
    const me = await seedUser();
    const creativeId = await seedCreative(me, 'approved');
    const id = await seedCampaign(me);
    await db.update(campaigns).set({ creativeId }).where(eq(campaigns.id, id));
    mockSession(me);
    const one = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect((one.json() as { creative_id: string | null }).creative_id).toBe(creativeId);
    const mine = await app.inject({ method: 'GET', url: '/api/campaigns/mine' });
    const row = (mine.json() as { id: string; creative_id: string | null }[]).find(
      (r) => r.id === id,
    );
    expect(row?.creative_id).toBe(creativeId);
  });

  it('a non-rejected campaign carries NULL reject_reason/rejected_at', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { name: 'Brouillon sain' });
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    const row = res.json() as { reject_reason: string | null; rejected_at: string | null };
    expect(row.reject_reason).toBeNull();
    expect(row.rejected_at).toBeNull();
  });

  // ── PATCH /api/campaigns/:id ─────────────────────────────────────────────────
  it('edits a draft the caller owns (200)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { name: 'Before' });
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { name: 'After', description: 'updated' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { name: string }).name).toBe('After');
    const row = await readCampaign(id);
    expect(row?.name).toBe('After');
    expect(row?.description).toBe('updated');
  });

  it('returns 404 patching another advertiser’s campaign (owner-scope, untouched)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other, { name: 'Theirs' });
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${foreign}`,
      payload: { name: 'hijack' },
    });
    expect(res.statusCode).toBe(404);
    expect((await readCampaign(foreign))?.name).toBe('Theirs');
  });

  it('blocks editing once submitted (409)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { status: 'pending' });
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${id}`,
      payload: { name: 'too late' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an empty patch body (400)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({ method: 'PATCH', url: `/api/campaigns/${id}`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  // ── POST /api/campaigns/:id/submit ───────────────────────────────────────────
  it('submits a draft → pending and stamps submitted_at (200)', async () => {
    const me = await seedUser();
    // CF-S1 — submit now requires BOTH dates (the wizard always sends them).
    const id = await seedCampaign(me, {
      status: 'draft',
      startDate: floorDate(),
      endDate: plusDays(floorDate(), 20),
    });
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('pending');
    const row = await readCampaign(id);
    expect(row?.status).toBe('pending');
    expect(row?.submittedAt).not.toBeNull();
  });

  it('returns 409 submitting a non-draft', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { status: 'pending' });
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 submitting another advertiser’s campaign (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other);
    mockSession(me);
    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${foreign}/submit` });
    expect(res.statusCode).toBe(404);
  });

  // ── DELETE /api/campaigns/:id ────────────────────────────────────────────────
  it('deletes a draft the caller owns (204)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({ method: 'DELETE', url: `/api/campaigns/${id}` });
    expect(res.statusCode).toBe(204);
    expect(await readCampaign(id)).toBeUndefined();
  });

  it('returns 409 deleting a non-draft (kept)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, { status: 'pending' });
    mockSession(me);
    const res = await app.inject({ method: 'DELETE', url: `/api/campaigns/${id}` });
    expect(res.statusCode).toBe(409);
    expect(await readCampaign(id)).toBeDefined();
  });

  it('returns 404 deleting another advertiser’s campaign (owner-scope, kept)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other);
    mockSession(me);
    const res = await app.inject({ method: 'DELETE', url: `/api/campaigns/${foreign}` });
    expect(res.statusCode).toBe(404);
    expect(await readCampaign(foreign)).toBeDefined();
  });

  // ── derived content gate (L-spot, bifurcated approval) ───────────────────────
  it('derives content_validation_status = null when no creative is linked', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${id}` });
    expect(res.statusCode).toBe(200);
    expect(
      (res.json() as { content_validation_status: string | null }).content_validation_status,
    ).toBeNull();
  });

  it('derives content_validation_status from the linked creative (reflects approval)', async () => {
    const me = await seedUser();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: me,
        creativeType: 'video',
        storageKey: `creatives/${me}/c`,
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: me,
        name: 'Linked',
        campaignType: 'standard',
        creativeId: creative?.id,
      })
      .returning();
    mockSession(me);
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign?.id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { content_validation_status: string }).content_validation_status).toBe(
      'approved',
    );
  });

  // ── PATCH creative_id (link / unlink the creative) ───────────────────────────
  it('links an own creative via PATCH (200); GET then derives its content_validation_status', async () => {
    const me = await seedUser();
    const campaignId = await seedCampaign(me);
    const creativeId = await seedCreative(me, 'approved');
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaignId}`,
      payload: { creative_id: creativeId },
    });
    expect(res.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}` });
    expect((get.json() as { content_validation_status: string }).content_validation_status).toBe(
      'approved',
    );
  });

  it('returns 404 linking another advertiser’s creative (owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const campaignId = await seedCampaign(me);
    const foreign = await seedCreative(other, 'approved');
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaignId}`,
      payload: { creative_id: foreign },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 linking a nonexistent creative', async () => {
    const me = await seedUser();
    const campaignId = await seedCampaign(me);
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaignId}`,
      payload: { creative_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 linking a creative on a non-draft campaign', async () => {
    const me = await seedUser();
    const campaignId = await seedCampaign(me, { status: 'pending' });
    const creativeId = await seedCreative(me);
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaignId}`,
      payload: { creative_id: creativeId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('unlinks with creative_id=null (200) → content gate back to null', async () => {
    const me = await seedUser();
    const creativeId = await seedCreative(me, 'approved');
    const [campaign] = await db
      .insert(campaigns)
      .values({ advertiserId: me, name: 'Linked', campaignType: 'standard', creativeId })
      .returning();
    mockSession(me);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/campaigns/${campaign?.id}`,
      payload: { creative_id: null },
    });
    expect(res.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign?.id}` });
    expect(
      (get.json() as { content_validation_status: string | null }).content_validation_status,
    ).toBeNull();
  });

  // ── POST /api/campaigns/:id/replay (CF-RJ1 — « Rejouer », spec §3.3) ─────────
  // Fixture note: sectors are READ from the pre-seeded reference data and the zone is the seeded
  // Grand Tunis — nothing is inserted into business_sectors/zones (the exact-seed-count footgun).
  const grandTunisId = async (): Promise<string> => {
    const [z] = await db.select({ id: zones.id }).from(zones).where(eq(zones.name, 'Grand Tunis'));
    return z?.id ?? '';
  };
  const twoOwnerSectors = async (): Promise<{ id: string; name: string }[]> =>
    db
      .select({ id: businessSectors.id, name: businessSectors.name })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'owner'))
      .orderBy(asc(businessSectors.displayOrder))
      .limit(2);

  // A full-bodied COMPLETED campaign: every copyable field set, every never-copied field set too
  // (dates/submitted_at/draft_reminder_sent_at) so the matrix can pin both directions.
  const seedCompletedSource = async (
    me: string,
  ): Promise<{ id: string; creativeId: string; sectors: { id: string; name: string }[] }> => {
    const creativeId = await seedCreative(me, 'approved');
    const sectors = await twoOwnerSectors();
    const gt = await grandTunisId();
    const [source] = await db
      .insert(campaigns)
      .values({
        advertiserId: me,
        name: 'Été 2025',
        campaignType: 'standard',
        status: 'completed',
        startDate: '2025-07-01',
        endDate: '2025-07-15',
        description: 'Campagne estivale originale',
        creativeId,
        requestedBudget: '1500',
        submittedAt: new Date('2025-06-20T10:00:00Z'),
        draftReminderSentAt: new Date('2025-06-18T08:00:00Z'),
      })
      .returning();
    await seedTargeting(source?.id ?? '', [
      { categoryId: sectors[0]?.id },
      { categoryId: sectors[1]?.id, class: 'premium' },
    ]);
    await db.insert(campaignZones).values({ campaignId: source?.id ?? '', zoneId: gt });
    return { id: source?.id ?? '', creativeId, sectors };
  };

  it('replay clones a completed campaign — the full copy/no-copy matrix (201)', async () => {
    const me = await seedUser();
    const { id: sourceId, creativeId, sectors } = await seedCompletedSource(me);
    mockSession(me);

    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${sourceId}/replay` });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown> & { id: string };

    // COPIED — the identical-new-campaign half of the matrix.
    expect(body).toMatchObject({
      name: 'Été 2025',
      campaign_type: 'standard',
      description: 'Campagne estivale originale',
      requested_budget: 1500,
      creative_id: creativeId,
      content_validation_status: 'approved', // derived from the SHARED linked creative
    });
    // NOT copied — a fresh draft pointed at a new période.
    expect(body).toMatchObject({
      status: 'draft',
      start_date: null,
      end_date: null,
      submitted_at: null,
      rejected_at: null,
      reject_reason: null,
    });
    expect(body.id).not.toBe(sourceId);

    // Projection carries the cloned lines: zones + targeting with resolved names, class preserved.
    // (Batch-inserted lines share one created_at, so the projection order is not guaranteed —
    // compare order-insensitively.)
    expect(body['zones']).toEqual([{ zone_id: await grandTunisId(), name: 'Grand Tunis' }]);
    const targeting = (
      body['targeting'] as { category_id: string | null; category_name: string | null }[]
    )
      .slice()
      .sort((a, b) => (a.category_name ?? '').localeCompare(b.category_name ?? ''));
    expect(targeting).toEqual(
      [
        { category_id: sectors[0]?.id, category_name: sectors[0]?.name, class: null },
        { category_id: sectors[1]?.id, category_name: sectors[1]?.name, class: 'premium' },
      ].sort((a, b) => (a.category_name ?? '').localeCompare(b.category_name ?? '')),
    );

    // DB half of the no-copy matrix: reminder stamp and activation audit stay at their defaults.
    const [cloneRow] = await db.select().from(campaigns).where(eq(campaigns.id, body.id));
    expect(cloneRow?.draftReminderSentAt).toBeNull();
    expect(cloneRow?.activatedAt).toBeNull();
    expect(cloneRow?.activatedBy).toBeNull();
    expect(cloneRow?.advertiserId).toBe(me);
  });

  it('replayed targeting/zone rows are DUPLICATED, not shared — source edits never leak', async () => {
    const me = await seedUser();
    const { id: sourceId } = await seedCompletedSource(me);
    mockSession(me);

    const res = await app.inject({ method: 'POST', url: `/api/campaigns/${sourceId}/replay` });
    const cloneId = (res.json() as { id: string }).id;

    // Distinct rows: the clone's targeting line ids share nothing with the source's.
    const sourceLines = await db
      .select({ id: campaignTargeting.id })
      .from(campaignTargeting)
      .where(eq(campaignTargeting.campaignId, sourceId));
    const cloneLines = await db
      .select({ id: campaignTargeting.id })
      .from(campaignTargeting)
      .where(eq(campaignTargeting.campaignId, cloneId));
    expect(sourceLines).toHaveLength(2);
    expect(cloneLines).toHaveLength(2);
    const sourceIds = new Set(sourceLines.map((l) => l.id));
    expect(cloneLines.some((l) => sourceIds.has(l.id))).toBe(false);

    // Wipe the SOURCE's lines and zones — the clone keeps its own copies.
    await db.delete(campaignTargeting).where(eq(campaignTargeting.campaignId, sourceId));
    await db.delete(campaignZones).where(eq(campaignZones.campaignId, sourceId));
    expect(
      await db.select().from(campaignTargeting).where(eq(campaignTargeting.campaignId, cloneId)),
    ).toHaveLength(2);
    expect(
      await db.select().from(campaignZones).where(eq(campaignZones.campaignId, cloneId)),
    ).toHaveLength(1);
  });

  it.each(['draft', 'pending', 'upcoming', 'active', 'rejected'] as const)(
    'replay of a %s campaign → 409 REPLAY_SOURCE_NOT_COMPLETED',
    async (status) => {
      const me = await seedUser();
      const campaignId = await seedCampaign(me, { status });
      mockSession(me);
      const res = await app.inject({
        method: 'POST',
        url: `/api/campaigns/${campaignId}/replay`,
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toBe('REPLAY_SOURCE_NOT_COMPLETED');
      // No clone materialized.
      expect(await db.select().from(campaigns)).toHaveLength(1);
    },
  );

  it('replay owner scoping: a FOREIGN completed campaign is indistinguishable from a missing one (404)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const { id: foreignId } = await seedCompletedSource(other);
    mockSession(me);

    const foreign = await app.inject({ method: 'POST', url: `/api/campaigns/${foreignId}/replay` });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/campaigns/99999999-9999-4999-8999-999999999999/replay',
    });
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json());
    // The foreign source spawned nothing for the caller.
    expect(await db.select().from(campaigns).where(eq(campaigns.advertiserId, me))).toHaveLength(0);
  });

  it('replay rejects a non-uuid id (400) and requires authentication (401)', async () => {
    const me = await seedUser();
    mockSession(me);
    const bad = await app.inject({ method: 'POST', url: '/api/campaigns/not-a-uuid/replay' });
    expect(bad.statusCode).toBe(400);

    mockNoSession();
    const anon = await app.inject({
      method: 'POST',
      url: '/api/campaigns/99999999-9999-4999-8999-999999999999/replay',
    });
    expect(anon.statusCode).toBe(401);
  });

  // ── apiRoutes wiring ─────────────────────────────────────────────────────────
  it('is wired into the apiRoutes aggregate (reachable through the full app)', async () => {
    const me = await seedUser();
    mockSession(me);
    // A SEPARATE app built from the apiRoutes aggregate (not the per-test campaignsRoutes app):
    // proves routes/index.ts actually registers campaignsRoutes, not just the direct plugin.
    const aggregate = buildApp();
    await aggregate.register(apiRoutes);
    await aggregate.ready();
    try {
      const res = await aggregate.inject({ method: 'GET', url: '/api/campaigns/mine' });
      expect(res.statusCode).toBe(200);
    } finally {
      await aggregate.close();
    }
  });
});
