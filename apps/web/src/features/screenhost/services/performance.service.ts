import { apiClient } from '@/lib/api-client';

import type {
  DailyAudiencePoint,
  DailyImpressionsPoint,
  PerformanceEarningsLine,
  VenueRatios,
} from '../lib/performance-derive';

/**
 * Owner performance reads for the "Mes performances" page (Lane F) — the four engine endpoints
 * added in `apps/api/routes/screenhosts.ts`. All owner-scoped server-side (cookie session); a
 * foreign venue id is a 404. NO Supabase anywhere on this page's data path.
 */

export interface VenueProfile {
  name: string;
  business_sector: string | null;
  class: 'populaire' | 'moyen' | 'premium' | null;
  opening_hour: number | null;
  closing_hour: number | null;
  sps: number | null;
  /** null unless ALL six ratio columns are synced (the server never sends a partial object). */
  ratios: VenueRatios | null;
}

export interface VenueMonthlyStats {
  months: {
    month: string; // 'YYYY-MM', newest first
    total_audience: number;
    daily: DailyAudiencePoint[];
    peak_day_of_week: number; // 1=Mon … 7=Sun
    peak_hour: number; // 0–23
  }[];
}

export interface VenueImpressionsDaily {
  days: DailyImpressionsPoint[]; // zero days omitted, ascending
}

export interface OwnerEarnings {
  total_tnd: number;
  lines: PerformanceEarningsLine[];
}

export const performanceService = {
  /** GET /api/screenhosts/:id/profile — venue identity card (sector, class, hours, sps, ratios). */
  getProfile(screenhostId: string): Promise<VenueProfile> {
    return apiClient.get<VenueProfile>(`/screenhosts/${screenhostId}/profile`);
  },

  /** GET /api/screenhosts/:id/monthly-stats — the hub's ACTUAL monthly audience, newest first. */
  getMonthlyStats(screenhostId: string): Promise<VenueMonthlyStats> {
    return apiClient.get<VenueMonthlyStats>(`/screenhosts/${screenhostId}/monthly-stats`);
  },

  /**
   * GET /api/screenhosts/:id/impressions-daily?from&to — real delivered impressions per Tunis-local
   * day (proof-of-play VIDEO_ENDED counts). The API bounds the range to 400 days; the page fetches
   * one maximal window per venue and filters CLIENT-SIDE.
   */
  getImpressionsDaily(
    screenhostId: string,
    from: string,
    to: string,
  ): Promise<VenueImpressionsDaily> {
    return apiClient.get<VenueImpressionsDaily>(
      `/screenhosts/${screenhostId}/impressions-daily?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
  },

  /** GET /api/screenhosts/earnings — session-scoped payout lines (Lane F additive campaign keys). */
  getEarnings(): Promise<OwnerEarnings> {
    return apiClient.get<OwnerEarnings>('/screenhosts/earnings');
  },
};
