import { apiClient } from '@/lib/api-client';

import { type AffluenceSource } from '../lib/affluence-provenance';

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

/**
 * H2 — the `/mine` list row: the WiFi view PLUS the venue's single-window hours
 * ([open, close), ints 0–23; both null = none set). The WiFi PATCH response stays hour-less.
 */
export interface OwnerScreenhost extends ScreenhostWifi {
  opening_hour: number | null;
  closing_hour: number | null;
}

/** H2 — the owner hours PATCH body: BOTH ints 0–23 with open < close, or BOTH null (clears). */
export interface HoursPatch {
  opening_hour: number | null;
  closing_hour: number | null;
}

export interface ScreenhostHours {
  id: string;
  name: string;
  opening_hour: number | null;
  closing_hour: number | null;
}

/** Reveal response — the decrypted current password, or `null` when none is set. */
export interface ScreenhostWifiReveal {
  wifi_password: string | null;
}

/**
 * Affluence response (L-aff-view). `grid` is a 7×24 weekday×hour matrix of the venue's MERGED
 * typical-week audience (grid[0]=Monday … grid[6]=Sunday, hour 0–23); `has_data` is false until
 * the hub has pushed any slots. AFF1: `sources` mirrors the grid's shape with each slot's
 * provenance (null = unknown / no row) and `counts` tallies provenance only (a measured 0 counts).
 */
export interface ScreenhostAffluence {
  grid: number[][];
  has_data: boolean;
  sources: (AffluenceSource | null)[][];
  counts: { measured: number; backup: number };
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
  getMine(): Promise<OwnerScreenhost[]> {
    return apiClient.get<OwnerScreenhost[]>('/screenhosts/mine');
  },

  /** PATCH /api/screenhosts/:id/wifi — owner-scoped; returns the redacted view. */
  updateWifi(id: string, patch: WifiPatch): Promise<ScreenhostWifi> {
    return apiClient.patch<ScreenhostWifi>(`/screenhosts/${id}/wifi`, patch);
  },

  /** H2 — PATCH /api/screenhosts/:id/hours — owner-scoped single-window hours (or both-null clear). */
  updateHours(id: string, patch: HoursPatch): Promise<ScreenhostHours> {
    return apiClient.patch<ScreenhostHours>(`/screenhosts/${id}/hours`, patch);
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
