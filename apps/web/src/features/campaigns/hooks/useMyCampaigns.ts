import { useMemo } from 'react';

import type { CampaignView } from '@/features/campaigns/services/campaigns.api';

import { useMyCampaignsList } from './useCampaignApi';

/**
 * A campaign row as the `MyCampaigns` list renders it — now sourced from the campaigns REST engine
 * (GET /api/campaigns/mine), replacing the legacy Supabase read. The new engine has no client /
 * categories / geographic zones / impressions for the advertiser list, so those Supabase-only fields
 * are retained on the type as empty/zero defaults (the page renders them as "—"/nothing) until the
 * richer surfaces land. budget mirrors the interim INDICATIVE requested_budget.
 */
export interface MyCampaignRow {
  id: string;
  name: string;
  status: string;
  campaign_type: string;
  startDate: Date | null;
  endDate: Date | null;
  start_date: string | null;
  end_date: string | null;
  budget: number;
  content_validation_status: string | null;
  submitted_at: string | null;
  created_at: string;
  // Retained-but-empty on the new engine (Supabase-only concepts the new list drops).
  client: string;
  category: string | null;
  event_id: string | undefined;
  video_id: string | null;
  selected_categories: string[];
  selected_zones: string[];
  validated_impressions: number;
}

/**
 * A targeting line → a human chip label. NULL on an axis means "toutes" (ALL): category null + class
 * set = "Toutes catégories · <class>"; category set + class null = just the category; null/null =
 * "Tout le réseau". Label wording is a product/i18n choice — adjustable.
 */
type TargetingLine = NonNullable<CampaignView['targeting']>[number];
function toChipLabel(line: TargetingLine): string {
  const { category_name, class: cls } = line;
  if (category_name && cls) return `${category_name} · ${cls}`;
  if (!category_name && cls) return `Toutes catégories · ${cls}`;
  if (category_name && !cls) return category_name;
  return 'Tout le réseau';
}

function toRow(c: CampaignView): MyCampaignRow {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    campaign_type: c.campaign_type,
    startDate: c.start_date ? new Date(c.start_date) : null,
    endDate: c.end_date ? new Date(c.end_date) : null,
    start_date: c.start_date,
    end_date: c.end_date,
    budget: c.requested_budget ?? 0,
    content_validation_status: c.content_validation_status,
    submitted_at: c.submitted_at,
    created_at: c.created_at,
    client: '',
    category: null,
    event_id: undefined,
    video_id: null,
    // Targeting chips + delivered impressions now come from the engine (campaign_targeting +
    // campaign_reconciliation). selected_zones stays empty — the engine has no geographic zones.
    selected_categories: (c.targeting ?? []).map(toChipLabel),
    selected_zones: [],
    validated_impressions: c.delivered_impressions ?? 0,
  };
}

/**
 * The signed-in advertiser's campaign list (`MyCampaigns`). Wraps `useMyCampaignsList` — they share
 * `campaignsKeys.list(userId)`, the key the create / update / submit / delete mutations already
 * invalidate — and maps the wire `CampaignView` rows into the page's render shape.
 */
export function useMyCampaigns(userId: string | undefined): {
  campaigns: MyCampaignRow[];
  loading: boolean;
  isError: boolean;
} {
  const query = useMyCampaignsList(userId);
  const campaigns = useMemo(() => (query.data ?? []).map(toRow), [query.data]);
  return {
    campaigns,
    loading: query.isLoading,
    isError: query.isError,
  };
}
