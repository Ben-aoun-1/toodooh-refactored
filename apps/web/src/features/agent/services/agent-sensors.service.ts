import { apiClient } from '@/lib/api-client';

// Agent Screenhost spec VF §12 « Suivi des capteurs » and §14 « Assigner un capteur ».

export interface SensorVenueCard {
  screenhost_id: string;
  name: string;
  category: string | null;
  status: 'en_attente_activation' | 'en_cours';
  people_now: number;
  online: number;
  offline: number;
}

export interface SensorsOverview {
  totals: { sensors: number; online: number; offline: number };
  venues: SensorVenueCard[];
}

export type HeatGrid = { hour: number; days: (number | null)[] }[];

export interface SensorVenueDetail {
  card: SensorVenueCard;
  wifi_ssid: string | null;
  wifi_password_set: boolean;
  average_per_sensor: number;
  last24h: { at: string; people: number | null }[];
  heat_typical: HeatGrid;
  heat_week: HeatGrid;
  sensors: {
    id: string;
    label: string;
    online: boolean;
    people: number | null;
    battery_pct: number | null;
    last_seen_at: string | null;
  }[];
}

export interface AssignableSensor {
  id: string;
  label: string;
  status: 'online' | 'offline' | 'never';
  battery_pct: number | null;
  screenhost_id: string | null;
  screenhost_name: string | null;
}

export interface AssignVenue {
  screenhost_id: string;
  name: string;
  status: 'en_attente_activation' | 'en_cours';
  sensor_count: number;
}

export interface SensorAssignment {
  sensors: AssignableSensor[];
  venues: AssignVenue[];
}

export const agentSensorsService = {
  overview(): Promise<SensorsOverview> {
    return apiClient.get('/agent/sensors');
  },
  venue(id: string): Promise<SensorVenueDetail> {
    return apiClient.get(`/agent/sensors/${id}`);
  },
  wifiPassword(id: string): Promise<{ password: string | null }> {
    return apiClient.post(`/agent/sensors/${id}/wifi-password`, {});
  },
  assignment(): Promise<SensorAssignment> {
    return apiClient.get('/agent/sensors/assignment');
  },
  assign(deviceId: string, screenhostId: string) {
    return apiClient.post<{ ok: true; sensor: string; screenhost: string }>(
      '/agent/sensors/assignment',
      { device_id: deviceId, screenhost_id: screenhostId },
    );
  },
};
