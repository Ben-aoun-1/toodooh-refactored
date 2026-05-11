import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CalendarDays, FileText, Settings, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { campaignOwnerApprovalService } from '../services/campaign-owner-approval.service';

type OwnerNotificationKind =
  | 'campaign_validated_reminder'
  | 'event_validated_reminder'
  | 'campaign_validation_received'
  | 'campaign_started'
  | 'campaign_ended'
  | 'bank_coordinates_validated';

type OwnerNotification = {
  id: string;
  kind: OwnerNotificationKind;
  title: string;
  timestamp: Date;
  actionLabel: string;
  action: () => void;
};

type NotificationPrefs = {
  notify_news_updates: boolean;
  notify_reminders_events: boolean;
  notify_promotions_offers: boolean;
  verification_status: string | null;
};

const toDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const relativeTime = (date: Date) => {
  const diff = Math.max(0, Date.now() - date.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'À l’instant';
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
};

const isWithinHours = (target: Date, fromNow: number, toNow: number) => {
  const diffHours = (target.getTime() - Date.now()) / (1000 * 60 * 60);
  return diffHours >= fromNow && diffHours <= toNow;
};

export default function OwnerNotificationsBell({ userId }: { userId?: string }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<OwnerNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const notificationScope = 'owner' as const;
  const autoOpenedRef = useRef(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    notify_news_updates: false,
    notify_reminders_events: true,
    notify_promotions_offers: false,
    verification_status: null,
  });

  const unreadCount = useMemo(
    () => items.filter((n) => !readIds.has(n.id)).length,
    [items, readIds],
  );
  const visibleItems = useMemo(() => items.filter((n) => !readIds.has(n.id)), [items, readIds]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const loadNotifications = async () => {
    if (!userId) return;
    setLoading(true);
    try {
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
          .eq('scope', notificationScope),
      ]);

      const mergedPrefs: NotificationPrefs = {
        notify_news_updates: profile?.notify_news_updates ?? false,
        notify_reminders_events: profile?.notify_reminders_events ?? true,
        notify_promotions_offers: profile?.notify_promotions_offers ?? false,
        verification_status: profile?.verification_status ?? null,
      };
      setPrefs(mergedPrefs);

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
          : { data: [] as any[] };

      const campaigns = campaignsRes.data || [];
      const campaignById = new Map<string, any>(campaigns.map((c: any) => [c.id, c]));
      const approvals = (ownerApprovals.data || []) as Array<{
        campaign_id: string;
        status: string;
        created_at: string;
        updated_at: string;
      }>;

      const generated: OwnerNotification[] = [];

      // 1) Réception campagne pour validation
      (pendingCampaigns || [])
        .filter((c) => (c.approval_status || 'pending') === 'pending')
        .forEach((pending) => {
          const c = campaignById.get(pending.campaign_id) || pending;
          const ref = approvals.find((a) => a.campaign_id === pending.campaign_id);
          generated.push({
            id: `pending-${pending.campaign_id}`,
            kind: 'campaign_validation_received',
            title: `Réception campagne pour validation : ${c.name || 'Campagne'}`,
            timestamp:
              toDate(ref?.updated_at) ||
              toDate(ref?.created_at) ||
              toDate((c as any)?.campaign_start_date) ||
              new Date(),
            actionLabel: 'Consulter la campagne',
            action: () => navigate('/owner-campaign-approvals'),
          });
        });

      // 2/3/4/5) Rappels + début/fin
      campaigns.forEach((c: any) => {
        const start = toDate(c.start_date);
        const end = toDate(c.end_date);
        if (!start || !end) return;

        // Rappel campagne validée J-1
        if (!c.event_id && isWithinHours(start, 0, 30)) {
          generated.push({
            id: `reminder-campaign-${c.id}`,
            kind: 'campaign_validated_reminder',
            title: `Rappel campagne validée (à venir) (J-1) : ${c.name || 'Campagne'}`,
            timestamp: start,
            actionLabel: 'Consulter la campagne',
            action: () => navigate('/owner-campaign-approvals'),
          });
        }

        // Rappel événement validé H-4
        if (c.event_id && isWithinHours(start, 0, 4)) {
          generated.push({
            id: `reminder-event-${c.id}`,
            kind: 'event_validated_reminder',
            title: `Rappel événement validé (à venir) (H-4) : ${c.name || 'Campagne événement'}`,
            timestamp: start,
            actionLabel: 'Consulter la campagne',
            action: () => navigate('/owner-campaign-approvals'),
          });
        }

        const now = Date.now();
        const startMs = start.getTime();
        const endMs = end.getTime();

        // Début campagne (sur les 24h qui suivent le début)
        if (now >= startMs && now - startMs <= 24 * 60 * 60 * 1000) {
          generated.push({
            id: `start-${c.id}`,
            kind: 'campaign_started',
            title: `Début campagne : ${c.name || 'Campagne'}`,
            timestamp: start,
            actionLabel: 'Consulter la campagne',
            action: () => navigate(`/owner-campaigns?openCampaignId=${c.id}`),
          });
        }

        // Fin campagne (sur les 24h suivant la fin)
        if (now >= endMs && now - endMs <= 24 * 60 * 60 * 1000) {
          generated.push({
            id: `end-${c.id}`,
            kind: 'campaign_ended',
            title: `Fin campagne : ${c.name || 'Campagne'}`,
            timestamp: end,
            actionLabel: 'Consulter la campagne',
            action: () => navigate(`/owner-campaigns?openCampaignId=${c.id}`),
          });
        }
      });

      // 6) Validation coordonnées bancaires (proxy via profile vérifié)
      if (mergedPrefs.verification_status === 'verified') {
        generated.push({
          id: 'bank-coordinates-validated',
          kind: 'bank_coordinates_validated',
          title: 'Validation coordonnées bancaires',
          timestamp: new Date(),
          actionLabel: 'Ouvrir les paramètres',
          action: () => navigate('/owner-settings?tab=entreprise&sub=informations'),
        });
      }

      const visible = generated
        .filter((item) => {
          if (item.kind === 'campaign_validation_received')
            return mergedPrefs.notify_reminders_events;
          if (item.kind === 'bank_coordinates_validated') return mergedPrefs.notify_news_updates;
          if (
            item.kind === 'campaign_validated_reminder' ||
            item.kind === 'event_validated_reminder' ||
            item.kind === 'campaign_started' ||
            item.kind === 'campaign_ended'
          ) {
            return mergedPrefs.notify_reminders_events;
          }
          return true;
        })
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 12);

      setItems(visible);
      setReadIds(new Set((reads || []).map((r: { notification_id: string }) => r.notification_id)));
    } catch (error) {
      console.error('Erreur chargement notifications propriétaire:', error);
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
    if (unreadCount === 0) {
      autoOpenedRef.current = false;
    }
  }, [unreadCount, open]);

  const handleOpen = async () => {
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
      console.error('Erreur marquage notification lue (proprio):', error);
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
      console.error('Erreur marquage toutes notifications lues (proprio):', error);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={handleOpen}
        className={`relative h-10 w-10 rounded-xl inline-flex items-center justify-center transition-colors ${
          unreadCount > 0
            ? 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
            : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
        }`}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500" />
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
              <div className="px-5 py-8 text-sm text-gray-500">Aucune notification à afficher.</div>
            ) : (
              visibleItems.map((item) => {
                const isRead = readIds.has(item.id);
                return (
                  <div key={item.id} className="px-5 py-4 border-b border-gray-100">
                    <div className="flex items-start gap-3">
                      <div className="relative mt-0.5 h-10 w-10 rounded-full border border-[#97D6A2] text-[#2A7A47] flex items-center justify-center">
                        {item.kind === 'bank_coordinates_validated' ? (
                          <FileText className="h-4 w-4" />
                        ) : (
                          <CalendarDays className="h-4 w-4" />
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
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate('/owner-settings?tab=notifications');
                }}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#5C5C5C] hover:text-[#171717]"
              >
                <Settings className="h-4 w-4" />
                Gérer les notifications
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate('/owner-campaign-approvals');
                }}
                className="text-sm font-medium text-[#5C5C5C] hover:text-[#171717] underline underline-offset-2"
              >
                Voir toutes les notifications
              </button>
            </div>
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
