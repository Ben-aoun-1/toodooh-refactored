import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  useAgentNotifications,
  useMarkAllNotificationsRead,
} from '@/features/agent/hooks/useAgentNotifications';
import { sortNotifications, unreadCount } from '@/features/agent/lib/agent-notifications';
import { AGENT_PATHS } from '@/features/agent/lib/agent-shell';

import { VfEmpty } from './VfEmpty';
import { VfIcon } from './VfIcon';
import { VfNotifItem } from './VfNotifItem';

/** AGENT-VF — the round bell of the header: a red dot while anything is unread, and its panel. */
export function VfBell() {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const feed = useAgentNotifications();
  const markAll = useMarkAllNotificationsRead();
  const rows = sortNotifications(feed.data ?? []);
  const unread = unreadCount(rows);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  return (
    <div className="vf-rel" ref={root}>
      <button
        type="button"
        className="bell"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <VfIcon k="bellFull" size={18} strokeWidth={1.8} plain />
        <i className={unread > 0 ? undefined : 'vf-off'} />
      </button>
      <div className={`pop${open ? ' on' : ''}`}>
        {open && (
          <>
            <div className="ch vf-pop-head">
              <h3>Notifications</h3>
              <button type="button" className="tog" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="vf-pop-list">
              {rows.length === 0 ? (
                <VfEmpty icon="bell" text="Aucune notification pour le moment." />
              ) : (
                rows.map((n) => (
                  <VfNotifItem key={n.id} notification={n} onNavigate={() => setOpen(false)} />
                ))
              )}
            </div>
            <div className="pf">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setOpen(false);
                  navigate(`${AGENT_PATHS.settings}?tab=notifications`);
                }}
              >
                Gérer les notifications
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={unread === 0 || markAll.isPending}
                onClick={() => markAll.mutate()}
              >
                Marquer tout comme lu
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
