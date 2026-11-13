import { and, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, events, hourReservations, users } from '../db/schema.js';

import { deactivateAccount } from './account-deactivation.js';
import { deleteAccountCompletely } from './account-deletion/execute.js';
import { hasAired, purgeCampaignWithoutHistory } from './campaign-delete.js';
import { stopCampaign } from './campaign-stop.js';
import { releaseReservation } from './dispatch/tours/reservation.js';
import { releaseIdleBlocHours } from './event-dispatch/dispatch.js';
import { releaseLegacySeats } from './event-pricing/legacy-seats.js';
import { pushPlaylistToAllConnected } from './playout/push.js';

// Mariem 05/11 — « Nettoyage des comptes Screencasters (test et production) »: the screencaster
// accounts and their campaigns, drafts, carts and positionings go, so that the tests start clean
// and the matches return to the 2-minute rule. Operator ruling 3A keeps the Hosts' money history:
//   - an account NOTHING of which ever aired is deleted completely (DEL-1, lib/account-deletion:
//     its financial rows archived first);
//   - an account with campaigns that aired keeps those (the Hosts' earnings, reversements and
//     invoices hang off them) and is deactivated (DEACT-1: signed out, can no longer sign in); its
//     live campaigns and positionings are stopped (what did not air refunded), its pending ones
//     rejected, its drafts, carts and never-aired campaigns deleted.
// Then every match still to come drops the holds nothing airs on and, when nothing binds it any
// more, takes the 2-minute rule again. Demo accounts (DEMO-1) only when asked: sales use them.
// Accounts matching a protected marker (scripts/reconcile-run SETTLE1 charter) are never touched.

export const CLEANUP_REASON = 'Nettoyage des comptes de test (Mariem 05/11)';

export interface CastPlan {
  userId: string;
  label: string;
  demo: boolean;
  status: string;
  /** 'delete' = nothing ever aired (DEL-1); 'keep' = aired history kept, account deactivated. */
  kind: 'delete' | 'keep';
  live: string[];
  pending: string[];
  /** Drafts (carts included) and ended campaigns that never aired. */
  purge: string[];
  /** Campaigns that aired — kept. */
  kept: number;
}

const LIVE = ['active', 'upcoming'];
const ENDED = ['draft', 'completed', 'rejected'];

const labelOf = (u: { businessName: string | null; email: string }): string =>
  u.businessName?.trim() || (u.email.split('@')[0] ?? u.email);

const matchesMarker = (
  u: { businessName: string | null; contactName: string | null; email: string },
  markers: readonly string[],
): boolean => {
  const text = `${u.businessName ?? ''} ${u.contactName ?? ''} ${u.email}`.toLowerCase();
  return markers.some((m) => text.includes(m));
};

/** What the cleanup would do, account by account — reads only. */
export const planCleanup = async (opts: {
  includeDemo: boolean;
  protectedMarkers: readonly string[];
}): Promise<CastPlan[]> => {
  const casts = await db
    .select({
      id: users.id,
      email: users.email,
      businessName: users.businessName,
      contactName: users.contactName,
      isDemo: users.isDemo,
      status: users.status,
    })
    .from(users)
    .where(eq(users.role, 'advertiser'))
    .orderBy(users.createdAt);
  const plans: CastPlan[] = [];
  for (const u of casts) {
    if (u.isDemo && !opts.includeDemo) continue;
    if (matchesMarker(u, opts.protectedMarkers)) {
      throw new Error(`refused: ${labelOf(u)} matches a protected account marker`);
    }
    const rows = await db
      .select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.advertiserId, u.id));
    const aired = new Set<string>();
    for (const r of rows) if (await hasAired(db, r.id)) aired.add(r.id);
    plans.push({
      userId: u.id,
      label: labelOf(u),
      demo: u.isDemo,
      status: u.status,
      kind: aired.size > 0 ? 'keep' : 'delete',
      live: rows.filter((r) => LIVE.includes(r.status)).map((r) => r.id),
      pending: rows.filter((r) => r.status === 'pending').map((r) => r.id),
      purge: rows.filter((r) => ENDED.includes(r.status) && !aired.has(r.id)).map((r) => r.id),
      kept: aired.size,
    });
  }
  return plans;
};

export interface CleanupReport {
  deleted: string[];
  deactivated: string[];
  stopped: number;
  rejected: number;
  purged: number;
  /** Matches still to come back on the 2-minute rule (by a stop or by the final sweep). */
  matchesReleased: number;
}

/** Matches still to come that sold the 1-minute seats. */
const legacyMatchCount = async (now: Date): Promise<number> =>
  (
    await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.seatMinutes, 1), gt(events.endsAt, now)))
  ).length;

/** Apply the plan. Every step is the product's own (DEL-1, DEACT-1, STOP-1, the delete). */
export const executeCleanup = async (
  plans: readonly CastPlan[],
  opts: { adminId: string; now?: Date; log?: FastifyBaseLogger },
): Promise<CleanupReport> => {
  const now = opts.now ?? new Date();
  const log = opts.log ? { log: opts.log } : {};
  const legacyBefore = await legacyMatchCount(now);
  const report: CleanupReport = {
    deleted: [],
    deactivated: [],
    stopped: 0,
    rejected: 0,
    purged: 0,
    matchesReleased: 0,
  };
  for (const p of plans) {
    if (p.kind === 'delete') {
      await deleteAccountCompletely({
        userId: p.userId,
        adminId: opts.adminId,
        reason: CLEANUP_REASON,
        ...log,
      });
      report.deleted.push(p.label);
      continue;
    }
    for (const id of p.live) {
      const out = await stopCampaign({
        campaignId: id,
        adminId: opts.adminId,
        reason: CLEANUP_REASON,
        now,
        ...log,
      });
      if (out.ok) report.stopped += 1;
    }
    for (const id of p.pending) {
      await db.transaction(async (tx) => {
        const flipped = await tx
          .update(campaigns)
          .set({ status: 'rejected', rejectedAt: now, rejectReason: CLEANUP_REASON })
          .where(and(eq(campaigns.id, id), eq(campaigns.status, 'pending')))
          .returning({ id: campaigns.id });
        if (flipped.length > 0) {
          await releaseReservation(tx, id);
          report.rejected += 1;
        }
      });
    }
    for (const id of [...p.purge, ...p.live, ...p.pending]) {
      if (await purgeCampaignWithoutHistory(id)) report.purged += 1;
    }
    if (p.status === 'approved') {
      await deactivateAccount({
        userId: p.userId,
        adminId: opts.adminId,
        reason: CLEANUP_REASON,
        castCampaigns: 'stop',
        now,
        ...log,
      });
      report.deactivated.push(p.label);
    }
  }

  // The matches still to come: holds nothing airs on any more, then the seat rule.
  const upcoming = await db.select({ id: events.id }).from(events).where(gt(events.endsAt, now));
  const ids = upcoming.map((e) => e.id);
  if (ids.length > 0) {
    const holds = await db
      .selectDistinct({
        eventId: hourReservations.eventId,
        screenhostId: hourReservations.screenhostId,
      })
      .from(hourReservations)
      .where(inArray(hourReservations.eventId, ids));
    for (const id of ids) {
      const venues = holds.filter((h) => h.eventId === id).map((h) => h.screenhostId);
      if (venues.length > 0) await releaseIdleBlocHours(db, id, venues);
      await releaseLegacySeats(db, id, now);
    }
  }
  report.matchesReleased = legacyBefore - (await legacyMatchCount(now));
  await pushPlaylistToAllConnected(opts.log);
  return report;
};
