import { apiClient } from '@/lib/api-client';

// CF-Z1 — the predefined zones the wizard offers (GET /api/zones, active only; V1: Grand Tunis).
export interface ZoneView {
  id: string;
  name: string;
}

export const zonesApi = {
  list(): Promise<ZoneView[]> {
    return apiClient.get<ZoneView[]>('/zones');
  },
};
