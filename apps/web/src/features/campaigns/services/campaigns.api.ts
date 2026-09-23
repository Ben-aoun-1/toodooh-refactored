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
  /**
   * CPM-1 — the campaign's OWN CPMs (TND/1000). CPM-3: its screencaster's — realigned by an admin
   * change while a draft not yet frozen, kept otherwise. Its type picks one (api cpmForCampaign).
   */
  standard_cpm_tnd: number;
  event_cpm_tnd: number;
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
  /**
   * CF-HF3 + IMP-UNIT1 — the frozen plan's PHYSICAL impressions (the real audience: Σ créneau
   * impressions over the non-REFUSE allocations, Σ impressions_total for an event positioning);
   * null until a plan exists, and the surface then asks for the dry-run estimate.
   */
  planned_impressions?: number | null;
  /**
   * IMP-FACT1 (2026-09-23) — the BILLABLE objective ⌊budget × 1000 ÷ CPM⌋ the screencaster paid
   * for: the advertiser's « Impressions prévues », identical before and after dispatch. Optional so
   * a pre-IMP-FACT1 api keeps rendering (the display falls back to planned_impressions).
   */
  impressions_objectif?: number | null;
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

/** MAP-2 — GET /:id/coverage: one definition for the pins and the caption. */
export interface CoverageRead {
  screenhosts: CoverageVenue[];
  covered_count: number;
  without_coordinates: number;
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

/**
 * IMP-EST1 — GET /:id/impressions-estimate: « Impressions estimées », the server's read-only dry-run
 * of the real dispatch over the live semaine type (PHYSICAL impressions — what « prédites » would
 * read if the campaign were dispatched now). Not ok = no estimate, with the reason as a status.
 */
export type ImpressionsEstimateStatus =
  | 'ok'
  | 'no_dates'
  | 'no_budget'
  | 'budget_too_low'
  | 'no_creative'
  | 'no_eligible'
  | 'saturated'
  | 'too_thin'
  | 'event_cancelled';

export interface ImpressionsEstimateRead {
  status: ImpressionsEstimateStatus;
  /** simulation = the dry-run; plan = already dispatched (its real plan). null unless ok. */
  source: 'simulation' | 'plan' | null;
  /** PHYSICAL — the real audience of the (simulated or frozen) plan. */
  impressions: number | null;
  /** IMP-FACT1 — the BILLABLE objective, shown as « Impressions prévues ». Absent on an older api. */
  objectif?: number | null;
  venues_count: number | null;
  days_count: number | null;
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
  /** IMP-EST1 — the dry-run estimate; `budgetTnd` sizes it with the unsaved cursor (else the
   * stored requested_budget). */
  impressionsEstimate(id: string, budgetTnd?: number): Promise<ImpressionsEstimateRead> {
    const query = budgetTnd === undefined ? '' : `?budget_tnd=${encodeURIComponent(budgetTnd)}`;
    return apiClient.get<ImpressionsEstimateRead>(`/campaigns/${id}/impressions-estimate${query}`);
  },
  /** MAP-2 — the campaign's COVERED établissements (the dispatch-eligible set): the plottable
   * ones as `screenhosts`, the total as `covered_count`, the unplottable remainder counted. */
  coverage(id: string): Promise<CoverageRead> {
    return apiClient.get<CoverageRead>(`/campaigns/${id}/coverage`);
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
