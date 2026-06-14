import { apiClient } from '@/lib/api-client';

/**
 * Owner/admin WiFi maintenance for the caller's screenhosts (S-T1 lane).
 * Talks to the toodooh API (apps/api `routes/screenhosts.ts`) — NOT the legacy
 * Supabase surface. The password is write-only end-to-end: `wifi_password_set`
 * is the only signal that comes back; the secret is never read.
 */
export interface ScreenhostWifi {
  id: string;
  name: string;
  wifi_ssid: string | null;
  wifi_password_set: boolean;
}

/**
 * PATCH body. SSID: omit to leave, `null` to clear, string to set. Password:
 * omit (or blank, dropped by the caller) to leave, `null` to clear, non-empty
 * string to set the new secret.
 */
export interface WifiPatch {
  wifi_ssid?: string | null;
  wifi_password?: string | null;
}

export const screenhostService = {
  /** GET /api/screenhosts/mine — returns the array directly (no envelope). */
  getMine(): Promise<ScreenhostWifi[]> {
    return apiClient.get<ScreenhostWifi[]>('/screenhosts/mine');
  },

  /** PATCH /api/screenhosts/:id/wifi — owner-scoped; returns the redacted view. */
  updateWifi(id: string, patch: WifiPatch): Promise<ScreenhostWifi> {
    return apiClient.patch<ScreenhostWifi>(`/screenhosts/${id}/wifi`, patch);
  },
};
