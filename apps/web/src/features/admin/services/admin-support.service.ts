import { apiClient } from '@/lib/api-client';

// SUP-1 — the admin « Support » wire: the queue and its one transition (new → handled).
export interface AdminSupportRow {
  id: string;
  kind: 'support' | 'appointment';
  objective: string;
  other_detail: string | null;
  message: string | null;
  appointment_date: string | null;
  status: 'new' | 'handled';
  handled_at: string | null;
  created_at: string;
  user_id: string;
  user_email: string;
  user_role: string;
  account_label: string;
}

export const adminSupportService = {
  list(status?: string): Promise<AdminSupportRow[]> {
    const q = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
    return apiClient.get<AdminSupportRow[]>(`/admin/support${q}`);
  },
  markHandled(id: string): Promise<{ id: string; status: string }> {
    return apiClient.post<{ id: string; status: string }>(`/admin/support/${id}/handled`, {});
  },
};
