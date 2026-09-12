import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
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
  type DispatchAcceptation,
  type DispatchCreneau,
  type NewUser,
  screenhosts,
  users,
  zones,
} from '../src/db/schema.js';
import { deriveOwnerDecision, screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CAMP-E1 / SUPA-1 slice 1 — GET /api/screenhosts/campaigns: the owner's « Mes campagnes » read,
// grouped per campaign over the owner's dispatch allocations (ANY statut). Modelled on
// screenhost-allocations.test.ts (same mocks, same reference-table sweep).

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
      email: `ocamp${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedVenue = async (ownerId: string, name: string): Promise<string> => {
  const [sh] = await db.insert(screenhosts).values({ name, ownerId }).returning();
  return sh?.id ?? '';
};

const CRENEAUX: DispatchCreneau[] = [{ date: '2024-01-01', hour: 12, reps: 100, impressions: 500 }];

const seededSectorIds: string[] = [];
const seededZoneIds: string[] = [];

// One campaign + its frozen plan. Allocations are seeded separately (per venue) so a campaign
// can span several venues of one owner AND a foreign owner's venue.
const seedCampaign = async (
  advertiserId: string,
  opts: {
    name?: string;
    status?: 'pending' | 'upcoming' | 'active' | 'completed';
    createdAt?: Date;
    creative?: { kind: 'video' | 'photo'; duration: number | null };
    categoryNames?: string[];
    allCategoriesLine?: boolean;
    zoneNames?: string[];
  } = {},
): Promise<{ campaignId: string; planId: string }> => {
  let creativeId: string | null = null;
  if (opts.creative) {
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId,
        creativeType: opts.creative.kind,
        storageKey: `creatives/test-ocamp/${randomUUID()}`,
        durationSeconds: opts.creative.duration,
        validationStatus: 'approved',
      })
      .returning();
    creativeId = creative?.id ?? null;
  }
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: opts.name ?? 'Campagne Owner',
      campaignType: 'standard',
      status: opts.status ?? 'active',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      creativeId,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  const campaignId = campaign?.id ?? '';
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId,
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
  for (const name of opts.categoryNames ?? []) {
    const [sector] = await db
      .insert(businessSectors)
      .values({ name, audience: 'owner' })
      .returning();
    if (sector) seededSectorIds.push(sector.id);
    await db
      .insert(campaignTargeting)
      .values({ campaignId, categoryId: sector?.id ?? null, class: null });
  }
  if (opts.allCategoriesLine) {
    await db.insert(campaignTargeting).values({ campaignId, categoryId: null, class: null });
  }
  for (const name of opts.zoneNames ?? []) {
    const [zone] = await db.insert(zones).values({ name }).returning();
    if (zone) seededZoneIds.push(zone.id);
    await db.insert(campaignZones).values({ campaignId, zoneId: zone?.id ?? '' });
  }
  return { campaignId, planId: plan?.id ?? '' };
};

const seedAllocation = async (
  planId: string,
  screenhostId: string,
  opts: { statut?: DispatchAcceptation; ii?: number; rI?: number; revenu?: string } = {},
): Promise<string> => {
  const [alloc] = await db
    .insert(campaignDispatchAllocation)
    .values({
      planId,
      screenhostId,
      iiPotentiel: opts.ii ?? 500,
      rI: opts.rI ?? 100,
      revenuPrevisionnel: opts.revenu ?? '7.5',
      creneaux: CRENEAUX,
      ...(opts.statut ? { statutAcceptation: opts.statut } : {}),
    })
    .returning();
  return alloc?.id ?? '';
};

interface WireAllocation {
  id: string;
  screenhost_id: string;
  screenhost_name: string;
  statut_acceptation: DispatchAcceptation;
  ii_potentiel: number;
  r_i: number;
  revenu_previsionnel: number;
}
interface WireCampaign {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  advertiser_name: string;
  categories: string[];
  zones: string[];
  creative: { kind: string; duration_seconds: number | null } | null;
  allocations: WireAllocation[];
  totals: { ii_potentiel: number; revenu_previsionnel: number };
  owner_decision: DispatchAcceptation | 'MIXTE';
  created_at: string;
}

describe('GET /api/screenhosts/campaigns — the owner « Mes campagnes » read (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });

  afterEach(async () => {
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

  const list = async (): Promise<WireCampaign[]> => {
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/campaigns' });
    expect(res.statusCode).toBe(200);
    return res.json() as WireCampaign[];
  };

  it('requires authentication (401)', async () => {
    mockNoSession();
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/campaigns' });
    expect(res.statusCode).toBe(401);
  });

  it('a rejected owner is refused by ownerGuard (403)', async () => {
    const owner = await seedUser({ status: 'rejected' });
    mockSession(owner, 'individual_owner', 'rejected');
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/campaigns' });
    expect(res.statusCode).toBe(403);
  });

  it('an owner with no allocation anywhere gets an EMPTY list (200 []), never an error', async () => {
    const owner = await seedUser();
    await seedVenue(owner, 'Café Vide');
    mockSession(owner);
    expect(await list()).toEqual([]);
  });

  it('owner scoping: another owner’s campaigns never appear, and a shared campaign only carries MY allocations', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const advertiser = await seedUser({ role: 'advertiser' });
    const mine = await seedVenue(me, 'Café Mine');
    const theirs = await seedVenue(other, 'Café Theirs');

    const onlyTheirs = await seedCampaign(advertiser, { name: 'Only Theirs' });
    await seedAllocation(onlyTheirs.planId, theirs);
    const shared = await seedCampaign(advertiser, { name: 'Shared' });
    const myAlloc = await seedAllocation(shared.planId, mine);
    await seedAllocation(shared.planId, theirs, { statut: 'REFUSE' });
    mockSession(me);

    const body = await list();
    expect(body.map((c) => c.name)).toEqual(['Shared']);
    expect(body[0]?.allocations.map((a) => a.id)).toEqual([myAlloc]);
    expect(body[0]?.allocations[0]?.screenhost_name).toBe('Café Mine');
    // The foreign REFUSE never contaminates my decision.
    expect(body[0]?.owner_decision).toBe('EN_ATTENTE');
  });

  it('groups across two venues: allocations nested (venues A→Z), totals summed, MIXTE derived', async () => {
    const owner = await seedUser();
    const advertiser = await seedUser({ role: 'advertiser', businessName: 'Acme Pub' });
    const nord = await seedVenue(owner, 'Café Nord');
    const sud = await seedVenue(owner, 'Café Sud');
    const { campaignId, planId } = await seedCampaign(advertiser, { name: 'Deux Cafés' });
    // Insert order SUD then NORD — the payload sorts venues by name.
    await seedAllocation(planId, sud, { statut: 'REFUSE', ii: 300, rI: 50, revenu: '4.25' });
    await seedAllocation(planId, nord, { statut: 'ACCEPTE', ii: 700, rI: 120, revenu: '10.5' });
    mockSession(owner);

    const body = await list();
    expect(body).toHaveLength(1);
    const [row] = body;
    expect(row?.id).toBe(campaignId);
    expect(row?.advertiser_name).toBe('Acme Pub');
    expect(row?.allocations.map((a) => a.screenhost_name)).toEqual(['Café Nord', 'Café Sud']);
    expect(row?.allocations.map((a) => a.statut_acceptation)).toEqual(['ACCEPTE', 'REFUSE']);
    expect(row?.allocations[0]).toMatchObject({
      screenhost_id: nord,
      ii_potentiel: 700,
      r_i: 120,
      revenu_previsionnel: 10.5,
    });
    expect(row?.totals).toEqual({ ii_potentiel: 1000, revenu_previsionnel: 14.75 });
    expect(row?.owner_decision).toBe('MIXTE');
  });

  it('owner_decision is unanimous when every allocation agrees (ACCEPTE / REFUSE), ANY statut listed', async () => {
    const owner = await seedUser();
    const advertiser = await seedUser({ role: 'advertiser' });
    const a = await seedVenue(owner, 'Venue A');
    const b = await seedVenue(owner, 'Venue B');
    const accepted = await seedCampaign(advertiser, {
      name: 'Accepted',
      createdAt: new Date('2024-03-01T00:00:00Z'),
    });
    await seedAllocation(accepted.planId, a, { statut: 'ACCEPTE' });
    await seedAllocation(accepted.planId, b, { statut: 'ACCEPTE' });
    const refused = await seedCampaign(advertiser, {
      name: 'Refused',
      status: 'completed',
      createdAt: new Date('2024-02-01T00:00:00Z'),
    });
    await seedAllocation(refused.planId, a, { statut: 'REFUSE' });
    const pending = await seedCampaign(advertiser, {
      name: 'Pending',
      status: 'upcoming',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    });
    await seedAllocation(pending.planId, b);
    mockSession(owner);

    const body = await list();
    // Newest campaign first (campaigns.created_at DESC).
    expect(body.map((c) => c.name)).toEqual(['Accepted', 'Refused', 'Pending']);
    expect(body.map((c) => c.owner_decision)).toEqual(['ACCEPTE', 'REFUSE', 'EN_ATTENTE']);
    expect(body.map((c) => c.status)).toEqual(['active', 'completed', 'upcoming']);
  });

  it('payload carries the proposal: advertiser (business_name ?? contact_name), category/zone NAMES, creative meta', async () => {
    const owner = await seedUser();
    const advertiser = await seedUser({ role: 'advertiser', contactName: 'Sami Contact' });
    const venue = await seedVenue(owner, 'Café Proposal');
    const tag = randomUUID().slice(0, 8);
    const full = await seedCampaign(advertiser, {
      name: 'Full',
      createdAt: new Date('2024-02-01T00:00:00Z'),
      creative: { kind: 'video', duration: 20 },
      categoryNames: [`Resto ${tag}`, `Café ${tag}`],
      zoneNames: [`Zone B ${tag}`, `Zone A ${tag}`],
    });
    await seedAllocation(full.planId, venue);
    const bare = await seedCampaign(advertiser, {
      name: 'Bare',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      categoryNames: [`Bar ${tag}`],
      allCategoriesLine: true,
    });
    await seedAllocation(bare.planId, venue);
    mockSession(owner);

    const [fullRow, bareRow] = await list();
    expect(fullRow).toMatchObject({
      name: 'Full',
      campaign_type: 'standard',
      start_date: '2024-01-01',
      end_date: '2024-01-31',
      advertiser_name: 'Sami Contact',
      categories: [`Café ${tag}`, `Resto ${tag}`],
      zones: [`Zone A ${tag}`, `Zone B ${tag}`],
      creative: { kind: 'video', duration_seconds: 20 },
    });
    expect(fullRow?.created_at).toBe('2024-02-01T00:00:00.000Z');
    // An ALL-categories line collapses to [], no zones → [], no creative → null.
    expect(bareRow).toMatchObject({ name: 'Bare', categories: [], zones: [], creative: null });
    // Classes are engine-internal — never owner-facing on this surface.
    expect(JSON.stringify([fullRow, bareRow])).not.toContain('"class"');
  });
});

describe('deriveOwnerDecision (pure)', () => {
  it('is unanimous when every allocation agrees, MIXTE otherwise', () => {
    expect(deriveOwnerDecision(['EN_ATTENTE'])).toBe('EN_ATTENTE');
    expect(deriveOwnerDecision(['ACCEPTE', 'ACCEPTE'])).toBe('ACCEPTE');
    expect(deriveOwnerDecision(['REFUSE', 'REFUSE'])).toBe('REFUSE');
    expect(deriveOwnerDecision(['ACCEPTE', 'EN_ATTENTE'])).toBe('MIXTE');
    expect(deriveOwnerDecision(['ACCEPTE', 'REFUSE'])).toBe('MIXTE');
  });

  it('degrades to EN_ATTENTE on an empty input (never reached by the route)', () => {
    expect(deriveOwnerDecision([])).toBe('EN_ATTENTE');
  });
});
