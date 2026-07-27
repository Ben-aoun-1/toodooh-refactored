import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/logger';
import {
  markFeedRead,
  type NotificationFeed,
  type NotificationFeedItem,
} from '@/lib/notification-feed';
import { type ApiNotification, notificationsService } from '@/services/notifications.service';

import { screenhostKeys } from './queryKeys';

const log = logger.child({ module: 'useOwnerNotifications' });

// `kind` is now the server `type` string (un-enumerated so new producers need no FE change). The
// bell only uses it to pick an icon; any unknown kind renders the default campaign icon.
export type OwnerNotificationItem = NotificationFeedItem<string>;

const POLL_INTERVAL_MS = 60_000;
const EMPTY_FEED: NotificationFeed<string> = { items: [], readIds: [] };

const toDate = (value?: string | null): Date => {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

// Where the bell's CTA navigates, by notification type (exported for the routing tests). A
// pending-acceptance notification opens the owner's accept/reject surface; a monthly-report
// notification opens "Mes performances" (Mejri prod-test #1 — never the campaigns route);
// everything else falls back to the owner campaigns page.
export const actionFor = (n: ApiNotification): { actionLabel: string; actionPath: string } => {
  if (n.type === 'dispatch_pending_acceptance')
    return { actionLabel: 'Consulter', actionPath: '/owner-allocations' };
  if (n.type === 'monthly_report_ready')
    return { actionLabel: 'Consulter', actionPath: '/owner-performance' };
  // FCT2 — the monthly « Relevé de reversement » lands on the statements page.
  if (n.type === 'reversement_statement_ready')
    return { actionLabel: 'Consulter', actionPath: '/owner-statements' };
  return { actionLabel: 'Consulter', actionPath: '/owner-campaigns' };
};

const toFeed = (rows: ApiNotification[]): NotificationFeed<string> => ({
  items: rows.map((n) => ({
    id: n.id,
    kind: n.type,
    title: n.title,
    timestamp: toDate(n.created_at),
    ...actionFor(n),
  })),
  // read_at non-null ⇒ already read; the bell filters unread by `!readIds.has(id)`.
  readIds: rows.filter((n) => n.read_at !== null).map((n) => n.id),
});

/**
 * Owner notification bell — feed `useQuery` (polls every 60 s) + one mark-read `useMutation` with
 * optimistic rollback. De-Supabased (Lane 2): the feed now comes from `GET /api/notifications`
 * (toodooh API), not the former ~8 Supabase source tables; mark-read calls `POST
 * /api/notifications/:id/read`. The producer-written "Campagne en attente de votre acceptation"
 * rows surface here. The return shape is unchanged, so `OwnerNotificationsBell` is untouched.
 */
export function useOwnerNotifications(userId: string | undefined) {
  const queryClient = useQueryClient();
  const feedKey = screenhostKeys.notifications(userId ?? '');

  const query = useQuery({
    queryKey: feedKey,
    queryFn: async () => toFeed(await notificationsService.list()),
    enabled: Boolean(userId),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]): Promise<void> => {
      if (ids.length === 0) return;
      // One POST per id (the API marks a single notification read). Sequential keeps it simple; the
      // optimistic cache update already cleared them, so latency is invisible.
      for (const id of ids) await notificationsService.markRead(id);
    },
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const snapshot = queryClient.getQueryData<NotificationFeed<string>>(feedKey);
      if (snapshot) {
        queryClient.setQueryData(feedKey, markFeedRead(snapshot, ids));
      }
      return { snapshot };
    },
    onError: (error, _ids, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(feedKey, context.snapshot);
      }
      log.error({ error }, 'Erreur marquage notification lue (proprio)');
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
