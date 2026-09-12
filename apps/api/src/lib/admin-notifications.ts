import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { type NewNotification, notifications, users } from '../db/schema.js';

import type { DbExecutor } from './dispatch/pool.js';
import { listAdminIds } from './recharge-notifications.js';

// ADM-BELL1 / RECH-N1 (operator 2026-09-12: « improvise until Mejri's notification matrix ») — the
// ONE fan-out for « something waits for an admin ». notifications.user_id is NOT NULL, so an admin
// event is one row per admin/superadmin (the recharge precedent, lib/recharge-notifications.ts).
// Every type below starts with `admin_` so the admin bell can route it; the pre-existing
// `recharge_action_required` keeps its name (pinned in tests, present in prod rows).
//
// The recipient list is read OUTSIDE the caller's transaction (plain db), the rows are inserted on
// the caller's executor — the recharge shape, so an admin created mid-flight never deadlocks.

export type AdminNotificationType =
  | 'admin_account_pending'
  | 'admin_campaign_pending'
  | 'admin_creative_pending'
  | 'admin_facture_deposited'
  | 'admin_allocation_refused';

export interface AdminNotice {
  type: AdminNotificationType;
  title: string;
  body: string;
  campaignId?: string | null;
}

/** The rows for one notice — pure (exported for the pins). Empty when no admin exists. */
export const adminFanout = (notice: AdminNotice, adminIds: readonly string[]): NewNotification[] =>
  adminIds.map((userId) => ({
    userId,
    type: notice.type,
    title: notice.title,
    body: notice.body,
    campaignId: notice.campaignId ?? null,
  }));

/** Insert the notice for every admin on the given executor. Never throws into the caller's path
 * on an EMPTY admin set (nothing to insert); a db error propagates like any other write. */
export const notifyAdmins = async (executor: DbExecutor, notice: AdminNotice): Promise<number> => {
  const rows = adminFanout(notice, await listAdminIds());
  if (rows.length === 0) return 0;
  await executor.insert(notifications).values(rows);
  return rows.length;
};

/** « Société X » or the contact name — how an admin recognises an account in a notice. */
export const accountLabel = async (userId: string): Promise<string> => {
  const [u] = await db
    .select({ businessName: users.businessName, contactName: users.contactName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.businessName || u?.contactName || 'un compte';
};

export const ROLE_LABELS_FR: Record<string, string> = {
  advertiser: 'annonceur',
  individual_owner: 'propriétaire individuel',
  fleet_owner: 'propriétaire de réseau',
  screenhost_agent: 'agent Screenhost',
  screencast_agent: 'agent Screencast',
};
