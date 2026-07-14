import { Bell, CalendarDays, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAdvertiserNotifications } from '@/features/advertiser/hooks/useAdvertiserNotifications';

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

  // Feed + mark-read via React Query (Commit 8 — D5). The mutation is
  // optimistic-with-rollback; the 60 s poll is the hook's `refetchInterval`.
  const { items, readIds, loading, refetch, markRead, markAllRead } =
    useAdvertiserNotifications(userId);

  const readIdSet = useMemo(() => new Set(readIds), [readIds]);
  const unreadCount = useMemo(
    () => items.filter((item) => !readIdSet.has(item.id)).length,
    [items, readIdSet],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => !readIdSet.has(item.id)),
    [items, readIdSet],
  );

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (unreadCount > 0 && !open && !autoOpenedRef.current) {
      setOpen(true);
      autoOpenedRef.current = true;
    }
    if (unreadCount === 0) autoOpenedRef.current = false;
  }, [unreadCount, open]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) refetch();
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
                const isRead = readIdSet.has(item.id);
                // Captured so the narrowing survives into the onClick closure (TS strict).
                const action = item.action;
                return (
                  <div key={item.id} className="px-5 py-4 border-b border-gray-100">
                    <div className="flex items-start gap-3">
                      <div className="relative mt-0.5 h-10 w-10 rounded-full border border-brand-primary text-[#2A7A47] flex items-center justify-center">
                        {item.kind === 'campaign_draft_reminder' ? (
                          <CalendarDays className="h-4 w-4" />
                        ) : (
                          <Bell className="h-4 w-4" />
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
                              onClick={() => markRead(item.id)}
                              className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm leading-none text-[#5C5C5C] font-medium hover:bg-gray-50"
                            >
                              Marquer comme lu
                            </button>
                          ) : null}
                          {/* CF-S1b — nullable CTA: an unknown type renders plainly, no button. */}
                          {action ? (
                            <button
                              type="button"
                              onClick={() => {
                                markRead(item.id);
                                setOpen(false);
                                navigate(action.path);
                              }}
                              className="h-10 px-4 rounded-xl bg-brand-primary text-sm leading-none text-[#101010] font-semibold hover:bg-brand-primary/90"
                            >
                              {action.label}
                            </button>
                          ) : null}
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
