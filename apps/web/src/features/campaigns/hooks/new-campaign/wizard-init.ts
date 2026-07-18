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
    // CF-U1 (Mejri item 6) — the budget-null contract: NULL until the advertiser explicitly drags
    // the Validation slider. Seeding the slider default here was the « 5 000 TND » phantom: every
    // per-step Enregistrer persisted a budget nobody chose. An edit-mode record keeps its saved
    // value (possibly null).
    requestedBudget: c?.requested_budget ?? null,
    // CF-Z1 — a resumed campaign keeps its persisted zones (possibly none = whole network); a
    // fresh wizard starts empty and the Zones step defaults it once the zones load.
    zoneIds: (c?.zones ?? []).map((z) => z.zone_id),
    draftCampaignId: c?.id ?? '',
  };
}
