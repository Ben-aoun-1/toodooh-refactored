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
  /** FLEET-2 — the TV app's own report; null = an app older than 1.5.6. */
  device: FleetDeviceWire | null;
  device_report_at: string | null;
  issues: FleetIssue[];
}

export type FleetIssue = 'overlay_missing' | 'auto_start_blocked' | 'outdated' | 'unknown_version';

export type FleetStartReason = 'boot' | 'quickboot' | 'update' | 'watchdog' | 'app' | 'system';

export interface FleetDeviceWire {
  app_version_name: string | null;
  app_version_code: number | null;
  android_release: string | null;
  android_sdk: number | null;
  manufacturer: string | null;
  model: string | null;
  overlay_granted: boolean | null;
  auto_start_allowed: boolean | null;
  start_reason: FleetStartReason | null;
  service_started_at: string | null;
}

export interface FleetScreenDetailWire extends FleetScreenWire {
  computed_at: string;
  player: {
    status: string | null;
    current_video_id: string | null;
    playlist_size: number | null;
    cached_videos: number | null;
  } | null;
  player_report_at: string | null;
  events: { kind: string; detail: string | null; at: string }[];
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
  list(): Promise<{
    computed_at: string;
    latest_app: { version_code: number; version_name: string };
    screens: FleetScreenWire[];
  }> {
    return apiClient.get('/admin/fleet');
  },
  screen(id: string): Promise<FleetScreenDetailWire> {
    return apiClient.get(`/admin/fleet/screens/${id}`);
  },
  /** FLEET-2 — « Reconnecter la TV »: it reconnects and receives its playlist again. */
  restart(id: string): Promise<{ sent: number }> {
    return apiClient.post(`/admin/fleet/screens/${id}/restart`, {});
  },
  /** FLEET-2 — « Demander un état »: the TV sends its player state. */
  requestStatus(id: string): Promise<{ sent: number }> {
    return apiClient.post(`/admin/fleet/screens/${id}/status-request`, {});
  },
};
