import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/logger';
import { markFeedRead } from '@/lib/notification-feed';
import { type ApiNotification, notificationsService } from '@/services/notifications.service';

import { advertiserKeys } from './queryKeys';

const log = logger.child({ module: 'useAdvertiserNotifications' });

// CF-S1b — the advertiser bell now reads the SAME live feed as the owner bell
// (GET /api/notifications, session-user-scoped), replacing the dead legacy five-table read whose
// lazy client throws « not configured » in prod, so that feed never rendered. Mirrors
// useOwnerNotifications (query + optimistic mark-read with rollback) with one advertiser
// difference: the CTA is NULLABLE — an unknown type renders plainly with no action button, so new
// producers are visible without an FE change.

export interface AdvertiserNotificationItem {
  id: string;
  kind: string;
  title: string;
  timestamp: Date;
  /** null = no CTA for this type; the bell renders the item plainly. */
  action: { label: string; path: string } | null;
}

interface AdvertiserFeed {
  items: AdvertiserNotificationItem[];
  readIds: string[];
}

/** Polling parity with the owner bell (exported for the parity pin test). */
export const POLL_INTERVAL_MS = 60_000;
const EMPTY_FEED: AdvertiserFeed = { items: [], readIds: [] };

const toDate = (value?: string | null): Date => {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

// Bell CTA by notification type (exported for the routing tests). The J-3 draft reminder sends
// the user to the draft list — MyCampaigns already honors ?status=draft — where Reprendre resumes
// the wizard. FCT1 — every recharge transition (recharge_virement_created / bon_issued /
// bon_returned / credited / funds_received / cancelled) routes to the wallet, prefix-matched so a
// new transition type gets the CTA without an FE change. Unknown types get NO CTA (rendered
// plainly).
export const actionFor = (n: ApiNotification): AdvertiserNotificationItem['action'] => {
  if (n.type === 'campaign_draft_reminder') {
    return { label: 'Consulter', path: '/my-campaigns?status=draft' };
  }
  if (n.type.startsWith('recharge_')) {
    return { label: 'Consulter', path: '/my-recharges' };
  }
  return null;
};

// Exported for the mapping tests: kind is the server `type` string (un-enumerated), read_at
// non-null ⇒ already read — the bell filters unread by `!readIds.has(id)`.
export const toFeed = (rows: ApiNotification[]): AdvertiserFeed => ({
  items: rows.map((n) => ({
    id: n.id,
    kind: n.type,
    title: n.title,
    timestamp: toDate(n.created_at),
    action: actionFor(n),
  })),
  readIds: rows.filter((n) => n.read_at !== null).map((n) => n.id),
});

/**
 * Advertiser notification bell — feed `useQuery` (polls every 60 s) + one mark-read `useMutation`
 * with optimistic rollback (`onMutate` snapshots, `onError` restores, `onSettled` invalidates).
 * The return shape is unchanged apart from items carrying a nullable `action`, so the bell is the
 * only consumer touched.
 */
export function useAdvertiserNotifications(userId: string | undefined) {
  const queryClient = useQueryClient();
  const feedKey = advertiserKeys.notifications(userId ?? '');

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
      const snapshot = queryClient.getQueryData<AdvertiserFeed>(feedKey);
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
      log.error({ error }, 'Erreur marquage notification lue (annonceur)');
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
