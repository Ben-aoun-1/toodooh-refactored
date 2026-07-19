import { apiClient } from '@/lib/api-client';

/**
 * CF-D1 — the owner's devices with REAL liveness, served by `apps/api`
 * (GET /api/screenhosts/screens). One row per screen across all the caller's venues, ordered
 * venue then screen. `connected` is computed SERVER-side against the E6 heartbeat tolerance —
 * the same threshold the engine's dead-screen exclusion uses, so the owner's « Hors ligne » and
 * the redispatcher's "dead" can never disagree. Session-cookie scoped; snake_case wire; no
 * pairing codes/tokens ever ride this payload.
 */
export interface OwnerDeviceRow {
  id: string;
  name: string;
  venue_id: string;
  venue_name: string;
  last_seen_at: string | null;
  connected: boolean;
  paired_at: string | null;
  created_at: string;
}

export const ownerDevicesService = {
  /** The signed-in owner's devices across all venues (venue-then-name order). */
  list(): Promise<OwnerDeviceRow[]> {
    return apiClient.get<OwnerDeviceRow[]>('/screenhosts/screens');
  },
};
