import { parseCampaignUiDate, toLocalDateOnlyString } from '@/features/campaigns/lib/wizard-dates';

import { CART_BUDGET_DEFAULT_TND } from './cart-budget';
import type { WizardState } from './wizard-types';

/**
 * Loose shape for an edit-mode campaign record. Accepts both the campaigns-engine wire shape
 * (snake_case `start_date` / `creative_id` / `requested_budget`) and the camelCase router payload, so
 * the wizard can prefill from either MyCampaigns navigation state or a fetched CampaignView.
 */
export interface CampaignEditRecord {
  id?: string;
  name?: string;
  startDate?: string | Date | null;
  start_date?: string | null;
  endDate?: string | Date | null;
  end_date?: string | null;
  creative_id?: string | null;
  requested_budget?: number | null;
  /** CF-Z1 — the campaign's zones as the projection exposes them (GET /mine, GET /:id). */
  zones?: { zone_id: string; name: string }[];
}

export interface BuildInitialWizardStateArgs {
  campaignToEdit: CampaignEditRecord | null;
}

/** Construct the initial WizardState from an edit-mode record (or a fresh blank). */
export function buildInitialWizardState(args: BuildInitialWizardStateArgs): WizardState {
  const c = args.campaignToEdit;

  const startRaw = parseCampaignUiDate(c?.startDate ?? c?.start_date ?? null);
  const endRaw = parseCampaignUiDate(c?.endDate ?? c?.end_date ?? null);

  return {
    campaignName: c?.name ?? '',
    startDate: startRaw ? toLocalDateOnlyString(startRaw) : null,
    endDate: endRaw ? toLocalDateOnlyString(endRaw) : null,
    creativeId: c?.creative_id ?? null,
    // Interim budget slider defaults to its MAX position; an edit-mode record keeps its saved value.
    requestedBudget: c?.requested_budget ?? CART_BUDGET_DEFAULT_TND,
    // CF-Z1 — a resumed campaign keeps its persisted zones (possibly none = whole network); a
    // fresh wizard starts empty and the Zones step defaults it once the zones load.
    zoneIds: (c?.zones ?? []).map((z) => z.zone_id),
    draftCampaignId: c?.id ?? '',
  };
}
