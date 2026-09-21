import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignZones,
  campaigns,
  screenhostAffluence,
  screenhosts,
  users,
  zones,
} from '../src/db/schema.js';
import { campaignTargetingRoutes } from '../src/routes/campaign-targeting.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { sweepZones } from './helpers/zones.js';

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
  zoneId?: string | null;
  /** MAP-2 — coverage = the dispatch-eligible set, so a venue needs hours + capacity to count. */
  hours?: { open: number; close: number } | null;
  capacity?: number | null;
}): Promise<string> => {
  const hours = opts.hours === undefined ? { open: 8, close: 22 } : opts.hours;
  // ELIG-2 / MAP-4 (2026-09-16) — a covered venue also needs an APPROVED owner and one affluence
  // value; every venue here gets both, so each test still isolates the gate it is about. (The
  // campaigns are date-less drafts, so MAP-4's availability gate does not apply to them.)
  const ownerId = await seedApprovedOwner();
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: opts.name ?? 'Venue',
      ownerId,
      businessSectorId: opts.categoryId,
      class: opts.cls,
      isActive: opts.active ?? true,
      latitude: opts.lat === undefined ? '36.80000000' : opts.lat,
      longitude: opts.lng === undefined ? '10.18000000' : opts.lng,
      zoneId: opts.zoneId ?? null,
      openingHour: hours?.open ?? null,
      closingHour: hours?.close ?? null,
      broadcastCapacity: opts.capacity === undefined ? 1 : opts.capacity,
    })
    .returning();
  const id = sh?.id ?? '';
  await db
    .insert(screenhostAffluence)
    .values(bothHalves({ screenhostId: id, dayOfWeek: 1, hour: 10, estimatedImpressions: 100 }));
  return id;
};

// CF-U2 — a zone + campaign-zone pair for the whole-network coverage tests. zones SURVIVE
// resetAuthTables (not an auth table): every seeded id is tracked and swept in afterEach
// (TEST-ISO1 — another file pins the exact zone catalogue). The uuid suffix stays: zone names are
// UNIQUE, and a crashed run can still leave a row behind.
const seededZoneIds: string[] = [];
const seedZone = async (name: string): Promise<string> => {
  const [z] = await db
    .insert(zones)
    .values({ name: `${name} ${crypto.randomUUID()}` })
    .returning();
  if (z) seededZoneIds.push(z.id);
  return z?.id ?? '';
};
const linkCampaignZone = async (campaignId: string, zoneId: string): Promise<void> => {
  await db.insert(campaignZones).values({ campaignId, zoneId });
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
    await sweepZones(seededZoneIds.splice(0));
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

  // ── CF-U2 (VF US-2.1) — NO targeting = the WHOLE NETWORK, zone-filtered when zoned ────────────
  it('coverage with NO targeting returns ALL active, located venues (whole network)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA, catB] = await ownerCategoryIds();
    await seedScreenhost({ categoryId: catA ?? null, cls: 'premium', name: 'A' });
    await seedScreenhost({ categoryId: catB ?? null, cls: 'moyen', name: 'B' });
    await seedScreenhost({ categoryId: null, cls: null, name: 'Unclassified' });
    mockSession(me);
    const res = await coverage(id);
    expect(res.statusCode).toBe(200);
    expect(coverageDots(res)).toHaveLength(3); // the whole network, not [] (mirror retired)
  });

  it('the no-targeting default still respects the campaign zones (CF-Z1)', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    const zoneIn = await seedZone('Zone In');
    const zoneOut = await seedZone('Zone Out');
    const inZone = await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'InZone',
      zoneId: zoneIn,
    });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'OutZone',
      zoneId: zoneOut,
    });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'NoZone',
      zoneId: null,
    });
    await linkCampaignZone(id, zoneIn);
    mockSession(me);
    const res = await coverage(id);
    expect(res.statusCode).toBe(200);
    const dots = coverageDots(res);
    expect(dots).toHaveLength(1); // zone-scoped: the out-of-zone and NULL-zone venues are excluded
    expect(dots[0]?.id).toBe(inZone);
  });

  it('AMENDMENT — the zone clause gates the TARGETED path too (dispatch mirror)', async () => {
    // Since CF-Z1 the engine applies screenhostMatchesZones on every eligibility path; a
    // targeted+zoned campaign's preview must not show venues dispatch will exclude.
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    const zoneIn = await seedZone('Zone In');
    const zoneOut = await seedZone('Zone Out');
    const inZone = await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'MatchInZone',
      zoneId: zoneIn,
    });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'MatchOutZone',
      zoneId: zoneOut,
    });
    mockSession(me);
    await put(id, [{ category_id: catA ?? null, class: 'premium' }]);
    await linkCampaignZone(id, zoneIn);
    const res = await coverage(id);
    expect(res.statusCode).toBe(200);
    const dots = coverageDots(res);
    expect(dots).toHaveLength(1); // both match the targeting; only the in-zone venue survives
    expect(dots[0]?.id).toBe(inZone);
  });

  it('MAP-2: coverage is the DISPATCH-ELIGIBLE set — no hours or no capacity = not covered; no coordinates = covered but not plotted', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    const plotted = await seedScreenhost({ categoryId: catA ?? null, cls: 'premium', name: 'Ok' });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'NoHours',
      hours: null,
    });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'NoCap',
      capacity: null,
    });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'NoCoords',
      lat: null,
      lng: null,
    });
    mockSession(me);
    const res = await coverage(id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      screenhosts: CoverageDot[];
      covered_count: number;
      without_coordinates: number;
    };
    expect(body.screenhosts.map((d) => d.id)).toEqual([plotted]);
    expect(body.covered_count).toBe(2); // Ok + NoCoords — the caption's number
    expect(body.without_coordinates).toBe(1);
  });

  it('the no-targeting default still excludes inactive venues; an unlocated one is counted, not plotted', async () => {
    const me = await seedUser();
    const id = await seedCampaign(me);
    const [catA] = await ownerCategoryIds();
    const located = await seedScreenhost({ categoryId: catA ?? null, cls: 'premium', name: 'Ok' });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'Inactive',
      active: false,
    });
    await seedScreenhost({
      categoryId: catA ?? null,
      cls: 'premium',
      name: 'NoCoords',
      lat: null,
      lng: null,
    });
    mockSession(me);
    const res = await coverage(id);
    expect(res.statusCode).toBe(200);
    const dots = coverageDots(res);
    expect(dots).toHaveLength(1);
    expect(dots[0]?.id).toBe(located);
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
