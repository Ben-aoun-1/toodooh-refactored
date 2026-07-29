import type { ScreenhostWifi, WifiPatch } from '@/features/screenhost/services/screenhost.service';
import { apiClient } from '@/lib/api-client';

/** The venue tiers L-disp prices against — mirrors the server enum (screenhosts.class). */
export type VenueClass = 'populaire' | 'moyen' | 'premium';

/**
 * EL1 — the admin eligibility view of one screenhost (GET /api/admin/screenhosts/:id/eligibility).
 * These are the per-venue L-disp inputs; `sps` is read-only here (defaulted server-side, its
 * computation deferred to L-playout).
 */
export interface ScreenhostEligibility {
  business_sector_id: string | null;
  class: VenueClass | null;
  opening_hour: number | null;
  closing_hour: number | null;
  broadcast_capacity: number | null;
  sps: number;
}

/**
 * The PATCH body — PARTIAL semantics: an omitted field is left unchanged, an explicit null CLEARS
 * it. `sps` is not settable.
 */
/** E4 — one SPS variable of the admin breakdown (value 0-100, its config weight). */
export interface SpsVariableView {
  value: number;
  weight: number;
}

/** E4 — GET /api/admin/screenhosts/:id/sps: the live breakdown + the stored daily snapshot. */
export interface ScreenhostSpsView {
  sps: number;
  stored_sps: number;
  variables: {
    acceptation: SpsVariableView;
    respect_evenements: SpsVariableView;
    activite: SpsVariableView;
    remplissage: SpsVariableView;
  };
}

export interface EligibilityPatch {
  business_sector_id?: string | null;
  class?: VenueClass | null;
  opening_hour?: number | null;
  closing_hour?: number | null;
  broadcast_capacity?: number | null;
}

/**
 * Admin maintenance for ANY screenhost — goes through the toodooh API admin routes
 * (adminGuard server-side), NOT the legacy Supabase `admin-screens.service`. WiFi keeps the same
 * write-only password contract as the owner path; the server fire-and-forgets the wedooh re-push.
 */
export const adminScreenhostService = {
  /** E4 — GET /api/admin/screenhosts/:id/sps: the live SPS breakdown (read-only insight). */
  getSps(id: string): Promise<ScreenhostSpsView> {
    return apiClient.get<ScreenhostSpsView>(`/admin/screenhosts/${id}/sps`);
  },

  /** PATCH /api/admin/screenhosts/:id/wifi — admin edit of any screenhost. */
  updateWifi(id: string, patch: WifiPatch): Promise<ScreenhostWifi> {
    return apiClient.patch<ScreenhostWifi>(`/admin/screenhosts/${id}/wifi`, patch);
  },

  /** GET /api/admin/screenhosts/:id/eligibility — the venue's L-disp eligibility inputs. */
  getEligibility(id: string): Promise<ScreenhostEligibility> {
    return apiClient.get<ScreenhostEligibility>(`/admin/screenhosts/${id}/eligibility`);
  },

  /** PATCH /api/admin/screenhosts/:id/eligibility — partial write; null clears a field. */
  updateEligibility(id: string, patch: EligibilityPatch): Promise<ScreenhostEligibility> {
    return apiClient.patch<ScreenhostEligibility>(`/admin/screenhosts/${id}/eligibility`, patch);
  },
};
