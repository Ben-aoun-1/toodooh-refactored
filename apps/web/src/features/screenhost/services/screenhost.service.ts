import { apiClient } from '@/lib/api-client';

/**
 * Owner/admin WiFi maintenance for the caller's screenhosts (S-T1 lane).
 * Talks to the toodooh API (apps/api `routes/screenhosts.ts`) — NOT the legacy
 * Supabase surface. The LIST + EDIT responses are write-only: `wifi_password_set`
 * is the only password signal that comes back. The ONE exception is the explicit
 * `revealWifi` call below, which returns the decrypted secret on demand (R1).
 */
export interface ScreenhostWifi {
  id: string;
  name: string;
  wifi_ssid: string | null;
  wifi_password_set: boolean;
}

/** Reveal response — the decrypted current password, or `null` when none is set. */
export interface ScreenhostWifiReveal {
  wifi_password: string | null;
}

/**
 * Affluence response (L-aff-view). `grid` is a 7×24 weekday×hour matrix of the venue's estimated
 * audience (grid[0]=Monday … grid[6]=Sunday, hour 0–23); `has_data` is false until the hub has
 * pushed any slots.
 */
export interface ScreenhostAffluence {
  grid: number[][];
  has_data: boolean;
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

  /**
   * GET /api/screenhosts/:id/wifi/reveal — owner-scoped, on-demand reveal of the
   * CURRENT password. Call only when the owner explicitly asks (never on list
   * render); the secret stays out of the list/edit responses.
   */
  revealWifi(id: string): Promise<ScreenhostWifiReveal> {
    return apiClient.get<ScreenhostWifiReveal>(`/screenhosts/${id}/wifi/reveal`);
  },

  /** GET /api/screenhosts/:id/affluence — owner-scoped weekday×hour audience grid (L-aff-view). */
  getAffluence(id: string): Promise<ScreenhostAffluence> {
    return apiClient.get<ScreenhostAffluence>(`/screenhosts/${id}/affluence`);
  },
};
