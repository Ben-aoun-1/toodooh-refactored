import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  type DispatchCreneau,
  type NewUser,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

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
const seedAllocation = async (
  ownerId: string,
  opts: { statut?: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE'; campaignName?: string } = {},
): Promise<{ allocationId: string; screenhostId: string; campaignId: string }> => {
  const advertiser = await seedUser({ role: 'advertiser' });
  const [sh] = await db.insert(screenhosts).values({ name: 'Café Alloc', ownerId }).returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: opts.campaignName ?? 'Campagne Alloc',
      campaignType: 'standard',
      status: 'active',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
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
  return {
    allocationId: alloc?.id ?? '',
    screenhostId: sh?.id ?? '',
    campaignId: campaign?.id ?? '',
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

  it('list requires authentication (401)', async () => {
    mockNoSession();
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/allocations' });
    expect(res.statusCode).toBe(401);
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
