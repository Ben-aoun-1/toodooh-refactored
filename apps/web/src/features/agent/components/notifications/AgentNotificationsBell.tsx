import { Bell, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  useAgentNotifications,
  useMarkAllNotificationsRead,
} from '@/features/agent/hooks/useAgentNotifications';
import { sortNotifications, unreadCount } from '@/features/agent/lib/agent-notifications';
import { AGENT_PATHS } from '@/features/agent/lib/agent-shell';

import { AgentNotificationItem } from './AgentNotificationItem';

/** AGT-6 (agent specs v1.0 §8) — the agent's bell: badge while anything is unread, the panel. */
export function AgentNotificationsBell() {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const feed = useAgentNotifications();
  const markAll = useMarkAllNotificationsRead();
  const rows = sortNotifications(feed.data ?? []);
  const unread = unreadCount(rows);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative rounded-lg p-2 text-[#5C5C5C] hover:bg-gray-100"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[#E1E4EA] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="font-semibold">Notifications</p>
            <button
              type="button"
              onClick={() => {
                navigate(`${AGENT_PATHS.settings}?tab=notifications`);
                setOpen(false);
              }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              <Settings className="h-4 w-4" />
              Gérer les notifications
            </button>
          </div>
          <div className="max-h-[420px] divide-y overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">
                Aucune notification pour le moment.
              </p>
            ) : (
              rows.map((n) => (
                <AgentNotificationItem
                  key={n.id}
                  notification={n}
                  onNavigate={() => setOpen(false)}
                />
              ))
            )}
          </div>
          {unread > 0 && (
            <div className="border-t px-4 py-2 text-right">
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs font-medium text-brand-primary"
              >
                Marquer tout comme lu
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
