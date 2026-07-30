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

export const PREVUES_LABEL = 'Impressions prévues';

export interface ImpressionsSource {
  status: string;
  campaign_type?: string;
  planned_impressions?: number | null;
  requested_budget?: number | null;
}

export interface PricingCpm {
  standard_cpm_tnd?: number | null;
  event_cpm_tnd?: number | null;
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

export const impressionsDisplay = (
  row: ImpressionsSource,
  pricing: PricingCpm | undefined,
): ImpressionsDisplay => {
  const planned = row.planned_impressions ?? null;
  const prevues =
    planned ??
    (row.requested_budget == null
      ? null
      : estimateImpressions(row.requested_budget, cpmForCampaignType(row.campaign_type, pricing)));
  return { prevues };
};

const intFr = new Intl.NumberFormat('fr-FR');

/** '—' for a not-yet-derivable value; a real 0 renders as 0 (a genuine outcome, not absence). */
export const formatImpressions = (value: number | null): string =>
  value === null ? '—' : intFr.format(value);
