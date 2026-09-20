import type { CampaignStatusId } from '@/features/campaigns/lib/campaign-status';

// Admin campaign-review view (the ACTIVATION keystone). Wire-exact (snake_case, nullable where the
// column is nullable) projection of the server's GET /api/admin/campaigns row — `adminCampaignView`
// PLUS the list-only derived fields (apps/api routes/admin-campaigns.ts): the advertiser's wallet
// balance, the CPM the campaign prices at (by type), and the DERIVED i_cible the operator approves.
// derived_i_cible is null when the campaign has no usable budget (it cannot be activated yet).
export interface AdminCampaignRow {
  id: string;
  advertiser_id: string;
  /**
   * ADM-FIX1 — the advertiser's NAME (api lib/user-label: business_name, else contact_name). The
   * queue shows this; `advertiser_id` survives only as the muted support line.
   */
  advertiser_label: string;
  name: string;
  campaign_type: string;
  /**
   * ADM-FIX1 — the CANONICAL six-valued union (campaigns/lib/campaign-status). It was hand-written
   * and 4-valued here while the stored enum had six, so 'upcoming' and 'completed' rows were
   * type-invisible and the queue's badge fell back to « En attente » for them.
   */
  status: CampaignStatusId;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  requested_budget: number | null;
  creative_id: string | null;
  /** EV4 — the positioning BINDING: the examen shows the allocations table when set. */
  event_id: string | null;
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

// The statuses the backend list endpoint accepts as a `?status=` filter — ALL SIX (the api's
// listQuerySchema enumerates exactly the stored enum). No 'all' value: omit the param to get every
// campaign (the queue's « Toutes » option does that — see admin/lib/campaign-queue).
export type CampaignStatusFilter = CampaignStatusId;
