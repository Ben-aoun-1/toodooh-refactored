import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { campaignOwnerApprovalService } from '@/features/campaigns/services/campaign-owner-approval.service';
import { logger } from '@/lib/logger';
import {
  markFeedRead,
  type NotificationFeed,
  type NotificationFeedItem,
} from '@/lib/notification-feed';
import { supabase } from '@/lib/supabase';

import { screenhostKeys } from './queryKeys';

const log = logger.child({ module: 'useOwnerNotifications' });

export type OwnerNotificationKind =
  | 'campaign_validated_reminder'
  | 'event_validated_reminder'
  | 'campaign_validation_received'
  | 'campaign_started'
  | 'campaign_ended'
  | 'bank_coordinates_validated';
export type OwnerNotificationItem = NotificationFeedItem<OwnerNotificationKind>;

const NOTIFICATION_SCOPE = 'owner' as const;
const POLL_INTERVAL_MS = 60_000;
const EMPTY_FEED: NotificationFeed<OwnerNotificationKind> = { items: [], readIds: [] };

const toDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isWithinHours = (target: Date, fromNow: number, toNow: number): boolean => {
  const diffHours = (target.getTime() - Date.now()) / (1000 * 60 * 60);
  return diffHours >= fromNow && diffHours <= toNow;
};

interface NotificationPrefs {
  notify_news_updates: boolean;
  notify_reminders_events: boolean;
  notify_promotions_offers: boolean;
  verification_status: string | null;
}

/**
 * Builds the owner notification feed from its ~8 source tables. A plain async
 * function — produces serializable `actionPath` strings, not `useNavigate`
 * closures.
 */
async function fetchOwnerNotifications(
  userId: string,
): Promise<NotificationFeed<OwnerNotificationKind>> {
  const [{ data: profile }, { data: reads }] = await Promise.all([
    supabase
      .from('business_profiles')
      .select(
        'notify_news_updates, notify_reminders_events, notify_promotions_offers, verification_status',
      )
      .eq('user_id', userId)
      .single(),
    supabase
      .from('user_notification_reads')
      .select('notification_id')
      .eq('user_id', userId)
      .eq('scope', NOTIFICATION_SCOPE),
  ]);

  const prefs: NotificationPrefs = {
    notify_news_updates: profile?.notify_news_updates ?? false,
    notify_reminders_events: profile?.notify_reminders_events ?? true,
    notify_promotions_offers: profile?.notify_promotions_offers ?? false,
    verification_status: profile?.verification_status ?? null,
  };

  const [ownerLocations, ownerScreens, ownerApprovals, pendingCampaigns] = await Promise.all([
    supabase.from('locations').select('id').eq('owner_id', userId),
    supabase.from('screens').select('id, name').eq('owner_id', userId),
    supabase
      .from('campaign_owner_approvals')
      .select('campaign_id, status, created_at, updated_at')
      .eq('owner_id', userId),
    campaignOwnerApprovalService.getPendingCampaigns(userId),
  ]);

  const locationIds = (ownerLocations.data || []).map((r: { id: string }) => r.id);
  const screenIds = (ownerScreens.data || []).map((r: { id: string }) => r.id);

  const [campaignLocations, campaignScreens] = await Promise.all([
    locationIds.length
      ? supabase.from('campaign_locations').select('campaign_id').in('location_id', locationIds)
      : Promise.resolve({ data: [] as Array<{ campaign_id: string }> }),
    screenIds.length
      ? supabase.from('campaign_screens').select('campaign_id').in('screen_id', screenIds)
      : Promise.resolve({ data: [] as Array<{ campaign_id: string }> }),
  ]);

  const campaignIds = Array.from(
    new Set(
      [
        ...((ownerApprovals.data || []) as Array<{ campaign_id: string }>).map(
          (r) => r.campaign_id,
        ),
        ...((campaignLocations.data || []) as Array<{ campaign_id: string }>).map(
          (r) => r.campaign_id,
        ),
        ...((campaignScreens.data || []) as Array<{ campaign_id: string }>).map(
          (r) => r.campaign_id,
        ),
      ].filter(Boolean),
    ),
  );

  const campaignsRes =
    campaignIds.length > 0
      ? await supabase
          .from('campaigns')
          .select('id, name, start_date, end_date, status, event_id, created_at, updated_at')
          .in('id', campaignIds)
      : { data: [] as Array<Record<string, unknown>> };

  const campaigns = campaignsRes.data || [];
  const campaignById = new Map<string, Record<string, unknown>>(
    campaigns.map((c) => [c.id as string, c]),
  );
  const approvals = (ownerApprovals.data || []) as Array<{
    campaign_id: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  const generated: OwnerNotificationItem[] = [];

  // 1) Réception campagne pour validation.
  (pendingCampaigns || [])
    .filter((c) => (c.approval_status || 'pending') === 'pending')
    .forEach((pending) => {
      const c = campaignById.get(pending.campaign_id) || pending;
      const ref = approvals.find((a) => a.campaign_id === pending.campaign_id);
      generated.push({
        id: `pending-${pending.campaign_id}`,
        kind: 'campaign_validation_received',
        title: `Réception campagne pour validation : ${(c as { name?: string }).name || 'Campagne'}`,
        timestamp:
          toDate(ref?.updated_at) ||
          toDate(ref?.created_at) ||
          toDate((c as { campaign_start_date?: string }).campaign_start_date) ||
          new Date(),
        actionLabel: 'Consulter la campagne',
        actionPath: '/owner-campaigns',
      });
    });

  // 2/3/4/5) Rappels + début/fin.
  campaigns.forEach((c) => {
    const start = toDate(c.start_date as string);
    const end = toDate(c.end_date as string);
    if (!start || !end) return;
    const name = (c.name as string) || 'Campagne';
    const id = c.id as string;

    if (!c.event_id && isWithinHours(start, 0, 30)) {
      generated.push({
        id: `reminder-campaign-${id}`,
        kind: 'campaign_validated_reminder',
        title: `Rappel campagne validée (à venir) (J-1) : ${name}`,
        timestamp: start,
        actionLabel: 'Consulter la campagne',
        actionPath: '/owner-campaigns',
      });
    }

    if (c.event_id && isWithinHours(start, 0, 4)) {
      generated.push({
        id: `reminder-event-${id}`,
        kind: 'event_validated_reminder',
        title: `Rappel événement validé (à venir) (H-4) : ${name}`,
        timestamp: start,
        actionLabel: 'Consulter la campagne',
        actionPath: '/owner-campaigns',
      });
    }

    const now = Date.now();
    if (now >= start.getTime() && now - start.getTime() <= 24 * 60 * 60 * 1000) {
      generated.push({
        id: `start-${id}`,
        kind: 'campaign_started',
        title: `Début campagne : ${name}`,
        timestamp: start,
        actionLabel: 'Consulter la campagne',
        actionPath: `/owner-campaigns?openCampaignId=${id}`,
      });
    }

    if (now >= end.getTime() && now - end.getTime() <= 24 * 60 * 60 * 1000) {
      generated.push({
        id: `end-${id}`,
        kind: 'campaign_ended',
        title: `Fin campagne : ${name}`,
        timestamp: end,
        actionLabel: 'Consulter la campagne',
        actionPath: `/owner-campaigns?openCampaignId=${id}`,
      });
    }
  });

  // 6) Validation coordonnées bancaires (proxy via profil vérifié).
  if (prefs.verification_status === 'verified') {
    generated.push({
      id: 'bank-coordinates-validated',
      kind: 'bank_coordinates_validated',
      title: 'Validation coordonnées bancaires',
      timestamp: new Date(),
      actionLabel: 'Ouvrir les paramètres',
      actionPath: '/owner-settings?tab=entreprise&sub=informations',
    });
  }

  const items = generated
    .filter((item) => {
      if (item.kind === 'campaign_validation_received') return prefs.notify_reminders_events;
      if (item.kind === 'bank_coordinates_validated') return prefs.notify_news_updates;
      if (
        item.kind === 'campaign_validated_reminder' ||
        item.kind === 'event_validated_reminder' ||
        item.kind === 'campaign_started' ||
        item.kind === 'campaign_ended'
      ) {
        return prefs.notify_reminders_events;
      }
      return true;
    })
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 12);

  return {
    items,
    readIds: (reads || []).map((r: { notification_id: string }) => r.notification_id),
  };
}

/**
 * Owner notification bell — feed `useQuery` (polls every 60 s) + one mark-read
 * `useMutation` with optimistic rollback. See `useAdvertiserNotifications` for
 * the D5 / CF-14 rationale; this bell's feed spans ~8 owner-scoped tables.
 */
export function useOwnerNotifications(userId: string | undefined) {
  const queryClient = useQueryClient();
  const feedKey = screenhostKeys.notifications(userId ?? '');

  const query = useQuery({
    queryKey: feedKey,
    queryFn: () => fetchOwnerNotifications(userId as string),
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
      const snapshot = queryClient.getQueryData<NotificationFeed<OwnerNotificationKind>>(feedKey);
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
      const ids = feed.items.map((item) => item.id);
      if (ids.length > 0) markReadMutation.mutate(ids);
    },
  };
}
