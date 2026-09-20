import { apiClient } from '@/lib/api-client';

// CPM-3 (operator rulings 2026-09-18) — the admin « CPM par screencaster » surface over REST
// (GET/PATCH /api/admin/screencasters/cpm, both [requireAuth, requireAdmin]). apiClient prepends
// '/api'. A change re-prices the screencasters' drafts; every other campaign keeps its price.

export interface ScreencasterCpmRow {
  id: string;
  company_name: string | null;
  contact_name: string;
  email: string;
  business_type: string | null;
  status: string;
  cpm_standard_tnd: number;
  cpm_event_tnd: number;
  draft_count: number;
  last_change: { changed_at: string; changed_by_name: string } | null;
}

export interface ScreencasterCpmPatch {
  user_ids: string[];
  standard_cpm_tnd?: number;
  event_cpm_tnd?: number;
}

export interface ScreencasterCpmPatchResult {
  updated: number;
  drafts_repriced: number;
}

export const adminScreencasterCpmService = {
  list(): Promise<{ screencasters: ScreencasterCpmRow[] }> {
    return apiClient.get<{ screencasters: ScreencasterCpmRow[] }>('/admin/screencasters/cpm');
  },
  update(body: ScreencasterCpmPatch): Promise<ScreencasterCpmPatchResult> {
    return apiClient.patch<ScreencasterCpmPatchResult>('/admin/screencasters/cpm', body);
  },
};
