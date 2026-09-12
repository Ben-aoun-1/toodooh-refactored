import { apiClient } from '@/lib/api-client';

import type { AllocationCreative } from './screenhost-allocations.service';

/**
 * CAMP-E1 / SUPA-1 slice 1 — the owner's « Mes campagnes » read, served by `apps/api`:
 *   GET /api/screenhosts/campaigns — every campaign with at least one dispatch allocation on one
 *   of the owner's venues (ANY statut_acceptation), grouped per campaign, newest first.
 *
 * Replaces the retired Supabase composite (`useOwnerCampaignsOverview`: locations /
 * campaign_owner_approvals / business_profiles) that threw in production and left every owner
 * with « Impossible de charger les campagnes » instead of an empty state. The decision model is
 * PER-ALLOCATION (see screenhost-allocations.service): this read is oversight only — accept /
 * reject stays on /owner-allocations. Session-cookie scoped. Wire shape is snake_case.
 */
export type OwnerDecision = 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE' | 'MIXTE';

export interface OwnerCampaignAllocation {
  id: string;
  screenhost_id: string;
  screenhost_name: string;
  statut_acceptation: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
  ii_potentiel: number;
  r_i: number;
  revenu_previsionnel: number;
}

export interface OwnerCampaign {
  id: string;
  name: string;
  campaign_type: string;
  /** campaigns.status — draft | pending | upcoming | active | rejected | completed. */
  status: string;
  start_date: string | null;
  end_date: string | null;
  /** users.business_name ?? contact_name of the advertiser. */
  advertiser_name: string;
  /** Targeting category NAMES; [] = « Toutes les catégories ». */
  categories: string[];
  /** Zone NAMES; [] = « Tout le réseau ». */
  zones: string[];
  /** Linked creative meta; null when the campaign has no creative. */
  creative: AllocationCreative | null;
  /** The OWNER's allocation rows on this campaign (one per venue), venues A→Z. */
  allocations: OwnerCampaignAllocation[];
  totals: { ii_potentiel: number; revenu_previsionnel: number };
  /** Derived over the owner's allocations: unanimous → that statut, otherwise MIXTE. */
  owner_decision: OwnerDecision;
  created_at: string;
}

export const screenhostCampaignsService = {
  /** The signed-in owner's campaigns (any decision state), newest first. */
  list(): Promise<OwnerCampaign[]> {
    return apiClient.get<OwnerCampaign[]>('/screenhosts/campaigns');
  },
};
