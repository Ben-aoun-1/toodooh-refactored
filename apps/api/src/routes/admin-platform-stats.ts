import { and, count, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../db/client.js';
import {
  campaignReconciliation,
  campaigns,
  creatives,
  reversementLines,
  screens,
  users,
} from '../db/schema.js';
import { submittedCreativeGate } from '../lib/creatives.js';
import { REDISPATCH_HEARTBEAT_TOLERANCE_MS } from '../lib/dispatch/redispatch.js';
import { tunisMonthOf } from '../lib/tunis-month.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// Admin platform-stats — the dashboard's headline numbers, DERIVED from the new-engine Postgres
// tables (de-Supabase of the dead platform-stats RPCs/business_profiles reads). Every route is
// [requireAuth, requireAdmin]; a non-admin 403s. Read-only aggregation; no migration.
//
// What is derivable vs FLAGGED-no-source (the FE renders the missing ones as 0/—/empty, never fakes):
//  - users:     scoped to END-USER roles (internal accounts are not platform users, mirroring the
//               moderation-queue semantics). DASH-1 (R5): `total` = every status EXCEPT banned;
//               `owners` / `advertisers` = APPROVED accounts only. `pending` / `pending_owners` are
//               unchanged (SIGN-4's queue badge reads them).
//  - screens:   DASH-1 (R4): total + installed (paired_at OR last_seen_at — ADM-FIX1's ruling) +
//               online (a heartbeat within REDISPATCH_HEARTBEAT_TOLERANCE_MS — the one liveness
//               rule). `is_active` is NOT read: no code writes it, so it always equalled the total.
//  - campaigns: total + per-status + the requested-budget average (« Budget moyen », left as is —
//               FLAGGED: it averages every status, drafts included). "views"/impressions are NOT
//               modelled yet → omitted.
//  - creatives: total/pending/approved (validation_status) — the new media-review counters that
//               replace the legacy `videos` table. ADM-DSH2: counted through the queue's CF-HF4
//               « submitted » gate, so the tile and GET /api/admin/creatives agree row for row.
//  - revenue:   DASH-1 (operator rulings R1–R3, 2026-09-21), all HT:
//                 total_tnd   = Σ campaign_reconciliation.spend_tnd — the advertisers' SETTLED
//                               debit (classic and event settlements both write that table);
//                 toodooh_tnd = R2 AMENDED (day log §5 decision 4): Σ reversement_lines
//                               .toodooh_amount_tnd (every source — the 44 % lines) + for every
//                               settled campaign that HAS lines, spend_tnd − Σ its lines'
//                               base_value_tnd: the sub-S_min undelivered value a RÉUSSIE debits
//                               but never splits (0 for a PARTIAL and for an event). The 3 % agent
//                               lines — with or without an agent — are NOT added;
//                 monthly     = both, over the current TUNIS calendar month: the total by
//                               reconciled_at; Toodooh's lines by settled_at, the remainder by
//                               reconciled_at.
//               Post-E7 the ledger closes: toodooh_tnd + Σ SH + Σ agent lines = total_tnd.
//               The remainder is NEVER clamped, so the identity holds exactly. It can read a
//               sub-millime NEGATIVE: a classic line's base is rounded to the millime while
//               spend_tnd is the 4-decimal Σ of the venue earnings (up to −0.0005 per line).
//               Confirmed recharges are advertiser PREPAYMENTS, not revenue: no figure reads them.
//               Settlements that predate E7 (#121) have no reversement lines, so they count in
//               total_tnd but not in toodooh_tnd (neither split nor remainder).
//  - FLAGGED (no new-engine source, NOT returned): events, occupancy/uptime, per-screen revenue
//    (top screens), revenue growth-rate, daily-revenue projection, average-revenue-per-screen.

// End-user roles (advertiser + the two owner types). Internal accounts (admin/superadmin/agents) are
// excluded from the platform-user counts.
const END_USER_ROLES = ['advertiser', 'individual_owner', 'fleet_owner'] as const;
const OWNER_ROLES = new Set<string>(['individual_owner', 'fleet_owner']);

export interface AdminPlatformStatsOptions {
  /** The clock — injectable so the Tunis month and the heartbeat window are testable. */
  now?: () => Date;
}

export const adminPlatformStatsRoutes: FastifyPluginAsync<AdminPlatformStatsOptions> = async (
  app,
  opts,
) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };
  const clock = opts.now ?? ((): Date => new Date());

  app.get('/api/admin/platform-stats', adminGuard, async (_request, reply) => {
    const now = clock();
    const { month, start: monthStart, end: monthEnd } = tunisMonthOf(now);
    const heartbeatCutoff = new Date(now.getTime() - REDISPATCH_HEARTBEAT_TOLERANCE_MS);
    // [start, end) — bound through the column so the Date serialises as the column does.
    const inMonth = (
      column: typeof campaignReconciliation.reconciledAt | typeof reversementLines.settledAt,
    ) => and(gte(column, monthStart), lt(column, monthEnd));
    // R2 (amended) — per settled campaign: its Toodooh lines (all time + those settled in the
    // month) and Σ of its line bases, the value that WAS split. Pre-E7 settlements have no row here.
    const linesByCampaign = db
      .select({
        campaignId: reversementLines.campaignId,
        toodoohTnd: sql<string>`sum(${reversementLines.toodoohAmountTnd})`.as('toodooh_tnd'),
        toodoohInMonthTnd:
          sql<string>`coalesce(sum(${reversementLines.toodoohAmountTnd}) filter (where ${inMonth(reversementLines.settledAt)}), 0)`.as(
            'toodooh_in_month_tnd',
          ),
        baseTnd: sql<string>`sum(${reversementLines.baseValueTnd})`.as('base_tnd'),
      })
      .from(reversementLines)
      .groupBy(reversementLines.campaignId)
      .as('lines_by_campaign');

    const [
      userRows,
      screenRow,
      campaignRows,
      campaignBudgetRow,
      creativeRows,
      spendRow,
      toodoohRow,
    ] = await Promise.all([
      // users grouped by role × status (end-user roles only).
      db
        .select({ role: users.role, status: users.status, c: count() })
        .from(users)
        .where(inArray(users.role, [...END_USER_ROLES]))
        .groupBy(users.role, users.status),
      // R4 — one pass: installed = either proof a real device once ran (paired OR seen);
      // online = seen within the heartbeat tolerance (the admin-screenhosts predicate, verbatim).
      db
        .select({
          total: count(),
          installed:
            sql<number>`count(*) filter (where ${screens.pairedAt} is not null or ${screens.lastSeenAt} is not null)`.mapWith(
              Number,
            ),
          online:
            sql<number>`count(*) filter (where ${gte(screens.lastSeenAt, heartbeatCutoff)})`.mapWith(
              Number,
            ),
        })
        .from(screens),
      db.select({ status: campaigns.status, c: count() }).from(campaigns).groupBy(campaigns.status),
      db
        .select({ avg: sql<string>`coalesce(avg(${campaigns.requestedBudget}), 0)` })
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
      // R1 / R3 — settled spend, all time and over the Tunis month (by reconciled_at).
      db
        .select({
          total: sql<string>`coalesce(sum(${campaignReconciliation.spendTnd}), 0)`,
          monthly: sql<string>`coalesce(sum(${campaignReconciliation.spendTnd}) filter (where ${inMonth(campaignReconciliation.reconciledAt)}), 0)`,
        })
        .from(campaignReconciliation),
      // R2 (amended) / R3 — Revenu Toodooh, all time and over the Tunis month, in ONE exact numeric
      // sum: each settled campaign's 44 % lines (by settled_at) + its unsplit remainder
      // spend − Σ base (by reconciled_at). The LEFT JOIN keeps every line's share even if a line
      // ever lacked its settlement row (no remainder then). Not clamped: see the header.
      db
        .select({
          total: sql<string>`coalesce(sum(${linesByCampaign.toodoohTnd}), 0) + coalesce(sum(${campaignReconciliation.spendTnd} - ${linesByCampaign.baseTnd}), 0)`,
          monthly: sql<string>`coalesce(sum(${linesByCampaign.toodoohInMonthTnd}), 0) + coalesce(sum(${campaignReconciliation.spendTnd} - ${linesByCampaign.baseTnd}) filter (where ${inMonth(campaignReconciliation.reconciledAt)}), 0)`,
        })
        .from(linesByCampaign)
        .leftJoin(
          campaignReconciliation,
          eq(campaignReconciliation.campaignId, linesByCampaign.campaignId),
        ),
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
      // R5 — a banned account is terminal evidence, not a platform user; rejected ones still count.
      if (row.status !== 'banned') usersTotal += row.c;
      if (row.status === 'pending') usersPending += row.c;
      if (row.status === 'approved') usersApproved += row.c;
      // R5 — the network is its APPROVED owners and advertisers.
      if (row.status === 'approved' && OWNER_ROLES.has(row.role)) owners += row.c;
      if (row.status === 'approved' && row.role === 'advertiser') advertisers += row.c;
      if (row.status === 'pending' && OWNER_ROLES.has(row.role)) pendingOwners += row.c;
    }

    // campaigns — per-status counts + the budget average.
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
        total: screenRow[0]?.total ?? 0,
        installed: screenRow[0]?.installed ?? 0,
        online: screenRow[0]?.online ?? 0,
      },
      campaigns: {
        total: campaignsTotal,
        draft: campaignByStatus.draft,
        pending: campaignByStatus.pending,
        upcoming: campaignByStatus.upcoming,
        active: campaignByStatus.active,
        rejected: campaignByStatus.rejected,
        completed: campaignByStatus.completed,
        average_budget_tnd: Number(campaignBudgetRow[0]?.avg ?? 0),
      },
      creatives: {
        total: creativesTotal,
        pending: creativeByStatus.pending,
        approved: creativeByStatus.approved,
      },
      revenue: {
        total_tnd: Number(spendRow[0]?.total ?? 0),
        toodooh_tnd: Number(toodoohRow[0]?.total ?? 0),
        monthly: {
          month,
          total_tnd: Number(spendRow[0]?.monthly ?? 0),
          toodooh_tnd: Number(toodoohRow[0]?.monthly ?? 0),
        },
      },
    });
  });
};
