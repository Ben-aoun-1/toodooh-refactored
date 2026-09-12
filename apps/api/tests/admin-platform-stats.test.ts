import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaigns,
  cartItems,
  creatives,
  recharges,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { adminPlatformStatsRoutes } from '../src/routes/admin-platform-stats.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// Integration — real Postgres. resetAuthTables TRUNCATEs users RESTART IDENTITY CASCADE, which
// cascades to campaigns/creatives/recharges/screenhosts/screens (all FK→users), so each test starts
// from an empty graph and can assert EXACT aggregates.
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string, role = 'admin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `stats${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

interface StatsBody {
  users: {
    total: number;
    pending: number;
    approved: number;
    pending_owners: number;
    owners: number;
    advertisers: number;
  };
  screens: { total: number; active: number };
  campaigns: {
    total: number;
    draft: number;
    pending: number;
    active: number;
    rejected: number;
    total_budget_tnd: number;
    average_budget_tnd: number;
  };
  creatives: { total: number; pending: number; approved: number };
  revenue: { total_tnd: number; monthly_tnd: number };
}

describe('GET /api/admin/platform-stats (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminPlatformStatsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const get = () => app.inject({ method: 'GET', url: '/api/admin/platform-stats' });

  // SIGN-4 — pending_owners must count ONLY the Hosts, so the badge's tooltip cannot mislead.
  it('SIGN-4: pending_owners counts pending Hosts only, never pending advertisers', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId);
    await seedUser({ role: 'advertiser', status: 'pending' });
    await seedUser({ role: 'advertiser', status: 'pending' });
    await seedUser({ role: 'individual_owner', status: 'pending' });
    await seedUser({ role: 'fleet_owner', status: 'pending' });
    await seedUser({ role: 'fleet_owner', status: 'approved' }); // not waiting

    const body = (await get()).json() as StatsBody;
    expect(body.users.pending).toBe(4); // everything actually waiting on the admin
    expect(body.users.pending_owners).toBe(2); // …of which two are Hosts
  });

  // ADM-DSH2 (Mejri/Kais QA) — the tile « Créatives à valider » read 4 while /admin/creatives?status=
  // pending listed nothing. The tile must count EXACTLY what the queue lists: the CF-HF4 gate
  // (a pending creative counts once a campaign linking it is carted or past draft).
  it('ADM-DSH2: creatives.pending counts exactly the rows the moderation queue lists', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId);
    const advertiserId = await seedUser({ role: 'advertiser', status: 'approved' });
    const seedCreative = async (key: string, status: 'pending' | 'approved' | 'rejected') => {
      const [row] = await db
        .insert(creatives)
        .values({ advertiserId, storageKey: key, validationStatus: status })
        .returning();
      return row?.id ?? '';
    };
    // Four uploads nobody carted: pending, but NOT in the queue (Mejri's « 4 »).
    for (let i = 0; i < 4; i += 1) await seedCreative(`creatives/u/${i}`, 'pending');
    // One pending creative on a DRAFT campaign that IS in the cart → in the queue.
    const carted = await seedCreative('creatives/c/1', 'pending');
    const [draft] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: 'Draft carted',
        campaignType: 'standard',
        status: 'draft',
        creativeId: carted,
      })
      .returning();
    await db.insert(cartItems).values({ userId: advertiserId, campaignId: draft?.id ?? '' });
    // One pending creative on a SUBMITTED (pending) campaign, cart cleared → in the queue.
    const submitted = await seedCreative('creatives/s/1', 'pending');
    await db.insert(campaigns).values({
      advertiserId,
      name: 'Submitted',
      campaignType: 'standard',
      status: 'pending',
      creativeId: submitted,
    });
    // One pending creative on a DRAFT campaign NOT carted → not in the queue.
    const draftOnly = await seedCreative('creatives/d/1', 'pending');
    await db.insert(campaigns).values({
      advertiserId,
      name: 'Draft only',
      campaignType: 'standard',
      status: 'draft',
      creativeId: draftOnly,
    });
    // Decided rows list unconditionally.
    await seedCreative('creatives/a/1', 'approved');
    await seedCreative('creatives/r/1', 'rejected');

    const body = (await get()).json() as StatsBody;
    expect(body.creatives.pending).toBe(2);
    expect(body.creatives.approved).toBe(1);
    // total = what GET /api/admin/creatives (unfiltered) lists: 2 pending + approved + rejected.
    expect(body.creatives.total).toBe(4);
  });

  it('403 for a non-admin', async () => {
    mockSession(await seedUser({ role: 'advertiser' }), 'advertiser');
    expect((await get()).statusCode).toBe(403);
  });

  it('derives end-user, screen, campaign, creative and revenue aggregates', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId);

    // End-users: 1 approved advertiser, 1 pending individual_owner, 1 approved fleet_owner.
    // The admin above is an internal account → excluded from the platform-user counts.
    const advertiserId = await seedUser({ role: 'advertiser', status: 'approved' });
    await seedUser({ role: 'individual_owner', status: 'pending' });
    const fleetId = await seedUser({ role: 'fleet_owner', status: 'approved' });

    // Screens: a screenhost with one active + one inactive screen.
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: 'Venue', ownerId: fleetId })
      .returning();
    await db.insert(screens).values([
      { screenhostId: sh!.id, name: 'Écran 1', isActive: true },
      { screenhostId: sh!.id, name: 'Écran 2', isActive: false },
    ]);

    // Campaigns: 1 draft, 1 pending (budget 200), 1 active (budget 100).
    await db.insert(campaigns).values([
      { advertiserId, name: 'C-draft', campaignType: 'standard', status: 'draft' },
      {
        advertiserId,
        name: 'C-pending',
        campaignType: 'standard',
        status: 'pending',
        requestedBudget: '200.00',
      },
      {
        advertiserId,
        name: 'C-active',
        campaignType: 'standard',
        status: 'active',
        requestedBudget: '100.00',
      },
    ]);

    // Creatives: 1 pending SUBMITTED (linked to the pending campaign), 1 approved, and 1 pending
    // UNCARTED upload (no campaign links it) — ADM-DSH2: the last one is invisible to the queue,
    // so it must be invisible to the tile too (it is what made the tile read 4 over an empty queue).
    const [submitted] = await db
      .insert(creatives)
      .values({ advertiserId, storageKey: 'creatives/a/1', validationStatus: 'pending' })
      .returning();
    await db.insert(creatives).values([
      { advertiserId, storageKey: 'creatives/a/2', validationStatus: 'approved' },
      { advertiserId, storageKey: 'creatives/a/3', validationStatus: 'pending' },
    ]);
    await db
      .update(campaigns)
      .set({ creativeId: submitted?.id ?? null })
      .where(eq(campaigns.name, 'C-pending'));

    // Recharges: 1 confirmed (100, this month → counts for total + monthly), 1 pending (50, ignored).
    await db.insert(recharges).values([
      {
        advertiserId,
        amountTnd: '100.00',
        reference: 'FCT-STATS001',
        status: 'confirmed',
        confirmedBy: adminId,
        confirmedAt: new Date(),
      },
      { advertiserId, amountTnd: '50.00', reference: 'FCT-STATS002', status: 'pending' },
    ]);

    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsBody;

    // SIGN-4 — pending_owners is the OWNER half of `pending`: the pending individual_owner above.
    expect(body.users).toEqual({
      total: 3,
      pending: 1,
      approved: 2,
      pending_owners: 1,
      owners: 2,
      advertisers: 1,
    });
    expect(body.screens).toEqual({ total: 2, active: 1 });
    expect(body.campaigns.total).toBe(3);
    expect(body.campaigns.draft).toBe(1);
    expect(body.campaigns.pending).toBe(1);
    expect(body.campaigns.active).toBe(1);
    expect(body.campaigns.total_budget_tnd).toBe(300);
    expect(body.campaigns.average_budget_tnd).toBe(150); // avg over the 2 non-null budgets
    expect(body.creatives).toEqual({ total: 2, pending: 1, approved: 1 }); // the uncarted upload is NOT counted
    expect(body.revenue).toEqual({ total_tnd: 100, monthly_tnd: 100 });
  });
});
