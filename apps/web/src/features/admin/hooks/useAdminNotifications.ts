import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/logger';
import { markFeedRead } from '@/lib/notification-feed';
import { type ApiNotification, notificationsService } from '@/services/notifications.service';

import { adminKeys } from './queryKeys';

const log = logger.child({ module: 'useAdminNotifications' });

// ADM-BELL1 (operator 2026-09-12: « improvise until Mejri's matrix ») — the admin bell reads the
// SAME session-scoped feed (GET /api/notifications) as the two other bells; the api already
// fans out `recharge_action_required` (invisible until now) and the admin_* types (this lane).
// Clone of the advertiser hook: the CTA is NULLABLE, so a type this map does not know renders
// plainly and a new producer needs no FE change.

export interface AdminNotificationItem {
  id: string;
  kind: string;
  title: string;
  timestamp: Date;
  /** null = no CTA for this type; the bell renders the item plainly. */
  action: { label: string; path: string } | null;
}

interface AdminFeed {
  items: AdminNotificationItem[];
  readIds: string[];
}

/** Polling parity with the owner bell (exported for the parity pin test). */
export const POLL_INTERVAL_MS = 60_000;
const EMPTY_FEED: AdminFeed = { items: [], readIds: [] };

const toDate = (value?: string | null): Date => {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

// Bell CTA by type (exported for the routing pins). Admin routes are flat paths that read no query
// params, so the CTA opens the queue page and the admin finds the row there.
export const actionFor = (n: ApiNotification): AdminNotificationItem['action'] => {
  if (n.type === 'recharge_action_required') return { label: 'Traiter', path: '/admin-recharges' };
  if (n.type === 'admin_account_pending') return { label: 'Traiter', path: '/admin-users' };
  if (n.type === 'admin_campaign_pending') return { label: 'Traiter', path: '/admin-campaigns' };
  if (n.type === 'admin_creative_pending') return { label: 'Traiter', path: '/admin-creatives' };
  if (n.type === 'admin_facture_deposited') {
    return { label: 'Traiter', path: '/admin-screenhost-factures' };
  }
  if (n.type === 'admin_allocation_refused') {
    return { label: 'Consulter', path: '/admin-campaigns' };
  }
  if (n.type === 'admin_support_message') return { label: 'Traiter', path: '/admin-support' };
  return null;
};

// Exported for the mapping tests: kind is the server `type` string (un-enumerated), read_at
// non-null ⇒ already read — the bell filters unread by `!readIds.has(id)`.
export const toFeed = (rows: ApiNotification[]): AdminFeed => ({
  items: rows.map((n) => ({
    id: n.id,
    kind: n.type,
    title: n.title,
    timestamp: toDate(n.created_at),
    action: actionFor(n),
  })),
  readIds: rows.filter((n) => n.read_at !== null).map((n) => n.id),
});

/** Admin notification bell — feed `useQuery` (polls every 60 s) + one optimistic mark-read. */
export function useAdminNotifications(userId: string | undefined) {
  const queryClient = useQueryClient();
  const feedKey = adminKeys.notifications(userId ?? '');

  const query = useQuery({
    queryKey: feedKey,
    queryFn: async () => toFeed(await notificationsService.list()),
    enabled: Boolean(userId),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]): Promise<void> => {
      if (ids.length === 0) return;
      // One POST per id (the API marks a single notification read). Sequential keeps it simple;
      // the optimistic cache update already cleared them, so latency is invisible.
      for (const id of ids) await notificationsService.markRead(id);
    },
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const snapshot = queryClient.getQueryData<AdminFeed>(feedKey);
      if (snapshot) {
        queryClient.setQueryData(feedKey, markFeedRead(snapshot, ids));
      }
      return { snapshot };
    },
    onError: (error, _ids, context) => {
      // Rollback — restore the exact pre-mutation feed snapshot.
      if (context?.snapshot) {
        queryClient.setQueryData(feedKey, context.snapshot);
      }
      log.error({ error }, 'Erreur marquage notification lue (admin)');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: feedKey });
    },
  });

  const feed = query.data ?? EMPTY_FEED;

  return {
    items: feed.items,
    readIds: feed.readIds,
    loading: query.isFetching,
    refetch: () => {
      void query.refetch();
    },
    markRead: (id: string) => markReadMutation.mutate([id]),
    markAllRead: () => {
      const unread = feed.items.filter((item) => !feed.readIds.includes(item.id)).map((i) => i.id);
      if (unread.length > 0) markReadMutation.mutate(unread);
    },
  };
}
