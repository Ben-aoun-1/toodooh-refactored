import { apiClient } from '@/lib/api-client';

// AGT-6 (agent specs v1.0 §8) — the agent's notification feed (/api/notifications): the bell and
// the Dashboard block read the same list and share the read state.

export interface AgentNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  campaign_id: string | null;
  link: string | null;
  appointment_id: string | null;
  appointment_status: string | null;
  read_at: string | null;
  created_at: string;
}

export const agentNotificationsService = {
  list(): Promise<AgentNotification[]> {
    return apiClient.get('/notifications');
  },
  markRead(id: string): Promise<unknown> {
    return apiClient.post(`/notifications/${id}/read`);
  },
  markAllRead(): Promise<{ updated: number }> {
    return apiClient.post('/notifications/read-all');
  },
};
