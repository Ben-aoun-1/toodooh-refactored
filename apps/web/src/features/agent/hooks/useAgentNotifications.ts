import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentNotificationsService } from '@/features/agent/services/agent-notifications.service';

// AGT-6 — ruling Q4 A: short polling (15 s), shared by the bell and the Dashboard block.
export const AGENT_NOTIFICATIONS_KEY = ['notifications', 'agent'] as const;

export const useAgentNotifications = () =>
  useQuery({
    queryKey: AGENT_NOTIFICATIONS_KEY,
    queryFn: () => agentNotificationsService.list(),
    refetchInterval: 15_000,
  });

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => agentNotificationsService.markRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: AGENT_NOTIFICATIONS_KEY }),
  });
};

export const useMarkAllNotificationsRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => agentNotificationsService.markAllRead(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: AGENT_NOTIFICATIONS_KEY }),
  });
};
