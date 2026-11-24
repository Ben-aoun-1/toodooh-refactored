import type { RenderedPage } from '@/features/agent/lib/checklist-model';
import { apiClient } from '@/lib/api-client';

// Mariem 15/11/2026 — the Admin links an agent's qualification fiche to the Screenhost it became
// (api routes/admin-checklists.ts).

export interface AdminChecklistRow {
  id: string;
  name: string;
  category: string;
  governorate: string;
  delegation: string | null;
  agent_name: string;
  agent_code: string | null;
  result: 'elig' | 'non' | 'inc';
  agent_opinion: 'oui' | 'non' | null;
  status: 'sent' | 'validated' | 'refused';
  sent_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  manager_comment: string | null;
  screenhost: { id: string; name: string } | null;
}

export interface AdminChecklistDetail extends AdminChecklistRow {
  agent_comment: string | null;
  pages: RenderedPage[];
}

export const adminChecklistsService = {
  async list(): Promise<AdminChecklistRow[]> {
    return (await apiClient.get<{ checklists: AdminChecklistRow[] }>('/admin/checklists'))
      .checklists;
  },
  detail(id: string): Promise<AdminChecklistDetail> {
    return apiClient.get<AdminChecklistDetail>(`/admin/checklists/${id}`);
  },
  link(id: string, screenhostId: string | null) {
    return apiClient.post<{ ok: true }>(`/admin/checklists/${id}/link`, {
      screenhost_id: screenhostId,
    });
  },
  async ofScreenhost(screenhostId: string): Promise<AdminChecklistRow | null> {
    return (
      await apiClient.get<{ checklist: AdminChecklistRow | null }>(
        `/admin/screenhosts/${screenhostId}/checklist`,
      )
    ).checklist;
  },
};
