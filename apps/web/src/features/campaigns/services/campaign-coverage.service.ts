import { apiClient } from '@/lib/api-client';

// One screenhost that MATCHES a campaign's targeting (category × class), as plotted on the coverage
// map. The backend returns ONLY active, coordinate-bearing venues that match — coordinates are
// already coerced to numbers (the DB stores them as numeric strings) so the map can consume them
// directly. This is a visual coverage preview, not a selectable set.
export interface CoverageScreenhost {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

interface CoverageResponse {
  screenhosts: CoverageScreenhost[];
}

export const coverageService = {
  // GET the screenhosts matching the campaign's persisted targeting. Owner-scoped to the campaign on
  // the server (a foreign id is a 404), so this is always the caller's own draft's coverage.
  get(campaignId: string): Promise<CoverageScreenhost[]> {
    return apiClient
      .get<CoverageResponse>(`/campaigns/${campaignId}/coverage`)
      .then((r) => r.screenhosts);
  },
};
