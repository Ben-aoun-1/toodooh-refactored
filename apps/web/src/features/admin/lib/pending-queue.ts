/**
 * SIGN-4 (Mejri, 01/09) — an admin had no way to learn a new Host was awaiting validation without
 * opening the users page and looking.
 *
 * This is a QUEUE BADGE, deliberately, not a notification system. Before building one I checked
 * what exists: the `notifications` table is per-USER (`user_id` NOT NULL → users.id), so an admin
 * notification means fanning a row out to every admin at signup — and WHICH admins, and what
 * happens on read, is the open question the FCT-N1 charter parked pending a reconciliation that
 * has not happened. The admin header's bell is a decorative placeholder with no handler and no
 * data behind it. A badge on the nav entry the admin already uses answers the ticket — « an admin
 * learns a new owner is awaiting validation without polling the page » — with one number the
 * platform-stats read already computes, no new endpoint, no new table, and nothing to mark read.
 *
 * The count shown is EVERY pending end-user account, because that is what is actually waiting for
 * the admin; the tooltip names the Host share so « 3 » never hides which kind arrived.
 */
export interface PendingQueue {
  /** Every end-user account awaiting validation — advertisers and Hosts alike. */
  total: number;
  /** The Host share of it. */
  owners: number;
}

/** The badge is hidden at zero: an empty queue is not news. */
export const showPendingBadge = (queue: PendingQueue): boolean => queue.total > 0;

/** Badges cap their digits so the nav never reflows on a backlog. */
export const pendingBadgeLabel = (queue: PendingQueue): string =>
  queue.total > 99 ? '99+' : String(queue.total);

/** The hover/aria text — says what the number is, and how many are Hosts. */
export function pendingBadgeTitle(queue: PendingQueue): string {
  const comptes = `${queue.total} compte${queue.total > 1 ? 's' : ''} en attente de validation`;
  if (queue.owners === 0) return comptes;
  const hosts = `${queue.owners} établissement${queue.owners > 1 ? 's' : ''}`;
  return `${comptes}, dont ${hosts}`;
}
