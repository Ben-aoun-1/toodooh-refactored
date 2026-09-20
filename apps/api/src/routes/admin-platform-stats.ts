import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, creatives, recharges, screens, users } from '../db/schema.js';
import { submittedCreativeGate } from '../lib/creatives.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Admin platform-stats — the dashboard's headline numbers, DERIVED from the new-engine Postgres
// tables (de-Supabase of the dead platform-stats RPCs/business_profiles reads). Every route is
// [requireAuth, requireAdmin]; a non-admin 403s. Read-only aggregation; no migration.
//
// What is derivable vs FLAGGED-no-source (the FE renders the missing ones as 0/—/empty, never fakes):
//  - users:     total/pending/approved/pending_owners/owners/advertisers — scoped to
//               END-USER roles (internal accounts are not platform users, mirroring the
//               moderation-queue semantics).
//  - screens:   total + active (is_active). "online" has NO reliable signal yet → omitted.
//  - campaigns: total + per-status + requested-budget sum/avg (the indicative budget; real pricing
//               is L-price). "views"/impressions are NOT modelled yet → omitted.
//  - creatives: total/pending/approved (validation_status) — the new media-review counters that
//               replace the legacy `videos` table. ADM-DSH2: counted through the queue's CF-HF4
//               « submitted » gate, so the tile and GET /api/admin/creatives agree row for row.
//  - revenue:   total = SUM(confirmed recharges); monthly = confirmed THIS calendar month.
//  - FLAGGED (no new-engine source, NOT returned): events, occupancy/uptime, per-screen revenue
//    (top screens), revenue growth-rate, daily-revenue projection, average-revenue-per-screen.

// End-user roles (advertiser + the two owner types). Internal accounts (admin/superadmin/agents) are
// excluded from the platform-user counts.
const END_USER_ROLES = ['advertiser', 'individual_owner', 'fleet_owner'] as const;
const OWNER_ROLES = new Set<string>(['individual_owner', 'fleet_owner']);

export const adminPlatformStatsRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/platform-stats', adminGuard, async (_request, reply) => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      userRows,
      screensTotalRow,
      screensActiveRow,
      campaignRows,
      campaignBudgetRow,
      creativeRows,
      revenueTotalRow,
      revenueMonthlyRow,
    ] = await Promise.all([
      // users grouped by role × status (end-user roles only).
      db
        .select({ role: users.role, status: users.status, c: count() })
        .from(users)
        .where(inArray(users.role, [...END_USER_ROLES]))
        .groupBy(users.role, users.status),
      db.select({ c: count() }).from(screens),
      db.select({ c: count() }).from(screens).where(eq(screens.isActive, true)),
      db.select({ status: campaigns.status, c: count() }).from(campaigns).groupBy(campaigns.status),
      db
        .select({
          total: sql<string>`coalesce(sum(${campaigns.requestedBudget}), 0)`,
          avg: sql<string>`coalesce(avg(${campaigns.requestedBudget}), 0)`,
        })
        .from(campaigns),
      // ADM-DSH2 — the SAME « submitted » predicate as GET /api/admin/creatives (lib/creatives.ts):
      // the tile « Créatives à valider » links to that queue, so it must count exactly the rows
      // the queue lists. Counting every `pending` row read 4 over an empty queue — those four
      // were uploads never carted (CF-HF4 keeps them out of the queue until PANIER-ADD).
      db
        .select({ status: creatives.validationStatus, c: count() })
        .from(creatives)
        .where(submittedCreativeGate)
        .groupBy(creatives.validationStatus),
      db
        .select({ total: sql<string>`coalesce(sum(${recharges.amountTnd}), 0)` })
        .from(recharges)
        .where(eq(recharges.status, 'confirmed')),
      db
        .select({ total: sql<string>`coalesce(sum(${recharges.amountTnd}), 0)` })
        .from(recharges)
        .where(and(eq(recharges.status, 'confirmed'), gte(recharges.confirmedAt, startOfMonth))),
    ]);

    // users — fold the role × status grid.
    let usersTotal = 0;
    let usersPending = 0;
    let usersApproved = 0;
    let owners = 0;
    let advertisers = 0;
    // SIGN-4 — the OWNER half of `pending`, so the admin queue badge can say what is waiting
    // rather than just how many. Free: the role × status grid is already grouped.
    let pendingOwners = 0;
    for (const row of userRows) {
      usersTotal += row.c;
      if (row.status === 'pending') usersPending += row.c;
      if (row.status === 'approved') usersApproved += row.c;
      if (OWNER_ROLES.has(row.role)) owners += row.c;
      if (row.role === 'advertiser') advertisers += row.c;
      if (row.status === 'pending' && OWNER_ROLES.has(row.role)) pendingOwners += row.c;
    }

    // campaigns — per-status counts + budget aggregates.
    // ADM-FIX1 — the buckets used to stop at four while `total` counted every row, so an 'upcoming'
    // or 'completed' campaign was invisible on the dashboard yet inflated the total. All SIX stored
    // statuses (schema campaign_status) have a bucket now.
    const campaignByStatus = {
      draft: 0,
      pending: 0,
      upcoming: 0,
      active: 0,
      rejected: 0,
      completed: 0,
    };
    let campaignsTotal = 0;
    for (const row of campaignRows) {
      campaignsTotal += row.c;
      if (row.status in campaignByStatus) {
        campaignByStatus[row.status as keyof typeof campaignByStatus] = row.c;
      }
    }

    // creatives — per-status (the videos replacement).
    const creativeByStatus = { pending: 0, approved: 0, rejected: 0 };
    let creativesTotal = 0;
    for (const row of creativeRows) {
      creativesTotal += row.c;
      if (row.status in creativeByStatus) {
        creativeByStatus[row.status as keyof typeof creativeByStatus] = row.c;
      }
    }

    return reply.status(200).send({
      users: {
        total: usersTotal,
        pending: usersPending,
        approved: usersApproved,
        pending_owners: pendingOwners, // SIGN-4
        owners,
        advertisers,
      },
      screens: {
        total: screensTotalRow[0]?.c ?? 0,
        active: screensActiveRow[0]?.c ?? 0,
      },
      campaigns: {
        total: campaignsTotal,
        draft: campaignByStatus.draft,
        pending: campaignByStatus.pending,
        upcoming: campaignByStatus.upcoming,
        active: campaignByStatus.active,
        rejected: campaignByStatus.rejected,
        completed: campaignByStatus.completed,
        total_budget_tnd: Number(campaignBudgetRow[0]?.total ?? 0),
        average_budget_tnd: Number(campaignBudgetRow[0]?.avg ?? 0),
      },
      creatives: {
        total: creativesTotal,
        pending: creativeByStatus.pending,
        approved: creativeByStatus.approved,
      },
      revenue: {
        total_tnd: Number(revenueTotalRow[0]?.total ?? 0),
        monthly_tnd: Number(revenueMonthlyRow[0]?.total ?? 0),
      },
    });
  });
};
