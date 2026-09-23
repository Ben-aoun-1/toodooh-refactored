import ImpressionsEstimateText from '@/features/campaigns/components/ImpressionsEstimateText';
import { useImpressionsEstimate } from '@/features/campaigns/hooks/useImpressionsEstimate';
import { formatImpressions, plannedPrevues } from '@/features/campaigns/lib/campaign-impressions';
import { isEstimableStatus } from '@/features/campaigns/lib/impressions-estimate';

/** The list-row fields that move a stored campaign's estimate (both advertiser list shapes). */
export interface PrevuesCampaign {
  id: string;
  /** The stored status — only a PRE-DISPATCH one is worth (and costs) a dry-run. */
  status: string;
  planned_impressions: number | null;
  impressions_objectif?: number | null;
  start_date: string | null;
  end_date: string | null;
  requested_budget: number | null;
  selected_categories: readonly string[];
  selected_zones: readonly string[];
  creative_id?: string | null;
}

/**
 * CF-HF3 + IMP-EST1 — « Impressions prévues » as inline content: the frozen plan's figure once
 * dispatched; before that, the dry-run estimate of the stored campaign. The request fires for a
 * plan-less row AND only in a pre-dispatch status — a refused or closed campaign gets « — » + its
 * reason rather than an « as if dispatched now » figure (and costs no server-side pool assembly).
 */
export default function CampaignPrevues({ campaign }: { campaign: PrevuesCampaign }) {
  const planned = plannedPrevues(campaign);
  const estimate = useImpressionsEstimate(campaign.id, {
    enabled: planned === null,
    notEstimable: !isEstimableStatus(campaign.status),
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
