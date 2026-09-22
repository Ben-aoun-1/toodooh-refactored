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
 * SCR-DECL1 — plus the venue's DECLARED screens (0 = never declared) and rooms (null = never).
 */
export interface OwnerScreenhost extends ScreenhostWifi {
  opening_hour: number | null;
  closing_hour: number | null;
  screen_count: number;
  room_count: number | null;
}

/** SCR-DECL1 — the declared screens / rooms PATCH body: whole numbers 1–99, omitted = unchanged. */
export interface DeclarationPatch {
  screen_count?: number;
  room_count?: number;
}

/** SCR-DECL1 — the PATCH response. `screens_count` = the screens ROWS after the edit (what the
 *  TV app can pair against; once approved they follow `screen_count`). */
export interface ScreenhostDeclaration {
  id: string;
  name: string;
  screen_count: number;
  room_count: number | null;
  screens_count: number;
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
 * Affluence response (L-aff-view). `grid` is a 7×48 weekday×half-hour-slot matrix of the venue's
 * MERGED audience (grid[0]=Monday … grid[6]=Sunday, slot 0–47); HOUR-AVG2 — a slot with no cell
 * is null, a measured 0 is 0. `has_data` is false until the hub has pushed any slots. AFF1:
 * `sources` mirrors the grid's shape with each slot's provenance (null = unknown / no row) and
 * `counts` tallies provenance only (a measured 0 counts).
 */
export interface ScreenhostAffluence {
  grid: (number | null)[][];
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
   * SCR-DECL1 — PATCH /api/screenhosts/:id/declaration — owner-scoped. A 409 names the installed
   * screens the count cannot go below (French message, surfaced as the toast).
   */
  updateDeclaration(id: string, patch: DeclarationPatch): Promise<ScreenhostDeclaration> {
    return apiClient.patch<ScreenhostDeclaration>(`/screenhosts/${id}/declaration`, patch);
  },

  /**
   * GET /api/screenhosts/:id/wifi/reveal — owner-scoped, on-demand reveal of the
   * CURRENT password. Call only when the owner explicitly asks (never on list
   * render); the secret stays out of the list/edit responses.
   */
  revealWifi(id: string): Promise<ScreenhostWifiReveal> {
    return apiClient.get<ScreenhostWifiReveal>(`/screenhosts/${id}/wifi/reveal`);
  },

  /**
   * GET /api/screenhosts/:id/affluence — owner-scoped weekday×hour audience grid (L-aff-view).
   * PERF-R2 — optional from/to scope the read to the période's weekdays (the api masks the
   * others); without them the read stays the unscoped typical week (the owner dashboard).
   */
  getAffluence(id: string, from?: string, to?: string): Promise<ScreenhostAffluence> {
    const range =
      from !== undefined && to !== undefined
        ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        : '';
    return apiClient.get<ScreenhostAffluence>(`/screenhosts/${id}/affluence${range}`);
  },
};
