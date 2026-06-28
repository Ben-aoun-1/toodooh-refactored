// Admin campaign-review view (the ACTIVATION keystone). Wire-exact (snake_case, nullable where the
// column is nullable) projection of the server's GET /api/admin/campaigns row — `adminCampaignView`
// PLUS the list-only derived fields (apps/api routes/admin-campaigns.ts): the advertiser's wallet
// balance, the CPM the campaign prices at (by type), and the DERIVED i_cible the operator approves.
// derived_i_cible is null when the campaign has no usable budget (it cannot be activated yet).
export interface AdminCampaignRow {
  id: string;
  advertiser_id: string;
  name: string;
  campaign_type: string;
  status: 'draft' | 'pending' | 'active' | 'rejected';
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  requested_budget: number | null;
  creative_id: string | null;
  content_validation_status: string | null;
  submitted_at: string | null;
  activated_at: string | null;
  activated_by: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
  // List-only derived fields.
  wallet_balance_tnd: number;
  cpm_tnd: number;
  derived_i_cible: number | null;
}

// The statuses the backend list endpoint accepts as a `?status=` filter (no 'all' — omit the param
// to get every campaign).
export type CampaignStatusFilter = 'draft' | 'pending' | 'active' | 'rejected';
