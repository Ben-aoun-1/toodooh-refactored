import { CAMPAIGN_STATUS_CLASS, CAMPAIGN_STATUS_FR } from '@/features/agent/lib/agent-portfolio';
import type { AgentCampaignStatus } from '@/features/agent/services/agent-portfolio.service';

export function CampaignStatusBadge({ status }: { status: AgentCampaignStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAMPAIGN_STATUS_CLASS[status]}`}
    >
      {CAMPAIGN_STATUS_FR[status]}
    </span>
  );
}
