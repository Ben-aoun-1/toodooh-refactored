import { estimateImpressions } from '@/features/campaigns/lib/impressions';

// CF-HF3 (Mejri item 3) — the ONE impressions display rule for every ADVERTISER surface (Mes
// campagnes cards/rows, the dashboard, Consulter):
//   « Impressions prévues » = the FROZEN plan's placed facturable (planned_impressions, a pure
//                             read of the plan) when a plan exists, else the budget-derived
//                             estimate ⌊budget×1000/cpm⌋ — never a bare 0 on a funded campaign.
// CF-HF4 (Kais) — the advertiser side is PRÉVUES-ONLY: « Impressions validées » left every cast
// surface (the delivered/reconciled numbers remain a HOST-side read — the owner surfaces are
// untouched). The CPM picks by campaign type (event campaigns price at the event CPM — the
// estimate must not overstate 2×).
// CPM-1 (user rule, 2026-09-17) — the estimate prices at the ROW's own rates (standard_cpm_tnd /
// event_cpm_tnd on the campaign wire). CPM-3: a campaign carries its screencaster's CPM — an admin
// change realigns a draft not yet frozen; every other campaign keeps its copy. The live
// pricing-config is what a campaign created NOW would capture (the caller's own CPM) — only the
// fallback for a row that does not carry its rates (not created yet, not loaded yet).

export const PREVUES_LABEL = 'Impressions prévues';

export interface PricingCpm {
  standard_cpm_tnd?: number | null;
  event_cpm_tnd?: number | null;
}

/** A campaign row as the display rule reads it — its own CPMs ride along (CPM-1). */
export interface ImpressionsSource extends PricingCpm {
  status: string;
  campaign_type?: string;
  planned_impressions?: number | null;
  requested_budget?: number | null;
}

export interface ImpressionsDisplay {
  /** null = not derivable yet (no plan AND no usable budget/CPM) — renders '—'. */
  prevues: number | null;
}

export const cpmForCampaignType = (
  campaignType: string | undefined,
  pricing: PricingCpm | undefined,
): number | null =>
  (campaignType === 'event' ? pricing?.event_cpm_tnd : pricing?.standard_cpm_tnd) ?? null;

/**
 * CPM-1 — the CPM a campaign prices at: its OWN rate for its type (CPM-3: its screencaster's);
 * the live pricing-config only when the row does not carry one (a campaign not created or not
 * loaded yet). null when neither is known — the estimate then renders « — ».
 */
export const campaignCpm = (
  campaignType: string | undefined,
  row: PricingCpm | undefined,
  pricing: PricingCpm | undefined,
): number | null =>
  cpmForCampaignType(campaignType, row) ?? cpmForCampaignType(campaignType, pricing);

export const impressionsDisplay = (
  row: ImpressionsSource,
  pricing: PricingCpm | undefined,
): ImpressionsDisplay => {
  const planned = row.planned_impressions ?? null;
  const prevues =
    planned ??
    (row.requested_budget == null
      ? null
      : estimateImpressions(row.requested_budget, campaignCpm(row.campaign_type, row, pricing)));
  return { prevues };
};

const intFr = new Intl.NumberFormat('fr-FR');

/** '—' for a not-yet-derivable value; a real 0 renders as 0 (a genuine outcome, not absence). */
export const formatImpressions = (value: number | null): string =>
  value === null ? '—' : intFr.format(value);
