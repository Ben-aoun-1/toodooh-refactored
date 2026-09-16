import { apiClient } from '@/lib/api-client';

/**
 * CAL-2 — the affluence sensor state per venue (GET /api/screenhosts/sensors). Per VENUE because
 * the platform only receives each venue's measured half-hours from the hub, not individual
 * sensors; the api derives the state from the latest measured half-hour.
 */
export type SensorStatus = 'active' | 'offline' | 'never';

export interface OwnerSensorRow {
  venue_id: string;
  venue_name: string;
  status: SensorStatus;
  last_measured_at: string | null;
}

export const ownerSensorsService = {
  list(): Promise<OwnerSensorRow[]> {
    return apiClient.get<OwnerSensorRow[]>('/screenhosts/sensors');
  },
};
