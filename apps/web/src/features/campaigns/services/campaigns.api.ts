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
  created_at: string;
  updated_at: string;
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
