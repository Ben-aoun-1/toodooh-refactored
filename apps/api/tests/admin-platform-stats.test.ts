import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignReconciliation,
  campaigns,
  cartItems,
  creatives,
  recharges,
  reversementLines,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { REDISPATCH_HEARTBEAT_TOLERANCE_MS } from '../src/lib/dispatch/redispatch.js';
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
  screens: { total: number; installed: number; online: number };
  campaigns: {
    total: number;
    draft: number;
    pending: number;
    upcoming: number;
    active: number;
    rejected: number;
    completed: number;
    average_budget_tnd: number;
  };
  creatives: { total: number; pending: number; approved: number };
  revenue: {
    total_tnd: number;
    toodooh_tnd: number;
    monthly: { month: string; total_tnd: number; toodooh_tnd: number };
  };
}

// DASH-1 — the route's clock is injected; every instant in this file is NAMED (UTC `Z`).
// Thu 15 Oct 2026, 10:00 Tunis → the Tunis month is October 2026, i.e.
// [2026-09-30T23:00:00Z, 2026-10-31T23:00:00Z).
const NOW = new Date('2026-10-15T09:00:00Z');

describe('GET /api/admin/platform-stats (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminPlatformStatsRoutes, { now: () => NOW });
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

    // Screens: a screenhost with one screen seen a minute ago and one no device ever answered.
    const [sh] = await db
      .insert(screenhosts)
      .values({ name: 'Venue', ownerId: fleetId })
      .returning();
    await db.insert(screens).values([
      {
        screenhostId: sh!.id,
        name: 'Écran 1',
        isActive: true,
        lastSeenAt: new Date('2026-10-15T08:59:00Z'),
      },
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

    // Recharges: 1 confirmed THIS Tunis month (100) + 1 pending (50). DASH-1 (R1/R2): a top-up is
    // an advertiser PREPAYMENT, not revenue — neither may reach any revenue figure.
    await db.insert(recharges).values([
      {
        advertiserId,
        amountTnd: '100.00',
        reference: 'FCT-STATS001',
        status: 'confirmed',
        confirmedBy: adminId,
        confirmedAt: new Date('2026-10-12T10:00:00Z'),
      },
      { advertiserId, amountTnd: '50.00', reference: 'FCT-STATS002', status: 'pending' },
    ]);

    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsBody;

    // SIGN-4 — pending_owners is the OWNER half of `pending`: the pending individual_owner above.
    // DASH-1 (R5) — owners/advertisers count APPROVED accounts only: the pending owner is waiting,
    // not part of the network.
    expect(body.users).toEqual({
      total: 3,
      pending: 1,
      approved: 2,
      pending_owners: 1,
      owners: 1,
      advertisers: 1,
    });
    expect(body.screens).toEqual({ total: 2, installed: 1, online: 1 });
    expect(body.campaigns.total).toBe(3);
    expect(body.campaigns.draft).toBe(1);
    expect(body.campaigns.pending).toBe(1);
    expect(body.campaigns.active).toBe(1);
    // DASH-1 — « Budget moyen » is left as is (flagged): avg over the 2 non-null budgets, every status.
    expect(body.campaigns.average_budget_tnd).toBe(150);
    // DASH-1 (R1) — the requested-budget sum (« Budget Campagnes ») is gone from the wire.
    expect(body.campaigns).not.toHaveProperty('total_budget_tnd');
    expect(body.creatives).toEqual({ total: 2, pending: 1, approved: 1 }); // the uncarted upload is NOT counted
    // No settlement, no reversement line → zero revenue, whatever the recharges say.
    expect(body.revenue).toEqual({
      total_tnd: 0,
      toodooh_tnd: 0,
      monthly: { month: '2026-10', total_tnd: 0, toodooh_tnd: 0 },
    });
  });

  // ADM-FIX1 — the buckets stopped at draft/pending/active/rejected while `total` counted every
  // row, so an 'upcoming' or 'completed' campaign was invisible on the dashboard yet inflated the
  // total. All six stored statuses have a bucket, and they must SUM to the total.
  it('buckets all SIX stored campaign statuses, and they sum to the total', async () => {
    const adminId = await seedUser({ role: 'admin' });
    const advertiserId = await seedUser({ role: 'advertiser' });
    mockSession(adminId);
    await db.insert(campaigns).values([
      { advertiserId, name: 'C-draft', campaignType: 'standard', status: 'draft' },
      { advertiserId, name: 'C-pending', campaignType: 'standard', status: 'pending' },
      { advertiserId, name: 'C-upcoming', campaignType: 'standard', status: 'upcoming' },
      { advertiserId, name: 'C-upcoming-2', campaignType: 'standard', status: 'upcoming' },
      { advertiserId, name: 'C-active', campaignType: 'standard', status: 'active' },
      { advertiserId, name: 'C-rejected', campaignType: 'standard', status: 'rejected' },
      { advertiserId, name: 'C-completed', campaignType: 'standard', status: 'completed' },
    ]);

    const res = await get();
    expect(res.statusCode).toBe(200);
    const { campaigns: c } = res.json() as StatsBody;
    expect(c.draft).toBe(1);
    expect(c.pending).toBe(1);
    expect(c.upcoming).toBe(2);
    expect(c.active).toBe(1);
    expect(c.rejected).toBe(1);
    expect(c.completed).toBe(1);
    expect(c.total).toBe(7);
    expect(c.draft + c.pending + c.upcoming + c.active + c.rejected + c.completed).toBe(c.total);
  });

  // DASH-1 (R1/R2/R3, operator ruling 2026-09-21). « Revenu total » = Σ campaign_reconciliation
  // .spend_tnd (the advertisers' settled debit — classic AND event settlements both write that
  // table); « Revenu Toodooh » = Σ reversement_lines.toodooh_amount_tnd (every source), the 3 %
  // agent lines with NO agent NOT added; « Revenu mensuel » = both, over the current TUNIS month —
  // the total by reconciled_at, the Toodooh share by settled_at.
  describe('DASH-1 revenue — realised spend, Toodooh share, the Tunis month', () => {
    const seedSettlement = async (
      advertiserId: string,
      screenhostId: string,
      s: {
        name: string;
        campaignType: 'standard' | 'event';
        spendTnd: string;
        reconciledAt: Date;
        toodoohTnd: string;
        settledAt: Date;
      },
    ): Promise<void> => {
      const [c] = await db
        .insert(campaigns)
        .values({
          advertiserId,
          name: s.name,
          campaignType: s.campaignType,
          status: 'completed',
          // A requested budget far above the spend: « Revenu total » must read the SETTLED
          // debit, never the indicative budget.
          requestedBudget: '9999.00',
        })
        .returning();
      const campaignId = c?.id ?? '';
      await db.insert(campaignReconciliation).values({
        campaignId,
        expectedImp: 1000,
        deliveredImp: 1000,
        manquementImp: 0,
        pPerteTnd: '0.0000',
        refundTnd: '0.0000',
        spendTnd: s.spendTnd,
        status: 'reussie',
        reconciledAt: s.reconciledAt,
      });
      await db.insert(reversementLines).values({
        source: s.campaignType === 'event' ? 'event' : 'campaign',
        campaignId,
        screenhostId,
        baseValueTnd: s.spendTnd,
        shAmountTnd: '1.0000',
        toodoohAmountTnd: s.toodoohTnd,
        // The two 3 % agent lines, recorded with NO agent (no referral): R2 does NOT add them.
        agentShAmountTnd: '3.0000',
        agentScAmountTnd: '3.0000',
        agentShId: null,
        agentScId: null,
        settledAt: s.settledAt,
      });
    };

    it('sums settled spend and the Toodooh share, all time and over the Tunis month', async () => {
      const adminId = await seedUser({ role: 'admin' });
      mockSession(adminId);
      const advertiserId = await seedUser({ role: 'advertiser', status: 'approved' });
      const ownerId = await seedUser({ role: 'individual_owner', status: 'approved' });
      const [venue] = await db.insert(screenhosts).values({ name: 'Venue', ownerId }).returning();
      const venueId = venue?.id ?? '';

      // A — classic, Thu 1 Oct 2026 00:30 Tunis (= Wed 30 Sep 23:30 UTC): IN October. The old
      //     server-time (UTC) month put it in September.
      await seedSettlement(advertiserId, venueId, {
        name: 'A-classic-1-oct-0030',
        campaignType: 'standard',
        spendTnd: '100.0000',
        reconciledAt: new Date('2026-09-30T23:30:00Z'),
        toodoohTnd: '44.0000',
        settledAt: new Date('2026-09-30T23:30:00Z'),
      });
      // B — classic, Wed 30 Sep 2026 23:30 Tunis: OUT (September).
      await seedSettlement(advertiserId, venueId, {
        name: 'B-classic-30-sep-2330',
        campaignType: 'standard',
        spendTnd: '40.0000',
        reconciledAt: new Date('2026-09-30T22:30:00Z'),
        toodoohTnd: '17.6000',
        settledAt: new Date('2026-09-30T22:30:00Z'),
      });
      // C — EVENT settlement, Sat 10 Oct 2026 13:00 Tunis: IN.
      await seedSettlement(advertiserId, venueId, {
        name: 'C-event-10-oct',
        campaignType: 'event',
        spendTnd: '25.5000',
        reconciledAt: new Date('2026-10-10T12:00:00Z'),
        toodoohTnd: '11.2200',
        settledAt: new Date('2026-10-10T12:00:00Z'),
      });
      // D — classic, Sun 1 Nov 2026 00:30 Tunis (= Sat 31 Oct 23:30 UTC): OUT (November).
      await seedSettlement(advertiserId, venueId, {
        name: 'D-classic-1-nov-0030',
        campaignType: 'standard',
        spendTnd: '7.0000',
        reconciledAt: new Date('2026-10-31T23:30:00Z'),
        toodoohTnd: '3.0800',
        settledAt: new Date('2026-10-31T23:30:00Z'),
      });
      // E — each figure reads ITS OWN timestamp (R3): reconciled Wed 30 Sep 23:50 Tunis (OUT for
      //     the total), its reversement line settled Thu 1 Oct 00:10 Tunis (IN for Toodooh).
      await seedSettlement(advertiserId, venueId, {
        name: 'E-straddles-the-boundary',
        campaignType: 'standard',
        spendTnd: '10.0000',
        reconciledAt: new Date('2026-09-30T22:50:00Z'),
        toodoohTnd: '4.4000',
        settledAt: new Date('2026-09-30T23:10:00Z'),
      });
      // A confirmed recharge inside the month: a prepayment, never revenue.
      await db.insert(recharges).values({
        advertiserId,
        amountTnd: '500.00',
        reference: 'FCT-DASH1',
        status: 'confirmed',
        confirmedBy: adminId,
        confirmedAt: new Date('2026-10-05T10:00:00Z'),
      });

      const res = await get();
      expect(res.statusCode).toBe(200);
      const { revenue } = res.json() as StatsBody;
      expect(revenue).toEqual({
        total_tnd: 182.5, // A 100 + B 40 + C 25.5 + D 7 + E 10
        toodooh_tnd: 80.3, // 44 + 17.6 + 11.22 + 3.08 + 4.4 — no agent line, no recharge
        monthly: {
          month: '2026-10',
          total_tnd: 125.5, // A 100 + C 25.5 (by reconciled_at)
          toodooh_tnd: 59.62, // A 44 + C 11.22 + E 4.4 (by settled_at)
        },
      });
    });
  });

  // DASH-1 (R4) — « Actifs » read screens.is_active, which NO code writes (always true = Total).
  // « Installés » = paired_at OR last_seen_at (ADM-FIX1's ruling); « En ligne » = a heartbeat
  // within REDISPATCH_HEARTBEAT_TOLERANCE_MS of now (the one liveness rule). is_active is ignored.
  it('R4: screens are counted installed (paired OR seen) and online (heartbeat tolerance)', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId);
    const ownerId = await seedUser({ role: 'fleet_owner', status: 'approved' });
    const [venue] = await db.insert(screenhosts).values({ name: 'Venue', ownerId }).returning();
    const screenhostId = venue?.id ?? '';
    const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
    await db.insert(screens).values([
      // Declared, no device ever answered → neither.
      { screenhostId, name: 'Jamais', isActive: true },
      // Paired, never heard from → installed, offline.
      { screenhostId, name: 'Appairé', pairedAt: new Date('2026-09-01T08:00:00Z') },
      // Seen within the tolerance → installed AND online.
      {
        screenhostId,
        name: 'Frais',
        pairedAt: new Date('2026-09-01T08:00:00Z'),
        lastSeenAt: ago(REDISPATCH_HEARTBEAT_TOLERANCE_MS - 60_000),
      },
      // Seen, but past the tolerance (no pairing stamp) → installed, offline.
      { screenhostId, name: 'Périmé', lastSeenAt: ago(REDISPATCH_HEARTBEAT_TOLERANCE_MS + 60_000) },
      // is_active = false is irrelevant: seen a minute ago → installed AND online.
      { screenhostId, name: 'Inactif mais vivant', isActive: false, lastSeenAt: ago(60_000) },
    ]);

    const { screens: s } = (await get()).json() as StatsBody;
    expect(s).toEqual({ total: 5, installed: 4, online: 2 });
  });

  // DASH-1 (R5) — Propriétaires / Annonceurs count APPROVED accounts only; Utilisateurs · Total is
  // every end-user status EXCEPT banned. users.pending and pending_owners are unchanged (SIGN-4's
  // queue badge reads them).
  it('R5: owners/advertisers are approved only; the total drops banned accounts only', async () => {
    const adminId = await seedUser({ role: 'admin' });
    mockSession(adminId);
    await seedUser({ role: 'superadmin' }); // internal — never a platform user
    await seedUser({ role: 'screenhost_agent' }); // internal — never a platform user
    await seedUser({ role: 'advertiser', status: 'approved' });
    await seedUser({ role: 'advertiser', status: 'approved' });
    await seedUser({ role: 'advertiser', status: 'pending' });
    await seedUser({ role: 'advertiser', status: 'rejected' });
    await seedUser({ role: 'advertiser', status: 'banned' });
    await seedUser({ role: 'individual_owner', status: 'approved' });
    await seedUser({ role: 'individual_owner', status: 'banned' });
    await seedUser({ role: 'fleet_owner', status: 'approved' });
    await seedUser({ role: 'fleet_owner', status: 'pending' });
    await seedUser({ role: 'fleet_owner', status: 'rejected' });

    const { users: u } = (await get()).json() as StatsBody;
    expect(u).toEqual({
      total: 8, // 10 end users − 2 banned (rejected accounts still count)
      pending: 2, // advertiser + fleet_owner — unchanged semantics
      approved: 4,
      pending_owners: 1, // the pending fleet_owner — unchanged semantics
      owners: 2, // approved individual_owner + approved fleet_owner
      advertisers: 2, // the two approved advertisers
    });
  });
});
