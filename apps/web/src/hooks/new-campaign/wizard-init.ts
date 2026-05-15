import type { SpecialEvent } from '../../features/events/types/event';
import { parseCampaignUiDate, toLocalDateOnlyString } from '../../lib/wizard-dates';

import type { WizardState } from './wizard-types';

/**
 * Loose shape for `location.state.campaign` in edit mode. The router payload
 * is untyped today (TODO #15 — phase-1 typed campaign records); fields are
 * widened to optional unknowns and narrowed at use site.
 */
export interface CampaignEditRecord {
  id?: string;
  name?: string;
  client?: string;
  category?: string;
  startDate?: string;
  start_date?: string;
  endDate?: string;
  end_date?: string;
  event_id?: string;
}

export interface BuildInitialWizardStateArgs {
  campaignType: 'standard' | 'event';
  campaignToEdit: CampaignEditRecord | null;
  eventFromState: SpecialEvent | undefined;
}

/**
 * Construct the initial WizardState from edit-mode / event / fresh inputs.
 * Mirrors the inline useState initializers at NewCampaign.tsx:185–224 prior
 * to the Commit 6 adoption.
 */
export function buildInitialWizardState(args: BuildInitialWizardStateArgs): WizardState {
  const { campaignType, campaignToEdit, eventFromState } = args;

  const startDateRaw = parseCampaignUiDate(
    campaignToEdit?.startDate ?? campaignToEdit?.start_date,
  ) ?? parseCampaignUiDate(eventFromState?.start_date);
  const endDateRaw = parseCampaignUiDate(
    campaignToEdit?.endDate ?? campaignToEdit?.end_date,
  ) ?? parseCampaignUiDate(eventFromState?.end_date);

  return {
    campaignType,
    campaignName: campaignToEdit?.name || eventFromState?.name || '',
    client: campaignToEdit?.client || '',
    categories: campaignToEdit?.category ? [campaignToEdit.category] : [],
    diffusionType: 'toodooh',
    selectedParcIds: [],
    startDate: startDateRaw ? toLocalDateOnlyString(startDateRaw) : null,
    endDate: endDateRaw ? toLocalDateOnlyString(endDateRaw) : null,
    geographicZones: [],
    adjustedBudget: 0,
    calculatedImpressions: 0,
    customMinBudget: null,
    customMaxBudget: null,
    uploadedVideoId: '',
    uploadedVideoUrl: '',
    existingVideoId: null,
    draftCampaignId: campaignToEdit?.id ?? '',
  };
}
