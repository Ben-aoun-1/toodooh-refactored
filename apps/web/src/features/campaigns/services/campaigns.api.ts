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

export const campaignsApi = {
  create(input: CreateCampaignInput): Promise<CampaignView> {
    return apiClient.post<CampaignView>('/campaigns', input);
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
  remove(id: string): Promise<void> {
    return apiClient.del<void>(`/campaigns/${id}`);
  },
};
