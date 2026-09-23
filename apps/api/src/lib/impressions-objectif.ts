import { deriveICible } from './activation-service.js';
import { campaignCpmRates, cpmForCampaign } from './dispatch/config.js';

// IMP-FACT1 (operator, 2026-09-23) — THE advertiser-facing « Impressions prévues »: the OBJECTIVE
// the screencaster pays for, I_cible = ⌊budget × 1000 ÷ CPM⌋ in BILLABLE impressions, at the
// campaign's own CPM (CPM-3 snapshot; CPM_evt for a positioning). « Estimé et prévu should be the
// same »: it is what the cursor shows at payment and what the campaign is then held to.
//
// Why no plan read: the cart confirm gates budget ≤ C_max, and the dispatch selection caps Σ a_i at
// I_cible — so a deliverable plan bills exactly this number. The typical week decides whether the
// objective is deliverable (C_max, the dry-run in lib/impressions-estimate.ts) and on which venues,
// never the number itself. It never moves after payment (ruling G1 A): a refusal is re-placed by the
// cascade or refunded at settlement; it does not shrink the objective. A boost adds its amount to
// requested_budget, so the objective grows with what was actually paid.
//
// The PHYSICAL figures (« prédites », planned_impressions, the dry-run's impressions) are unchanged
// and still served — they are the real audience, a different question.

export interface ObjectifSource {
  campaignType: string;
  requestedBudget: string | number | null;
  standardCpmTnd: string;
  eventCpmTnd: string;
}

/** The campaign's billable objective, or null when it has no positive budget yet. */
export const impressionsObjectif = (
  campaign: ObjectifSource,
  budgetOverrideTnd?: number,
): number | null => {
  const budget =
    budgetOverrideTnd ??
    (campaign.requestedBudget === null ? null : Number(campaign.requestedBudget));
  if (budget === null || !Number.isFinite(budget)) return null;
  return deriveICible(budget, cpmForCampaign(campaign.campaignType, campaignCpmRates(campaign)));
};

/**
 * An EVENT allocation's billable share, from the money it carries: EV4 writes
 * montant = round(chargeable × CPM_evt) / 1000 (the overshoot past I_cible is free delivery), so
 * chargeable = montant × 1000 ÷ CPM_evt — exact for any CPM ≥ 1 TND (the rounding error, at most
 * 0.5 ÷ CPM, stays under half an impression).
 */
export const eventChargeableImpressions = (montantTnd: number, cpmEvtTnd: number): number =>
  cpmEvtTnd > 0 ? Math.round((montantTnd * 1000) / cpmEvtTnd) : 0;
