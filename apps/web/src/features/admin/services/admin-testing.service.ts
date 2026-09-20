import { apiClient } from '@/lib/api-client';

// ADM-OBS1 slice A — the admin « Tests » page. Read-only: every number comes from the api's
// engines (periodAudience, computeSps, computeAmax, the resolved dispatch config); this service
// only fetches. apiClient prepends '/api'. Both routes are [requireAuth, requireAdmin].
// ADM-OBS2 (Mejri 17/09) — hour statistics, the creation day and first reading, the status split
// into « Historique » / « À venir » with pending seconds and event-held hours, the host's share.

export interface TestingScreenhost {
  id: string;
  name: string;
  opening_hour: number | null;
  closing_hour: number | null;
  sps_stored: number;
  created_at: string;
  /** The Tunis calendar day of `created_at` — where « Tout l'historique » starts. */
  created_date: string;
}

export type HourState = 'libre' | 'partiel' | 'plein' | 'indisponible' | 'reservee_evenement';

export interface HourStatusRow {
  date: string;
  hour: number;
  state: HourState;
  /** Σ (reps × spot seconds) of the ACCEPTE and EN_ATTENTE shares. */
  engaged_seconds: number;
  /** The EN_ATTENTE part of `engaged_seconds`. */
  pending_seconds: number;
  /** F − engaged; null when the day is unavailable or an event holds the hour. */
  seconds_free: number | null;
  reps: number;
  campaigns: number;
}

export interface Stats {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
}

export interface TestingReport {
  screenhost: Omit<TestingScreenhost, 'created_date'> & { broadcastable_hours: number[] };
  periode: {
    from: string;
    to: string;
    today: string;
    created_date: string;
    first_reading: string | null;
    estimation_floor: string | null;
    unavailable_days: string[];
  };
  audience: {
    total: number;
    a_max: number;
    measured_days: number;
    estimated_days: number;
    estimated_pct: number | null;
    mean_per_day: number | null;
    mean_per_hour: number | null;
    days: Stats;
    hours: Stats;
    measured_hours: Stats;
    estimated_hours: Stats;
    day_rows: {
      date: string;
      audience: number;
      source: string;
      has_measured: boolean;
      measured_cells: number;
      backup_cells: number;
    }[];
    cell_rows: { date: string; slot: number; value: number; source: string }[];
    week: { value: number | null; source: string | null }[][];
  };
  sps: {
    live: number;
    stored: number;
    computable: boolean;
    neutral: number;
    variables: Record<string, number>;
    /** The evidence over the score's trailing windows — what `computable` rests on. */
    observations: Record<string, number>;
    /** ADM-OBS2 (Mejri 19/09, R10) — the same four counts over the Du/Au période, as shown. */
    observations_period: Record<string, number>;
    weights: Record<string, number>;
    windows_days: Record<string, number>;
  };
  /** The status of every open hour: the elapsed ones of the période, and every one still to come. */
  status_hours: { past: HourStatusRow[]; future: HourStatusRow[] };
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
    missed_value_tnd: number;
    host_share_lost_tnd: number | null;
    redirected_to: { screenhost_id: string; added_fact: number }[];
  }[];
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
