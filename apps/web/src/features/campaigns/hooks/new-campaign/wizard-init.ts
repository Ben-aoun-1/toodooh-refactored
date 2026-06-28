import { parseCampaignUiDate, toLocalDateOnlyString } from '@/features/campaigns/lib/wizard-dates';

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
    requestedBudget: c?.requested_budget ?? null,
    draftCampaignId: c?.id ?? '',
  };
}
