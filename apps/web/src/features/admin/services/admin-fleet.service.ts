import { apiClient } from '@/lib/api-client';

// FLEET-1 — « Parc d'écrans » reads (apps/api routes/admin-fleet.ts, figures in lib/fleet).

export type FleetStatus =
  | 'diffuse'
  | 'rien_prevu'
  | 'muet'
  | 'hors_ligne_ouverture'
  | 'hors_ligne'
  | 'jamais';

export interface FleetCampaignNow {
  id: string;
  name: string;
  reps: number;
}

export interface FleetScreenWire {
  id: string;
  name: string;
  venue: { id: string; name: string; zone: string | null };
  status: FleetStatus;
  connected: boolean;
  last_seen_at: string | null;
  paired_at: string | null;
  open_now: boolean;
  match_now: boolean;
  now: { planned_reps: number; campaigns: FleetCampaignNow[] };
  last_proof: { at: string; campaign_name: string | null } | null;
  today: { planned_total: number; planned_so_far: number; aired: number };
}

export interface FleetScreenDetailWire extends FleetScreenWire {
  computed_at: string;
  hours: {
    hour: number;
    planned: number;
    aired: number;
    blackout_minutes: number;
    campaigns: FleetCampaignNow[];
  }[];
  campaigns: {
    id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
    planned_today: number;
    aired_today: number;
    aired_total: number;
    last_proof_at: string | null;
  }[];
}

export const adminFleetService = {
  list(): Promise<{ computed_at: string; screens: FleetScreenWire[] }> {
    return apiClient.get('/admin/fleet');
  },
  screen(id: string): Promise<FleetScreenDetailWire> {
    return apiClient.get(`/admin/fleet/screens/${id}`);
  },
};
