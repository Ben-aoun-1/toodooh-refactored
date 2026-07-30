import { apiClient } from '@/lib/api-client';

// The new campaigns engine — REST (POST/GET /api/campaigns + /mine + /:id/submit), replacing the
// legacy Supabase campaign.service for the wizard. snake_case wire shapes mirror the API exactly.
// requested_budget is the interim manual cart's INDICATIVE budget (TND); L-price replaces it.

export interface CampaignView {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  requested_budget: number | null;
  content_validation_status: string | null;
  submitted_at: string | null;
  // CF-Q1 — the admin's mandatory rejection audit, surfaced to the advertiser (« Motif du refus »).
  rejected_at: string | null;
  reject_reason: string | null;
  /** CF-S1 — the linked creative (Reprendre rehydrates past Création with it). */
  creative_id: string | null;
  /** EV3 — the positioned match (the BINDING is the discriminator; null = classic campaign). */
  event_id: string | null;
  created_at: string;
  updated_at: string;
  // Reconciled performance + targeting (GET /mine only; optional so other CampaignView readers gain
  // no required field). delivered_impressions/spend_tnd/reconciled_at are null until reconciliation;
  // targeting is the campaign's category × class lines (NULL on either axis = "toutes").
  targeting?: { category_id: string | null; category_name: string | null; class: string | null }[];
  /** CF-Z1 — the campaign's zones (GET /mine + GET /:id; absent on create/PATCH responses). */
  zones?: { zone_id: string; name: string }[];
  delivered_impressions?: number | null;
  spend_tnd?: number | null;
  reconciled_at?: string | null;
  /** CF-HF3 — the frozen plan's placed facturable (Σ ii_potentiel); null until a plan exists. */
  planned_impressions?: number | null;
}

export interface CreateCampaignInput {
  name: string;
  campaign_type: string;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  requested_budget?: number | null;
}

export interface UpdateCampaignInput {
  name?: string;
  campaign_type?: string;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  requested_budget?: number | null;
  /** CF-Z1 — replace-set of targeted zones; [] clears (whole network). */
  zone_ids?: string[];
  creative_id?: string | null;
}

/** CF-U1 — one plottable venue of the coverage preview (GET /:id/coverage, kept at CF-Z1). */
export interface CoverageVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** CF-SK1 rider — the venue's sector name for the map popup's category chip (NULL = unset). */
  sector_name: string | null;
}

/** E5 (VF US-1.3) — the live C_max ceiling bounding the Validation-step budget cursor. */
export interface CampaignCmaxRead {
  /** ⌊CPM × I_max ÷ 1000⌋ — whole TND (the server floors; the promise must be deliverable). */
  c_max_tnd: number;
  i_max_facturable: number;
  eligible_count: number;
  /** CF-HF4 — targeting-matching venues BEFORE capacity exclusions (the saturated/empty split). */
  targeted_count?: number;
}

export const campaignsApi = {
  create(input: CreateCampaignInput): Promise<CampaignView> {
    return apiClient.post<CampaignView>('/campaigns', input);
  },
  /**
   * E5 — GET /:id/cmax: the ceiling computed on assemblePool's LIVE occupancy truth. 409
   * CMAX_REQUIRES until the campaign has dates + a creative (the wizard guarantees both before
   * Validation mounts).
   */
  cmax(id: string): Promise<CampaignCmaxRead> {
    return apiClient.get<CampaignCmaxRead>(`/campaigns/${id}/cmax`);
  },
  /** The active, coordinate-bearing venues matching the campaign's targeting (map preview). */
  coverage(id: string): Promise<{ screenhosts: CoverageVenue[] }> {
    return apiClient.get<{ screenhosts: CoverageVenue[] }>(`/campaigns/${id}/coverage`);
  },
  mine(): Promise<CampaignView[]> {
    return apiClient.get<CampaignView[]>('/campaigns/mine');
  },
  get(id: string): Promise<CampaignView> {
    return apiClient.get<CampaignView>(`/campaigns/${id}`);
  },
  update(id: string, input: UpdateCampaignInput): Promise<CampaignView> {
    return apiClient.patch<CampaignView>(`/campaigns/${id}`, input);
  },
  submit(id: string): Promise<CampaignView> {
    return apiClient.post<CampaignView>(`/campaigns/${id}/submit`);
  },
  /** CF-RJ1 « Rejouer » — clone a COMPLETED campaign into a fresh, date-less draft (201). */
  replay(id: string): Promise<CampaignView> {
    return apiClient.post<CampaignView>(`/campaigns/${id}/replay`);
  },
  remove(id: string): Promise<void> {
    return apiClient.del<void>(`/campaigns/${id}`);
  },
};
