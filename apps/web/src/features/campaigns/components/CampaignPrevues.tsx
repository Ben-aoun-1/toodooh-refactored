import ImpressionsEstimateText from '@/features/campaigns/components/ImpressionsEstimateText';
import { useImpressionsEstimate } from '@/features/campaigns/hooks/useImpressionsEstimate';
import { formatImpressions, plannedPrevues } from '@/features/campaigns/lib/campaign-impressions';

/** The list-row fields that move a stored campaign's estimate (both advertiser list shapes). */
export interface PrevuesCampaign {
  id: string;
  planned_impressions: number | null;
  start_date: string | null;
  end_date: string | null;
  requested_budget: number | null;
  selected_categories: readonly string[];
  selected_zones: readonly string[];
  creative_id?: string | null;
}

/**
 * CF-HF3 + IMP-EST1 — « Impressions prévues » as inline content: the frozen plan's figure once
 * dispatched; before that, the dry-run estimate of the stored campaign (the request only fires
 * for a plan-less row).
 */
export default function CampaignPrevues({ campaign }: { campaign: PrevuesCampaign }) {
  const planned = plannedPrevues(campaign);
  const estimate = useImpressionsEstimate(campaign.id, {
    enabled: planned === null,
    inputs: {
      startDate: campaign.start_date,
      endDate: campaign.end_date,
      targeting: campaign.selected_categories,
      zones: campaign.selected_zones,
      creativeId: campaign.creative_id ?? null,
      storedBudget: campaign.requested_budget,
    },
  });
  if (planned !== null) return <>{formatImpressions(planned)}</>;
  return <ImpressionsEstimateText view={estimate} />;
}
