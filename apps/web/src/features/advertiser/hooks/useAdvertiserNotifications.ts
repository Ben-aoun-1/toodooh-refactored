import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/logger';
import {
  markFeedRead,
  type NotificationFeed,
  type NotificationFeedItem,
} from '@/lib/notification-feed';
import { supabase } from '@/lib/supabase';

import { advertiserKeys } from './queryKeys';

const log = logger.child({ module: 'useAdvertiserNotifications' });

export type AdvertiserNotificationKind = 'account_approved' | 'video_approved';
export type AdvertiserNotificationItem = NotificationFeedItem<AdvertiserNotificationKind>;

const NOTIFICATION_SCOPE = 'advertiser' as const;
const POLL_INTERVAL_MS = 60_000;
const EMPTY_FEED: NotificationFeed<AdvertiserNotificationKind> = { items: [], readIds: [] };

const toDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Builds the advertiser notification feed from its five source tables. A plain
 * async function (not a component) — so it produces serializable
 * `actionPath` strings; the bell turns those into navigation at click time.
 */
async function fetchAdvertiserNotifications(
  userId: string,
): Promise<NotificationFeed<AdvertiserNotificationKind>> {
  const [profileRes, campaignsRes, readsRes, notificationsRes] = await Promise.all([
    supabase
      .from('business_profiles')
      .select('verification_status, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('campaigns')
      .select('id, name, status, video_id, content_validation_status, updated_at')
      .eq('user_id', userId),
    supabase
      .from('user_notification_reads')
      .select('notification_id')
      .eq('scope', NOTIFICATION_SCOPE),
    supabase
      .from('user_notifications')
      .select(
        'id, recipient_user_id, scope, external_key, kind, title, action_path, action_label, created_at, is_active',
      )
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const profile = profileRes.data;
  const campaigns = campaignsRes.data;
  const reads = readsRes.data;
  const persistedNotifications = (notificationsRes.data || []).filter((n) => {
    const scopeOk = !n?.scope || n.scope === NOTIFICATION_SCOPE;
    const activeOk = n?.is_active !== false;
    return scopeOk && activeOk;
  });

  if (campaignsRes.error) {
    log.error(
      { error: campaignsRes.error },
      'Erreur chargement campagnes pour notifications annonceur',
    );
  }
  if (notificationsRes.error) {
    log.error({ error: notificationsRes.error }, 'Erreur chargement user_notifications annonceur');
  }
  if (readsRes.error) {
    log.error({ error: readsRes.error }, 'Erreur chargement user_notification_reads annonceur');
  }

  const campaignRows = campaignsRes.error ? [] : campaigns || [];
  const videoIds = Array.from(
    new Set(
      campaignRows
        .map((campaign) => campaign.video_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );

  const approvedVideoMap = new Map<string, Date>();
  if (videoIds.length > 0) {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, validation_status, updated_at')
      .in('id', videoIds);
    (videos || []).forEach((video) => {
      if (video?.validation_status === 'approved') {
        approvedVideoMap.set(video.id, toDate(video.updated_at) || new Date());
      }
    });
  }

  const generated: AdvertiserNotificationItem[] = [];

  // Source prioritaire : notifications persistées.
  persistedNotifications.forEach((n) => {
    const notificationId =
      typeof n?.id === 'string' && n.id.length > 0
        ? n.id
        : `notif-${n?.external_key || Date.now()}`;
    generated.push({
      id: notificationId,
      kind: n?.kind === 'account_approved' ? 'account_approved' : 'video_approved',
      title: n?.title || 'Notification',
      timestamp: toDate(n?.created_at) || new Date(),
      actionLabel: n?.action_label || 'Voir',
      actionPath: n?.action_path || '/my-campaigns',
    });
  });

  if (profile?.verification_status === 'approved') {
    generated.push({
      id: 'fallback-account-approved',
      kind: 'account_approved',
      title: 'Votre compte a ete approuve par l administrateur.',
      timestamp: toDate(profile.updated_at) || new Date(),
      actionLabel: 'Ouvrir les parametres',
      actionPath: '/profile',
    });
  }

  campaignRows.forEach((campaign) => {
    const isActiveCampaign = campaign?.status === 'active';
    const byCampaignStatus = campaign?.content_validation_status === 'approved';
    const byVideoStatus =
      typeof campaign?.video_id === 'string' && approvedVideoMap.has(campaign.video_id);
    const isActivationNotificationCandidate =
      isActiveCampaign && (byCampaignStatus || byVideoStatus || Boolean(campaign?.video_id));
    if (!isActivationNotificationCandidate) return;

    const when =
      (typeof campaign?.video_id === 'string' ? approvedVideoMap.get(campaign.video_id) : null) ||
      toDate(campaign?.updated_at) ||
      new Date();

    generated.push({
      id: `fallback-video-approved-active-${campaign.id}-${when.getTime()}`,
      kind: 'video_approved',
      title: `Video validee et campagne active : ${campaign?.name || 'Campagne'}`,
      timestamp: when,
      actionLabel: 'Voir mes campagnes',
      actionPath: '/my-campaigns',
    });
  });

  const items = Array.from(new Map(generated.map((item) => [item.id, item])).values())
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 12);

  return {
    items,
    readIds: (reads || []).map((r: { notification_id: string }) => r.notification_id),
  };
}

/**
 * Advertiser notification bell — feed `useQuery` (polls every 60 s,
 * F-2's `setInterval` → `refetchInterval`) + one mark-read `useMutation`.
 *
 * The D5 deliverable: the mutation is **optimistic with rollback** —
 * `onMutate` snapshots the feed and applies `markFeedRead`, `onError`
 * restores the exact snapshot, `onSettled` invalidates. This fixes the
 * confirmed staleness bug (the former bell did `setReadIds` then `upsert`
 * with no rollback — a failed write left the bell falsely cleared).
 *
 * CF-14: the mark-read write is user-scoped and single-session — its only
 * affected view is this bell's own feed (one `(a)` key, invalidated by
 * `onSettled`). No `(b)` cross-session reach.
 */
export function useAdvertiserNotifications(userId: string | undefined) {
  const queryClient = useQueryClient();
  const feedKey = advertiserKeys.notifications(userId ?? '');

  const query = useQuery({
    queryKey: feedKey,
    queryFn: () => fetchAdvertiserNotifications(userId as string),
    enabled: Boolean(userId),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]): Promise<void> => {
      if (!userId || ids.length === 0) return;
      const now = new Date().toISOString();
      const { error } = await supabase.from('user_notification_reads').upsert(
        ids.map((id) => ({
          user_id: userId,
          scope: NOTIFICATION_SCOPE,
          notification_id: id,
          read_at: now,
          updated_at: now,
        })),
        { onConflict: 'user_id,scope,notification_id' },
      );
      if (error) throw error;
    },
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey: feedKey });
      const snapshot =
        queryClient.getQueryData<NotificationFeed<AdvertiserNotificationKind>>(feedKey);
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
      const ids = feed.items.map((item) => item.id);
      if (ids.length > 0) markReadMutation.mutate(ids);
    },
  };
}
