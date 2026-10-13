import { Bell } from 'lucide-react';

import { AgentNotificationItem } from '@/features/agent/components/notifications/AgentNotificationItem';
import { useAgentNotifications } from '@/features/agent/hooks/useAgentNotifications';
import { sortNotifications } from '@/features/agent/lib/agent-notifications';

import { DashboardSection } from './DashboardSection';

/** Dashboard bloc 10 — the latest notifications, the bell's list and read state. */
export function AgentNotificationsBlock() {
  const feed = useAgentNotifications();
  const rows = sortNotifications(feed.data ?? []).slice(0, 5);
  return (
    <DashboardSection
      title="Notifications"
      isEmpty={rows.length === 0}
      empty="Aucune notification pour le moment."
      emptyIcon={<Bell className="h-10 w-10" />}
    >
      <div className="-m-5 divide-y">
        {rows.map((n) => (
          <AgentNotificationItem key={n.id} notification={n} />
        ))}
      </div>
    </DashboardSection>
  );
}
