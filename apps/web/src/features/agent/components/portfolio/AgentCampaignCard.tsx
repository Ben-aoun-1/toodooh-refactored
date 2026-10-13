import { type CampaignCardModel, frDate } from '@/features/agent/lib/agent-portfolio';
import { formatImpressions } from '@/features/campaigns/lib/campaign-impressions';
import { tndLabel } from '@/lib/money';

import { AgentAvatar } from './AgentAvatar';
import { CampaignStatusBadge } from './CampaignStatusBadge';

/**
 * AGT-4 / AGT-7 — the campaign card shared by the Dashboard and « Mes campagnes » of both agent
 * types (spec §4 bloc 8): the avatar is the Screencaster (or, for a Screenhost agent, the
 * advertiser), the subtitle names it — and the venues touched for a Screenhost agent.
 */
export function AgentCampaignCard({
  campaign,
  onOpen,
}: {
  campaign: CampaignCardModel;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-3 rounded-xl border border-[#E1E4EA] bg-white p-4 text-left shadow-sm hover:border-brand-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar name={campaign.avatar_name} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-gray-900">{campaign.name}</p>
            <p className="truncate text-xs text-gray-500">{campaign.subtitle}</p>
          </div>
        </div>
        <CampaignStatusBadge status={campaign.status} />
      </div>
      <p className="text-xs text-gray-500">
        Du {frDate(campaign.start_date)} au {frDate(campaign.end_date)}
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-xs text-gray-500">Revenu</p>
          <p className="font-semibold">{tndLabel(campaign.revenue_tnd)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Impressions</p>
          <p className="font-semibold">{formatImpressions(campaign.impressions)}</p>
        </div>
      </div>
    </button>
  );
}
