import { apiClient } from '@/lib/api-client';

import { type TargetingClass, type TargetingLineWire } from '../lib/targeting-lines';

// One persisted targeting line as returned by the API — the wire shape plus the joined category name
// (null for "toutes les catégories"), so the summary can render without a second reference lookup.
export interface TargetingLineRow {
  category_id: string | null;
  category_name: string | null;
  class: TargetingClass | null;
}

interface TargetingResponse {
  lines: TargetingLineRow[];
}

export const targetingService = {
  get(campaignId: string): Promise<TargetingLineRow[]> {
    return apiClient
      .get<TargetingResponse>(`/campaigns/${campaignId}/targeting`)
      .then((r) => r.lines);
  },
  // Replace-set: PUT the full list of lines; the server validates dedup + categories and echoes back
  // the persisted set.
  save(campaignId: string, lines: TargetingLineWire[]): Promise<TargetingLineRow[]> {
    return apiClient
      .put<TargetingResponse>(`/campaigns/${campaignId}/targeting`, { lines })
      .then((r) => r.lines);
  },
};
