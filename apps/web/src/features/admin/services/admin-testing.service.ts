import { apiClient } from '@/lib/api-client';

// ADM-OBS1 slice A — the admin « Tests » page. Read-only: every number comes from the api's
// engines (periodAudience, computeSps, computeAmax, the resolved dispatch config); this service
// only fetches. apiClient prepends '/api'. Both routes are [requireAuth, requireAdmin].

export interface TestingScreenhost {
  id: string;
  name: string;
  opening_hour: number | null;
  closing_hour: number | null;
  sps_stored: number;
  created_at: string;
}

export interface Stats {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
}

export interface TestingReport {
  screenhost: TestingScreenhost;
  periode: { from: string; to: string; today: string; estimation_floor: string | null };
  audience: {
    total: number;
    measured_days: number;
    estimated_days: number;
    estimated_pct: number | null;
    mean_per_day: number | null;
    mean_per_hour: number | null;
    days: Stats;
    cells: Stats;
    measured_cells: Stats;
    backup_cells: Stats;
    day_rows: { date: string; audience: number; source: string; has_measured: boolean }[];
    cell_rows: { date: string; slot: number; value: number; source: string }[];
    week: { value: number | null; source: string | null }[][];
  };
  sps: {
    live: number;
    stored: number;
    computable: boolean;
    neutral: number;
    variables: Record<string, number>;
    observations: Record<string, number>;
    weights: Record<string, number>;
    windows_days: Record<string, number>;
  };
  /** Slice B — the four-state status of every open hour of the période. */
  status_hours: {
    date: string;
    hour: number;
    state: 'libre' | 'partiel' | 'plein' | 'indisponible';
    engaged_seconds: number;
    minutes_free: number | null;
    campaigns: number;
  }[];
  /** Slice B — the campaigns on this venue over the période (ran fully / disrupted / redispatched / money lost). */
  campaigns: {
    campaign_id: string;
    campaign_name: string;
    campaign_status: string;
    statut_acceptation: string;
    slots_in_period: number;
    slots_elapsed: number;
    slots_delivered: number;
    slots_missed: number;
    impressions_planned_physical: number;
    impressions_missed_physical: number;
    impressions_missed_fact: number;
    ran_fully: boolean;
    disrupted: boolean;
    received_redispatch: boolean;
    money_lost_tnd: number;
    redirected_to: { screenhost_id: string; added_fact: number }[];
  }[];
  pricing: {
    a_max: number;
    cpm_standard_tnd: number;
    cpm_event_tnd: number;
    t: { t10s: number; t20s: number; t30s: number };
    campaign_lead_working_days: number;
    broadcastable_hours: number[];
    unavailable_days: string[];
  };
  config: Record<string, unknown>;
}

export const adminTestingService = {
  list(): Promise<{ screenhosts: TestingScreenhost[] }> {
    return apiClient.get<{ screenhosts: TestingScreenhost[] }>('/admin/testing/screenhosts');
  },
  report(id: string, from: string, to: string): Promise<TestingReport> {
    const q = new URLSearchParams({ from, to });
    return apiClient.get<TestingReport>(`/admin/testing/screenhosts/${id}?${q}`);
  },
};
