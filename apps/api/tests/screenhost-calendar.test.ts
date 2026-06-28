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
// in tests never touches the real sync wire — same isolation the allocations/WiFi suites use.
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
      email: `cal${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const CRENEAUX: DispatchCreneau[] = [
  { date: '2024-03-04', hour: 9, reps: 80, impressions: 400 },
  { date: '2024-03-05', hour: 18, reps: 120, impressions: 720 },
];

// Seed the full chain advertiser→campaign→plan→(screenhost owned by `ownerId`)→allocation and return
// the ids. statutAcceptation defaults to ACCEPTE here (the calendar surface), unless `statut` is set.
const seedAllocation = async (
  ownerId: string,
  opts: {
    statut?: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
    campaignName?: string;
    creneaux?: DispatchCreneau[];
  } = {},
): Promise<{ allocationId: string; screenhostId: string; campaignId: string }> => {
  const advertiser = await seedUser({ role: 'advertiser' });
  const [sh] = await db.insert(screenhosts).values({ name: 'Café Calendar', ownerId }).returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({
      advertiserId: advertiser,
      name: opts.campaignName ?? 'Campagne Calendar',
      campaignType: 'standard',
      status: 'active',
      startDate: '2024-03-01',
      endDate: '2024-03-31',
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
      creneaux: opts.creneaux ?? CRENEAUX,
      statutAcceptation: opts.statut ?? 'ACCEPTE',
    })
    .returning();
  return {
    allocationId: alloc?.id ?? '',
    screenhostId: sh?.id ?? '',
    campaignId: campaign?.id ?? '',
  };
};

interface CalendarItem {
  id: string;
  campaign_id: string;
  campaign_name: string;
  start_date: string | null;
  end_date: string | null;
  screenhost_id: string;
  screenhost_name: string;
  creneaux: Array<{ date: string; hour: number; impressions: number }>;
}

describe('screenhost dispatch calendar (owner-scoped, ACCEPTE only, real Postgres)', () => {
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

  it('lists only the caller’s ACCEPTE allocations (not EN_ATTENTE/REFUSE, not other owners’)', async () => {
    const me = await seedUser();
    const other = await seedUser();
    const accepted = await seedAllocation(me, { statut: 'ACCEPTE', campaignName: 'Accepted Mine' });
    await seedAllocation(me, { statut: 'EN_ATTENTE', campaignName: 'Pending Mine' });
    await seedAllocation(me, { statut: 'REFUSE', campaignName: 'Rejected Mine' });
    await seedAllocation(other, { statut: 'ACCEPTE', campaignName: 'Accepted Other' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/calendar' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CalendarItem[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe(accepted.allocationId);
    expect(body[0]?.campaign_name).toBe('Accepted Mine');
  });

  it('returns the campaign window + the créneaux (date/hour) for each accepted allocation', async () => {
    const me = await seedUser();
    await seedAllocation(me, { statut: 'ACCEPTE', campaignName: 'With Créneaux' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/calendar' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CalendarItem[];
    expect(body).toHaveLength(1);
    const item = body[0]!;
    expect(item.start_date).toBe('2024-03-01');
    expect(item.end_date).toBe('2024-03-31');
    expect(item.screenhost_name).toBe('Café Calendar');
    expect(item.creneaux).toEqual([
      { date: '2024-03-04', hour: 9, impressions: 400 },
      { date: '2024-03-05', hour: 18, impressions: 720 },
    ]);
  });

  it('does not leak ANOTHER owner’s accepted allocations', async () => {
    const me = await seedUser();
    const other = await seedUser();
    await seedAllocation(other, { statut: 'ACCEPTE', campaignName: 'Not Mine' });
    mockSession(me);

    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/calendar' });
    expect(res.statusCode).toBe(200);
    expect(res.json() as CalendarItem[]).toHaveLength(0);
  });

  it('requires authentication (401)', async () => {
    mockNoSession();
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/calendar' });
    expect(res.statusCode).toBe(401);
  });
});
