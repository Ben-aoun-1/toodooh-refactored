import { Bell, CalendarDays, FileText, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useOwnerNotifications } from '@/features/screenhost/hooks/useOwnerNotifications';

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

export default function OwnerNotificationsBell({ userId }: { userId?: string }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const autoOpenedRef = useRef(false);

  // Feed + mark-read via React Query (Commit 8 — D5). Optimistic-with-rollback
  // mutation; the 60 s poll is the hook's `refetchInterval`.
  const { items, readIds, loading, refetch, markRead, markAllRead } = useOwnerNotifications(userId);

  const readIdSet = useMemo(() => new Set(readIds), [readIds]);
  const unreadCount = useMemo(
    () => items.filter((n) => !readIdSet.has(n.id)).length,
    [items, readIdSet],
  );
  const visibleItems = useMemo(() => items.filter((n) => !readIdSet.has(n.id)), [items, readIdSet]);

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
    if (unreadCount > 0 && !open && !autoOpenedRef.current) {
      setOpen(true);
      autoOpenedRef.current = true;
    }
    if (unreadCount === 0) {
      autoOpenedRef.current = false;
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
                const isRead = readIdSet.has(item.id);
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
                              navigate(item.actionPath);
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
