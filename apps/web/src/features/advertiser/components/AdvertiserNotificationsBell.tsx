import { Bell, CheckCircle2, Settings, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { logger } from '../../../lib/logger';
import { supabase } from '../../../lib/supabase';

const log = logger.child({ module: 'AdvertiserNotificationsBell' });

type AdvertiserNotificationKind = 'account_approved' | 'video_approved';

type AdvertiserNotification = {
  id: string;
  kind: AdvertiserNotificationKind;
  title: string;
  timestamp: Date;
  actionLabel: string;
  action: () => void;
};

const toDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const relativeTime = (date: Date) => {
  const diff = Math.max(0, Date.now() - date.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'A l instant';
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
};

type Props = {
  userId?: string;
  emphasized?: boolean;
};

export default function AdvertiserNotificationsBell({ userId, emphasized = false }: Props) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const autoOpenedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdvertiserNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const notificationScope = 'advertiser' as const;

  const unreadCount = useMemo(
    () => items.filter((item) => !readIds.has(item.id)).length,
    [items, readIds],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => !readIds.has(item.id)),
    [items, readIds],
  );

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const loadNotifications = async () => {
    if (!userId) return;
    setLoading(true);
    try {
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
          .eq('scope', notificationScope),
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
        const scopeOk = !n?.scope || n.scope === notificationScope;
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
        log.error(
          { error: notificationsRes.error },
          'Erreur chargement user_notifications annonceur',
        );
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

      const generated: AdvertiserNotification[] = [];

      // Source prioritaire: notifications persistées
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
          action: () => navigate(n?.action_path || '/my-campaigns'),
        });
      });

      if (profile?.verification_status === 'approved') {
        const profileTimestamp = toDate(profile.updated_at) || new Date();
        generated.push({
          id: 'fallback-account-approved',
          kind: 'account_approved',
          title: 'Votre compte a ete approuve par l administrateur.',
          timestamp: profileTimestamp,
          actionLabel: 'Ouvrir les parametres',
          action: () => navigate('/profile'),
        });
      }

      campaignRows.forEach((campaign) => {
        const isActiveCampaign = campaign?.status === 'active';
        const byCampaignStatus = campaign?.content_validation_status === 'approved';
        const byVideoStatus =
          typeof campaign?.video_id === 'string' && approvedVideoMap.has(campaign.video_id);
        // Cas nominal: active + validation approuvée.
        // Fallback robuste: active + vidéo attachée (pour éviter un "trou" si champ validation incomplet).
        const isActivationNotificationCandidate =
          isActiveCampaign && (byCampaignStatus || byVideoStatus || Boolean(campaign?.video_id));
        if (!isActivationNotificationCandidate) return;

        const when =
          (typeof campaign?.video_id === 'string'
            ? approvedVideoMap.get(campaign.video_id)
            : null) ||
          toDate(campaign?.updated_at) ||
          new Date();

        generated.push({
          // L'ID inclut le timestamp d'activation: une activation nouvelle crée une notif nouvelle,
          // mais une notif lue ne réapparaît pas tant que ce timestamp ne change pas.
          id: `fallback-video-approved-active-${campaign.id}-${when.getTime()}`,
          kind: 'video_approved',
          title: `Video validee et campagne active : ${campaign?.name || 'Campagne'}`,
          timestamp: when,
          actionLabel: 'Voir mes campagnes',
          action: () => navigate('/my-campaigns'),
        });
      });

      const visible = Array.from(new Map(generated.map((item) => [item.id, item])).values())
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 12);

      setItems(visible);
      setReadIds(new Set((reads || []).map((r: { notification_id: string }) => r.notification_id)));
    } catch (error) {
      log.error({ error }, 'Erreur chargement notifications annonceur');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    void loadNotifications();
    const intervalId = window.setInterval(() => {
      void loadNotifications();
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, [userId]);

  useEffect(() => {
    if (unreadCount > 0 && !open && !autoOpenedRef.current) {
      setOpen(true);
      autoOpenedRef.current = true;
    }
    if (unreadCount === 0) autoOpenedRef.current = false;
  }, [unreadCount, open]);

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next) await loadNotifications();
  };

  const markRead = async (id: string) => {
    if (!userId) return;
    setReadIds((prev) => new Set(prev).add(id));
    const { error } = await supabase.from('user_notification_reads').upsert(
      {
        user_id: userId,
        scope: notificationScope,
        notification_id: id,
        read_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,scope,notification_id' },
    );
    if (error) {
      log.error({ error }, 'Erreur marquage notification lue (annonceur)');
    }
  };

  const markAllRead = async () => {
    if (!userId || items.length === 0) return;
    const ids = items.map((item) => item.id);
    setReadIds(new Set(ids));
    const rows = ids.map((id) => ({
      user_id: userId,
      scope: notificationScope,
      notification_id: id,
      read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('user_notification_reads')
      .upsert(rows, { onConflict: 'user_id,scope,notification_id' });
    if (error) {
      log.error({ error }, 'Erreur marquage toutes notifications lues (annonceur)');
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggleOpen}
        className={`relative p-2.5 rounded-lg flex-shrink-0 ${
          unreadCount > 0
            ? 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
            : emphasized
              ? 'bg-white border border-gray-200 hover:bg-gray-50 text-gray-600'
              : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
        }`}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[560px] max-w-[calc(100vw-24px)] rounded-2xl border border-gray-200 bg-white shadow-xl z-[90] overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-xl leading-none font-semibold text-[#171717]">Notifications</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="px-5 py-8 text-sm text-gray-500">Chargement...</div>
            ) : visibleItems.length === 0 ? (
              <div className="px-5 py-8 text-sm text-gray-500">Aucune notification a afficher.</div>
            ) : (
              visibleItems.map((item) => {
                const isRead = readIds.has(item.id);
                return (
                  <div key={item.id} className="px-5 py-4 border-b border-gray-100">
                    <div className="flex items-start gap-3">
                      <div className="relative mt-0.5 h-10 w-10 rounded-full border border-[#97D6A2] text-[#2A7A47] flex items-center justify-center">
                        {item.kind === 'account_approved' ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Video className="h-4 w-4" />
                        )}
                        {!isRead ? (
                          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base leading-tight font-medium text-[#171717]">
                          {item.title}
                        </p>
                        <p className="text-sm leading-tight text-[#5C5C5C] mt-0.5">
                          {relativeTime(item.timestamp)}
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          {!isRead ? (
                            <button
                              type="button"
                              onClick={() => void markRead(item.id)}
                              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm leading-none text-[#5C5C5C] font-medium hover:bg-gray-50"
                            >
                              Marquer comme lu
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              void markRead(item.id);
                              setOpen(false);
                              item.action();
                            }}
                            className="h-10 px-4 rounded-xl bg-[#9AE2B0] text-sm leading-none text-[#101010] font-semibold hover:bg-[#85D99E]"
                          >
                            {item.actionLabel}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/profile?tab=notifications');
              }}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#5C5C5C] hover:text-[#171717]"
            >
              <Settings className="h-4 w-4" />
              Gerer les notifications
            </button>
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-medium text-[#5C5C5C] hover:bg-gray-50"
            >
              Marquer tout comme lu
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
