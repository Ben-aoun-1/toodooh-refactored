import { apiClient } from '@/lib/api-client';

import type { Answers, ChecklistResult } from '../lib/checklist-model';

// Agent Screenhost spec VF §11 « Checklist » — the agent's qualification fiches.

export type ChecklistStatus = 'draft' | 'sent' | 'validated' | 'refused';

export interface ChecklistRow {
  id: string;
  status: ChecklistStatus;
  name: string | null;
  category: string | null;
  governorate: string | null;
  delegation: string | null;
  created_at: string;
  result: ChecklistResult | null;
  agent_opinion: 'oui' | 'non' | null;
}

export interface ChecklistFiche extends ChecklistRow {
  answers: Answers;
}

export const agentChecklistsService = {
  async list(): Promise<ChecklistRow[]> {
    return (await apiClient.get<{ checklists: ChecklistRow[] }>('/agent/checklists')).checklists;
  },
  create(): Promise<{ id: string }> {
    return apiClient.post('/agent/checklists', {});
  },
  get(id: string): Promise<ChecklistFiche> {
    return apiClient.get(`/agent/checklists/${id}`);
  },
  save(id: string, answers: Answers) {
    return apiClient.put<{ ok: true }>(`/agent/checklists/${id}`, { answers });
  },
  send(id: string) {
    return apiClient.post<{ ok: true }>(`/agent/checklists/${id}/send`, {});
  },
};
