import { useMemo } from 'react';

import { toChipLabel } from '@/features/campaigns/lib/targeting-chip-label';
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
  /** CF-U1 — NULL until the advertiser sets it (no phantom defaults; renders « — »). */
  budget: number | null;
  /** CF-U1 — the wire field, riding the edit-mode record so Reprendre rehydrates the budget. */
  requested_budget: number | null;
  /** CPM-1 — the campaign's own CPMs (CPM-3: its screencaster's) — the « prévues » price. */
  standard_cpm_tnd: number;
  event_cpm_tnd: number;
  content_validation_status: string | null;
  submitted_at: string | null;
  /** CF-Q1 — « Motif du refus » shown on Non validé campaigns (null otherwise). */
  reject_reason: string | null;
  /** CF-Z1 — the campaign's zones; ride the edit-mode record so Reprendre rehydrates them. */
  zones: { zone_id: string; name: string }[];
  /** CF-S1 — rides the edit-mode record so a resumed draft derives past Création. */
  creative_id: string | null;
  created_at: string;
  // Retained-but-empty on the new engine (Supabase-only concepts the new list drops).
  client: string;
  category: string | null;
  /** EV3 — set on positionings (the « Event » chip, the type filter, the actions matrix). */
  event_id: string | null;
  video_id: string | null;
  selected_categories: string[];
  selected_zones: string[];
  /** CF-B1 — the untrimmed wire row (the Booster modal needs targeting category_ids + zones). */
  raw: CampaignView;
  /** CF-HF3 + IMP-UNIT1 — the frozen plan's PHYSICAL « Impressions prévues »; null pre-plan. */
  planned_impressions: number | null;
}

// Targeting chip labels come from the shared lib (`toChipLabel`) so this list and the wizard's
// Validation recap render them identically.
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
    budget: c.requested_budget ?? null,
    requested_budget: c.requested_budget ?? null,
    standard_cpm_tnd: c.standard_cpm_tnd,
    event_cpm_tnd: c.event_cpm_tnd,
    content_validation_status: c.content_validation_status,
    submitted_at: c.submitted_at,
    reject_reason: c.reject_reason,
    zones: c.zones ?? [],
    creative_id: c.creative_id,
    created_at: c.created_at,
    client: '',
    category: null,
    event_id: c.event_id ?? null,
    video_id: null,
    // Targeting chips + impressions come from the engine (campaign_targeting +
    // campaign_reconciliation + the frozen plan). CF-HF3: selected_zones carries the REAL wire
    // zone names (the old empty [] predated CF-Z1 and blanked the Consulter zones), and
    // validated stays NULL-honest — the display rule renders '—', never a fake 0.
    selected_categories: (c.targeting ?? []).map(toChipLabel),
    selected_zones: (c.zones ?? []).map((z) => z.name),
    planned_impressions: c.planned_impressions ?? null,
    raw: c,
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
