import { Bell, CalendarDays, FileText, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import DecisionModal from '@/features/screenhost/components/decision/DecisionModal';
import { useOwnerNotifications } from '@/features/screenhost/hooks/useOwnerNotifications';
import { useScreenhostAllocations } from '@/features/screenhost/hooks/useScreenhostAllocations';
import { useScreenhostEventAllocations } from '@/features/screenhost/hooks/useScreenhostEventAllocations';
import {
  isDecisionNotification,
  pendingCampaignIds,
  splitNotifications,
} from '@/features/screenhost/lib/decision-notifications';
import { shouldAutoOpen } from '@/lib/popover-auto-open';

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

// GREEN2 item 9 — one auto-open per SPA session, across remounts (reload = a new session).
let autoOpenedThisSession = false;

export default function OwnerNotificationsBell({ userId }: { userId?: string }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [decisionCampaignId, setDecisionCampaignId] = useState<string | null>(null);

  // Feed + mark-read via React Query (Commit 8 — D5). Optimistic-with-rollback
  // mutation; the 60 s poll is the hook's `refetchInterval`.
  const { items, readIds, loading, refetch, markRead, markAllRead } = useOwnerNotifications(userId);

  const readIdSet = useMemo(() => new Set(readIds), [readIds]);
  const unreadCount = useMemo(
    () => items.filter((n) => !readIdSet.has(n.id)).length,
    [items, readIdSet],
  );
  // NOTIF-D1 (ruling 5A, supersedes NOTIF-H1's single list): an accept/refuse notification stays in
  // the main list — read or not — until the owner decides; every other one moves to « Historique »
  // once read. Main list: unread first.
  const pendingAllocations = useScreenhostAllocations(userId);
  const pendingEvents = useScreenhostEventAllocations(userId);
  const pendingKnown =
    !pendingAllocations.loading &&
    !pendingEvents.loading &&
    !pendingAllocations.isError &&
    !pendingEvents.isError;
  const { active, history } = useMemo(
    () =>
      splitNotifications(
        items.map((n) => ({ ...n, campaignId: n.campaignId ?? null })),
        readIdSet,
        pendingCampaignIds(pendingAllocations.allocations, pendingEvents.proposals),
        pendingKnown,
      ),
    [items, readIdSet, pendingAllocations.allocations, pendingEvents.proposals, pendingKnown],
  );
  const visibleItems = useMemo(
    () =>
      tab === 'history'
        ? history
        : [...active].sort((a, b) => Number(readIdSet.has(a.id)) - Number(readIdSet.has(b.id))),
    [tab, active, history, readIdSet],
  );

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

  useEffect(() => {
    // GREEN2 item 9 — auto-open at most ONCE PER SESSION (module flag survives remounts); the
    // old per-mount ref re-armed on zero and re-opened the popover on every navigation.
    if (shouldAutoOpen(unreadCount > 0, autoOpenedThisSession) && !open) {
      setOpen(true);
      autoOpenedThisSession = true;
    }
  }, [unreadCount, open]);

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) refetch();
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
            <div className="flex items-center gap-4">
              <h3 className="text-xl leading-none font-semibold text-[#171717]">Notifications</h3>
              <div className="flex rounded-lg border border-gray-200 p-0.5 text-sm">
                {(
                  [
                    ['active', `À traiter (${active.length})`],
                    ['history', `Historique (${history.length})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`rounded-md px-3 py-1 font-medium ${
                      tab === key ? 'bg-[#EFF5F2] text-[#171717]' : 'text-[#5C5C5C]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
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
              <div className="px-5 py-8 text-sm text-gray-500">
                {tab === 'history'
                  ? 'Aucune notification dans l’historique.'
                  : 'Aucune notification à afficher.'}
              </div>
            ) : (
              visibleItems.map((item) => {
                const isRead = readIdSet.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`px-5 py-4 border-b border-gray-100${isRead ? ' opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative mt-0.5 h-10 w-10 rounded-full border border-brand-primary text-[#2A7A47] flex items-center justify-center">
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
                        {/* REV3 — the motif of a refused facture. Present only for types whose
                            body says something the title cannot (see detailFor). */}
                        {item.detail ? (
                          <p className="text-sm leading-snug text-[#5C5C5C] mt-1">{item.detail}</p>
                        ) : null}
                        <p className="text-sm leading-tight text-[#5C5C5C] mt-0.5">
                          {relativeTime(item.timestamp)}
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          {!isRead ? (
                            <button
                              type="button"
                              onClick={() => markRead(item.id)}
                              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm leading-none text-[#5C5C5C] font-medium hover:bg-gray-50"
                            >
                              Marquer comme lu
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              markRead(item.id);
                              setOpen(false);
                              // NOTIF-D1 — an accept/refuse notification opens the popup in place.
                              const target = { ...item, campaignId: item.campaignId ?? null };
                              if (isDecisionNotification(target) && target.campaignId) {
                                setDecisionCampaignId(target.campaignId);
                              } else {
                                navigate(item.actionPath);
                              }
                            }}
                            className="h-10 px-4 rounded-xl bg-brand-primary text-sm leading-none text-[#101010] font-semibold hover:bg-brand-primary/90"
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
                  navigate('/owner-campaigns');
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
      {decisionCampaignId ? (
        <DecisionModal
          campaignId={decisionCampaignId}
          onClose={() => setDecisionCampaignId(null)}
        />
      ) : null}
    </div>
  );
}
