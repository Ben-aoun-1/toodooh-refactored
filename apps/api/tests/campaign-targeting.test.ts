import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, businessSectors, campaigns, screenhosts, users } from '../src/db/schema.js';
import { campaignTargetingRoutes } from '../src/routes/campaign-targeting.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration suite — real Postgres. getSession is mocked to drive the advertiser identity. Owner
// business sectors are pre-seeded (audience='owner') and survive resetAuthTables (only users/auth
// truncate; campaign_targeting wipes via the campaign→user FK cascade chain).
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
type Line = { category_id: string | null; category_name: string | null; class: string | null };

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
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
      email: `tgt${seq}@example.com`,
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
  status: 'draft' | 'pending' | 'active' | 'rejected' = 'draft',
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({ advertiserId, name: 'Targeting Test', campaignType: 'standard', status })
    .returning();
  return c?.id ?? '';
};

type Cls = 'populaire' | 'moyen' | 'premium' | null;
const seedScreenhost = async (opts: {
  categoryId: string | null;
  cls: Cls;
  name?: string;
  active?: boolean;
  lat?: string | null;
  lng?: string | null;
}): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: opts.name ?? 'Venue',
      businessSectorId: opts.categoryId,
      class: opts.cls,
      isActive: opts.active ?? true,
      latitude: opts.lat === undefined ? '36.80000000' : opts.lat,
      longitude: opts.lng === undefined ? '10.18000000' : opts.lng,
    })
    .returning();
  return sh?.id ?? '';
};

const ownerCategoryIds = async (): Promise<string[]> => {
  const rows = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'));
  return rows.map((r) => r.id);
};

describe('campaign targeting (advertiser, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(campaignTargetingRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const put = (id: string, lines: { category_id: string | null; class: string | null }[]) =>
    app.inject({ method: 'PUT', url: `/api/campaigns/${id}/targeting`, payload: { lines } });
  const get = (id: string) => app.inject({ method: 'GET', url: `/api/campaigns/${id}/targeting` });
  const coverage = (id: string) =>
    app.inject({ method: 'GET', url: `/api/campaigns/${id}/coverage` });
  type CoverageDot = { id: string; name: string; latitude: number; longitude: number };
  const coverageDots = (res: Awaited<ReturnType<typeof coverage>>): CoverageDot[] =>
    (res.json() as { screenhosts: CoverageDot[] }).screenhosts;

  it('sets lines (200) and GET returns them with category names', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA, catB] = await ownerCategoryIds();
    mockSession(me);

    const res = await put(id, [
      { category_id: catA ?? null, class: 'premium' },
      { category_id: catB ?? null, class: null },
    ]);
    expect(res.statusCode).toBe(200);
    const lines = (res.json() as { lines: Line[] }).lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]?.category_name).toBeTruthy();

    const got = await get(id);
    expect(got.statusCode).toBe(200);
    expect((got.json() as { lines: Line[] }).lines).toHaveLength(2);
  });

  it('replace-set: a second PUT replaces the prior lines', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    mockSession(me);
    await put(id, [
      { category_id: catA ?? null, class: 'premium' },
      { category_id: catA ?? null, class: 'moyen' },
    ]);
    const res = await put(id, [{ category_id: catA ?? null, class: 'populaire' }]);
    expect(res.statusCode).toBe(200);
    const lines = (res.json() as { lines: Line[] }).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.class).toBe('populaire');
  });

  it('accepts the ALL/ALL line (tout le réseau)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await put(id, [{ category_id: null, class: null }]);
    expect(res.statusCode).toBe(200);
    const lines = (res.json() as { lines: Line[] }).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ category_id: null, class: null });
  });

  it('clears targeting with an empty set (200)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    mockSession(me);
    await put(id, [{ category_id: catA ?? null, class: 'premium' }]);
    const res = await put(id, []);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { lines: Line[] }).lines).toHaveLength(0);
  });

  it('rejects a duplicate line (409)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    mockSession(me);
    const res = await put(id, [
      { category_id: catA ?? null, class: 'premium' },
      { category_id: catA ?? null, class: 'premium' },
    ]);
    expect(res.statusCode).toBe(409);
  });

  it('rejects two ALL/ALL lines as a duplicate (NULLs treated as a value) (409)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await put(id, [
      { category_id: null, class: null },
      { category_id: null, class: null },
    ]);
    expect(res.statusCode).toBe(409);
  });

  it('rejects ALL/ALL combined with a specific line (400)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    mockSession(me);
    const res = await put(id, [
      { category_id: null, class: null },
      { category_id: catA ?? null, class: 'premium' },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown category_id (400)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    mockSession(me);
    const res = await put(id, [
      { category_id: '00000000-0000-0000-0000-000000000000', class: 'premium' },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an advertiser-audience sector as a category (owner-only) (400)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [advSector] = await db
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(eq(businessSectors.audience, 'advertiser'))
      .limit(1);
    mockSession(me);
    const res = await put(id, [{ category_id: advSector?.id ?? null, class: 'premium' }]);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid class (400)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    mockSession(me);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/campaigns/${id}/targeting`,
      payload: { lines: [{ category_id: catA ?? null, class: 'luxe' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 retargeting a non-draft campaign', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me, 'pending');
    const [catA] = await ownerCategoryIds();
    mockSession(me);
    const res = await put(id, [{ category_id: catA ?? null, class: 'premium' }]);
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 on a foreign campaign (PUT and GET, owner-scope)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other);
    mockSession(me);
    expect((await put(foreign, [{ category_id: null, class: null }])).statusCode).toBe(404);
    expect((await get(foreign)).statusCode).toBe(404);
  });

  it('forbids a non-advertiser (403)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const id = await seedCampaign(owner);
    mockSession(owner, 'individual_owner');
    expect((await get(id)).statusCode).toBe(403);
  });

  // ── coverage map (GET /:id/coverage) — active ∩ has-coordinates ∩ matches-targeting ───────────
  it('coverage returns only ACTIVE, coordinate-bearing screenhosts matching the targeting', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA, catB] = await ownerCategoryIds();
    const match = await seedScreenhost({ categoryId: catA ?? null, cls: 'premium', name: 'Match' });
    await seedScreenhost({ categoryId: catB ?? null, cls: 'premium', name: 'OtherCategory' });
    await seedScreenhost({ categoryId: catA ?? null, cls: 'moyen', name: 'OtherClass' });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      active: false,
      name: 'Inactive',
    });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      lat: null,
      lng: null,
      name: 'NoCoords',
    });
    mockSession(me);
    await put(id, [{ category_id: catA ?? null, class: 'premium' }]);

    const res = await coverage(id);
    expect(res.statusCode).toBe(200);
    const dots = coverageDots(res);
    expect(dots).toHaveLength(1);
    expect(dots[0]?.id).toBe(match);
    expect(dots[0]?.name).toBe('Match');
    expect(typeof dots[0]?.latitude).toBe('number');
    expect(typeof dots[0]?.longitude).toBe('number');
  });

  it('coverage is empty when the campaign has no targeting lines (nothing matches)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    await seedScreenhost({ categoryId: catA ?? null, cls: 'premium' });
    mockSession(me);
    const res = await coverage(id);
    expect(res.statusCode).toBe(200);
    expect(coverageDots(res)).toHaveLength(0);
  });

  it('the ALL/ALL line covers every active, coordinate-bearing venue', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA, catB] = await ownerCategoryIds();
    await seedScreenhost({ categoryId: catA ?? null, cls: 'premium' });
    await seedScreenhost({ categoryId: catB ?? null, cls: 'moyen' });
    await seedScreenhost({ categoryId: null, cls: null }); // an unclassified venue still matches ALL/ALL
    mockSession(me);
    await put(id, [{ category_id: null, class: null }]);
    const res = await coverage(id);
    expect(res.statusCode).toBe(200);
    expect(coverageDots(res)).toHaveLength(3);
  });

  it('coverage returns 404 on a foreign campaign — no cross-advertiser leak (auth-scoped)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const foreign = await seedCampaign(other);
    const [catA] = await ownerCategoryIds();
    await seedScreenhost({ categoryId: catA ?? null, cls: 'premium' });
    // The foreign campaign IS targeted (would yield coverage) — proving the 404 is owner-scope, not emptiness.
    mockSession(other);
    await put(foreign, [{ category_id: catA ?? null, class: 'premium' }]);
    mockSession(me);
    const res = await coverage(foreign);
    expect(res.statusCode).toBe(404);
  });

  it('coverage forbids a non-advertiser (403)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const id = await seedCampaign(owner);
    mockSession(owner, 'individual_owner');
    expect((await coverage(id)).statusCode).toBe(403);
  });
});
