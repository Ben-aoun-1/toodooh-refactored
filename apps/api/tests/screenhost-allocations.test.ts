import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  campaignTargeting,
  campaignZones,
  creatives,
  type DispatchCreneau,
  type NewUser,
  screenhosts,
  users,
  zones,
} from '../src/db/schema.js';
import { activeAllocationsForScreenhost } from '../src/lib/playout/active-allocations.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// The wedooh re-push is mocked (the screenhostsRoutes plugin imports it) so registering the router
// in tests never touches the real sync wire — same isolation the WiFi suite uses.
const pushSpy = vi.hoisted(() =>
  vi.fn<(ownerId: string, logger: unknown) => Promise<void>>(() => Promise.resolve()),
);
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: pushSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

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
      email: `alloc${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const CRENEAUX: DispatchCreneau[] = [{ date: '2024-01-01', hour: 12, reps: 100, impressions: 500 }];

// Seed the full chain advertiser→campaign→plan→(screenhost owned by `ownerId`)→allocation and return
// the allocation id. statutAcceptation is left UNSET so the column default (EN_ATTENTE) applies,
// unless `statut` is passed.
// CF-O1 proposal fixtures: `creative` links an approved creative (optionally uploading real bytes to
// the test MinIO), `categoryNames`/`zoneNames` create targeting/zone rows. business_sectors and
// zones survive resetAuthTables (no users FK), and db.test/reference.test pin EXACT seed counts —
// so seeded rows are tracked and deleted in afterEach (links first, FK order), and names carry a
// per-run random tag so a crashed run can never collide with the canonical seeds.
// B-ACC1 — Tunis calendar days for the live/expired windows (the route compares on Tunis « today »).
const tunisIso = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(d);
const daysFromNow = (days: number): string => tunisIso(new Date(Date.now() + days * 86_400_000));
const LIVE_WINDOW = { start: daysFromNow(0), end: daysFromNow(30) };

const seededSectorIds: string[] = [];
const seededZoneIds: string[] = [];
const seedAllocation = async (
  ownerId: string,
  opts: {
    statut?: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
    campaignName?: string;
    campaignStatus?: 'pending' | 'upcoming' | 'active' | 'completed' | 'rejected' | 'draft';
    window?: { start: string; end: string };
    creative?: { kind: 'video' | 'photo'; duration: number | null; bytes?: Buffer };
    categoryNames?: string[];
    allCategoriesLine?: boolean;
    zoneNames?: string[];
  } = {},
): Promise<{
  allocationId: string;
  screenhostId: string;
  campaignId: string;
  storageKey: string | null;
}> => {
  const advertiser = await seedUser({ role: 'advertiser' });
  const [sh] = await db.insert(screenhosts).values({ name: 'Café Alloc', ownerId }).returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: opts.campaignName ?? 'Campagne Alloc',
      campaignType: 'standard',
      status: opts.campaignStatus ?? 'active',
      // B-ACC1 — the default window is LIVE (Tunis today → +30 days): the decision queue no longer
      // lists proposals whose campaign has already ended, so a fixed 2024 window would vanish.
      startDate: opts.window?.start ?? LIVE_WINDOW.start,
      endDate: opts.window?.end ?? LIVE_WINDOW.end,
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: campaign?.id ?? '',
      iCible: 1000,
      cpm: '15',
      sSpotSeconds: 10,
      tTierCoef: '1.0',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '3.33',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 1000,
      nMin: 1,
      nMax: 20,
      nRetenus: 1,
    })
    .returning();
  const [alloc] = await db
    .insert(campaignDispatchAllocation)
    .values({
      planId: plan?.id ?? '',
      screenhostId: sh?.id ?? '',
      iiPotentiel: 500,
      rI: 100,
      revenuPrevisionnel: '7.5',
      creneaux: CRENEAUX,
      ...(opts.statut ? { statutAcceptation: opts.statut } : {}),
    })
    .returning();

  let storageKey: string | null = null;
  if (opts.creative) {
    storageKey = `creatives/test-alloc/${campaign?.id ?? randomUUID()}`;
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: opts.creative.kind,
        storageKey,
        durationSeconds: opts.creative.duration,
        validationStatus: 'approved',
      })
      .returning();
    await db
      .update(campaigns)
      .set({ creativeId: creative?.id ?? null })
      .where(eq(campaigns.id, campaign?.id ?? ''));
    if (opts.creative.bytes) {
      await storage.upload({
        key: storageKey,
        body: opts.creative.bytes,
        contentType: opts.creative.kind === 'video' ? 'video/mp4' : 'image/jpeg',
      });
    }
  }
  for (const name of opts.categoryNames ?? []) {
    const [sector] = await db
      .insert(businessSectors)
      .values({ name, audience: 'owner' })
      .returning();
    if (sector) seededSectorIds.push(sector.id);
    await db
      .insert(campaignTargeting)
      .values({ campaignId: campaign?.id ?? '', categoryId: sector?.id ?? null, class: null });
  }
  if (opts.allCategoriesLine) {
    await db
      .insert(campaignTargeting)
      .values({ campaignId: campaign?.id ?? '', categoryId: null, class: null });
  }
  for (const name of opts.zoneNames ?? []) {
    const [zone] = await db.insert(zones).values({ name }).returning();
    if (zone) seededZoneIds.push(zone.id);
    await db
      .insert(campaignZones)
      .values({ campaignId: campaign?.id ?? '', zoneId: zone?.id ?? '' });
  }

  return {
    allocationId: alloc?.id ?? '',
    screenhostId: sh?.id ?? '',
    campaignId: campaign?.id ?? '',
    storageKey,
  };
};

const readAlloc = async (id: string) => {
  const [a] = await db
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.id, id))
    .limit(1);
  return a;
};

describe('screenhost dispatch allocation accept/reject (owner-scoped, real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    // Sweep this test's reference-table rows (links first — targeting/zone FKs are NO ACTION):
    // business_sectors/zones survive the users-cascade truncate, and other suites pin exact seeds.
    if (seededSectorIds.length > 0) {
      await db
        .delete(campaignTargeting)
        .where(inArray(campaignTargeting.categoryId, seededSectorIds));
      await db.delete(businessSectors).where(inArray(businessSectors.id, seededSectorIds));
      seededSectorIds.length = 0;
    }
    if (seededZoneIds.length > 0) {
      await db.delete(campaignZones).where(inArray(campaignZones.zoneId, seededZoneIds));
      await db.delete(zones).where(inArray(zones.id, seededZoneIds));
      seededZoneIds.length = 0;
    }
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── default EN_ATTENTE ──────────────────────────────────────────────────────
  it('new allocations default to EN_ATTENTE (await acceptance)', async () => {
    const owner = await seedUser();
    const { allocationId } = await seedAllocation(owner);
    expect((await readAlloc(allocationId))?.statutAcceptation).toBe('EN_ATTENTE');
  });

  // ── GET /api/screenhosts/allocations ────────────────────────────────────────
  it('lists only the caller’s EN_ATTENTE allocations (not accepted/rejected, not other owners’)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const pending = await seedAllocation(me, { campaignName: 'Pending Mine' });
    await seedAllocation(me, { statut: 'ACCEPTE', campaignName: 'Accepted Mine' });
    await seedAllocation(other, { campaignName: 'Pending Other' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/allocations' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; campaign_name: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe(pending.allocationId);
    expect(body[0]?.campaign_name).toBe('Pending Mine');
  });

  // B-ACC1 (Mejri/Kais QA) — « Campagnes à valider » still offered proposals whose campaign was
  // expired (end_date < today) or settled: the queue filtered on statut_acceptation alone.
  it('B-ACC1: an EN_ATTENTE proposal on an EXPIRED or SETTLED campaign leaves the queue; a live one stays', async () => {
    const me = await seedUser();
    const live = await seedAllocation(me, { campaignName: 'Live active' });
    const upcoming = await seedAllocation(me, {
      campaignName: 'Live upcoming',
      campaignStatus: 'upcoming',
      window: { start: daysFromNow(3), end: daysFromNow(10) },
    });
    const endsToday = await seedAllocation(me, {
      campaignName: 'Ends today',
      window: { start: daysFromNow(-5), end: daysFromNow(0) },
    });
    await seedAllocation(me, {
      campaignName: 'Expired yesterday',
      window: { start: daysFromNow(-20), end: daysFromNow(-1) },
    });
    await seedAllocation(me, { campaignName: 'Completed', campaignStatus: 'completed' });
    await seedAllocation(me, { campaignName: 'Rejected', campaignStatus: 'rejected' });
    await seedAllocation(me, { campaignName: 'Draft', campaignStatus: 'draft' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/allocations' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; campaign_name: string }>;
    expect(body.map((r) => r.id).sort()).toEqual(
      [live.allocationId, upcoming.allocationId, endsToday.allocationId].sort(),
    );
    expect(body.map((r) => r.campaign_name)).not.toContain('Expired yesterday');
    expect(body.map((r) => r.campaign_name)).not.toContain('Completed');
  });

  it('list requires authentication (401)', async () => {
    mockNoSession();
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/allocations' });
    expect(res.statusCode).toBe(401);
  });

  // ── CF-O1: the full proposal payload ────────────────────────────────────────
  it('payload carries the full proposal: type, category NAMES, zone NAMES, creative meta', async () => {
    const owner = await seedUser();
    const tag = randomUUID().slice(0, 8);
    // Insert order is deliberately non-alphabetical — the payload sorts names ascending.
    await seedAllocation(owner, {
      creative: { kind: 'video', duration: 20 },
      categoryNames: [`Resto ${tag}`, `Café ${tag}`],
      zoneNames: [`Zone B ${tag}`, `Zone A ${tag}`],
    });
    mockSession(owner);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/allocations' });
    expect(res.statusCode).toBe(200);
    const [row] = res.json() as Array<Record<string, unknown>>;
    expect(row).toMatchObject({
      campaign_type: 'standard',
      categories: [`Café ${tag}`, `Resto ${tag}`],
      zones: [`Zone A ${tag}`, `Zone B ${tag}`],
      creative: { kind: 'video', duration_seconds: 20 },
    });
    // Classes are engine-internal — never owner-facing on this surface.
    expect(JSON.stringify(row)).not.toContain('"class"');
  });

  it('empty proposal criteria: no zones → [], no targeting → [], no creative → null', async () => {
    const owner = await seedUser();
    await seedAllocation(owner);
    mockSession(owner);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/allocations' });
    const [row] = res.json() as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ categories: [], zones: [], creative: null });
  });

  it('an ALL-categories targeting line (NULL category) collapses categories to []', async () => {
    const owner = await seedUser();
    const tag = randomUUID().slice(0, 8);
    await seedAllocation(owner, {
      categoryNames: [`Café ${tag}`],
      allCategoriesLine: true,
    });
    mockSession(owner);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/allocations' });
    const [row] = res.json() as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ categories: [] });
  });

  // ── CF-O1: GET /allocations/:id/creative-url (owner-scoped presign) ─────────
  it('presigns the spot for the allocation owner — url present AND fetchable from MinIO', async () => {
    const owner = await seedUser();
    const bytes = Buffer.from(`spot-bytes-${randomUUID()}`);
    const { allocationId, storageKey } = await seedAllocation(owner, {
      creative: { kind: 'photo', duration: 10, bytes },
    });
    mockSession(owner);

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/screenhosts/allocations/${allocationId}/creative-url`,
      });
      expect(res.statusCode).toBe(200);
      const { url } = res.json() as { url: string };
      expect(url).toContain(storageKey ?? '');
      const fetched = await fetch(url);
      expect(fetched.status).toBe(200);
      expect(await fetched.text()).toBe(bytes.toString());
    } finally {
      if (storageKey) await storage.delete({ key: storageKey }).catch(() => undefined);
    }
  });

  it('a FOREIGN owner gets a 404 indistinguishable from a missing allocation', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const { allocationId } = await seedAllocation(other, {
      creative: { kind: 'video', duration: 15 },
    });
    mockSession(me);

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/screenhosts/allocations/${allocationId}/creative-url`,
    });
    const missing = await app.inject({
      method: 'GET',
      url: `/api/screenhosts/allocations/${randomUUID()}/creative-url`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.json()).toEqual(missing.json());
  });

  it('an allocation whose campaign has NO creative → 404 (no presign path)', async () => {
    const owner = await seedUser();
    const { allocationId } = await seedAllocation(owner);
    mockSession(owner);

    const res = await app.inject({
      method: 'GET',
      url: `/api/screenhosts/allocations/${allocationId}/creative-url`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('creative-url rejects a non-uuid id (400) and requires authentication (401)', async () => {
    const owner = await seedUser();
    mockSession(owner);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/screenhosts/allocations/not-a-uuid/creative-url',
    });
    expect(bad.statusCode).toBe(400);

    mockNoSession();
    const anon = await app.inject({
      method: 'GET',
      url: `/api/screenhosts/allocations/${randomUUID()}/creative-url`,
    });
    expect(anon.statusCode).toBe(401);
  });

  // ── accept / reject ─────────────────────────────────────────────────────────
  it('owner accepts their allocation (→ ACCEPTE)', async () => {
    const owner = await seedUser();
    const { allocationId } = await seedAllocation(owner);
    mockSession(owner);

    const res = await app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/accept`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { statut_acceptation: string }).statut_acceptation).toBe('ACCEPTE');
    expect((await readAlloc(allocationId))?.statutAcceptation).toBe('ACCEPTE');
  });

  it('owner rejects their allocation (→ REFUSE)', async () => {
    const owner = await seedUser();
    const { allocationId } = await seedAllocation(owner);
    mockSession(owner);

    const res = await app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/reject`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { statut_acceptation: string }).statut_acceptation).toBe('REFUSE');
    expect((await readAlloc(allocationId))?.statutAcceptation).toBe('REFUSE');
  });

  it("CF-S1: an UPCOMING campaign's allocation is DECIDABLE but NOT airable until active", async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    // A live window (today inside it) so ONLY the status gate decides airability.
    const today = new Date();
    const iso = (d: Date): string => d.toISOString().slice(0, 10);
    const start = iso(new Date(today.getTime() - 24 * 3600 * 1000));
    const end = iso(new Date(today.getTime() + 10 * 24 * 3600 * 1000));
    const { allocationId, screenhostId, campaignId } = await seedAllocation(owner, {
      campaignStatus: 'upcoming',
      window: { start, end },
    });
    // The airability gate also requires an APPROVED linked creative — give the campaign one so
    // the STATUS is the only variable under test.
    const [adv] = await db
      .select({ advertiserId: campaigns.advertiserId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: adv?.advertiserId ?? '',
        creativeType: 'video',
        storageKey: `creatives/gate/${campaignId}`,
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    await db
      .update(campaigns)
      .set({ creativeId: creative?.id ?? null })
      .where(eq(campaigns.id, campaignId));
    mockSession(owner);

    // Decidable: the owner accepts while the campaign is still upcoming.
    const res = await app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/accept`,
    });
    expect(res.statusCode).toBe(200);

    // NOT airable: the playout gate requires status='active' — upcoming is excluded…
    expect(await activeAllocationsForScreenhost(screenhostId, new Date())).toHaveLength(0);

    // …and appears the moment the lifecycle flips it to active.
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    expect((await activeAllocationsForScreenhost(screenhostId, new Date())).length).toBeGreaterThan(
      0,
    );
  });

  it('cannot accept ANOTHER owner’s allocation (404, no cross-owner write)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const { allocationId } = await seedAllocation(other);
    mockSession(me);

    const res = await app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/accept`,
    });
    expect(res.statusCode).toBe(404);
    // Untouched — still EN_ATTENTE.
    expect((await readAlloc(allocationId))?.statutAcceptation).toBe('EN_ATTENTE');
  });

  it('cannot reject ANOTHER owner’s allocation (404, no cross-owner write)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const { allocationId } = await seedAllocation(other);
    mockSession(me);

    const res = await app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/reject`,
    });
    expect(res.statusCode).toBe(404);
    expect((await readAlloc(allocationId))?.statutAcceptation).toBe('EN_ATTENTE');
  });

  it('rejects a non-uuid allocation id (400)', async () => {
    const owner = await seedUser();
    mockSession(owner);
    const res = await app.inject({
      method: 'POST',
      url: '/api/screenhosts/allocations/not-a-uuid/accept',
    });
    expect(res.statusCode).toBe(400);
  });

  it('accept requires authentication (401)', async () => {
    const owner = await seedUser();
    const { allocationId } = await seedAllocation(owner);
    mockNoSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/accept`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('a REJECTED owner cannot accept (403, ownerGuard)', async () => {
    const owner = await seedUser({ status: 'rejected' });
    const { allocationId } = await seedAllocation(owner);
    mockSession(owner, 'individual_owner', 'rejected');
    const res = await app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/accept`,
    });
    expect(res.statusCode).toBe(403);
    expect((await readAlloc(allocationId))?.statutAcceptation).toBe('EN_ATTENTE');
  });
});
