import { apiClient } from '@/lib/api-client';

/**
 * The in-app notification feed, served by `apps/api` (GET /api/notifications,
 * POST /api/notifications/:id/read). Session-user-scoped: the cookie identifies
 * the recipient, so there is no userId argument. Replaces the Supabase-backed
 * owner notification feed (the legacy `user_notifications` / `*_reads` tables).
 *
 * Wire shape is snake_case (the API contract); hooks map it to their view model.
 */
export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  campaign_id: string | null;
  read_at: string | null;
  created_at: string;
}

export const notificationsService = {
  /** The signed-in user's notifications, newest first. */
  list(): Promise<ApiNotification[]> {
    return apiClient.get<ApiNotification[]>('/notifications');
  },

  /** Mark one of the caller's notifications read (idempotent; 404 if not theirs). */
  markRead(id: string): Promise<ApiNotification> {
    return apiClient.post<ApiNotification>(`/notifications/${id}/read`);
  },
};
