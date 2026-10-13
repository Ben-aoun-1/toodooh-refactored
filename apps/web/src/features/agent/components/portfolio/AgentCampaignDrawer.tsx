import { X } from 'lucide-react';

import Drawer from '@/components/Drawer';
import { CAMPAIGN_TYPE_FR, frDate } from '@/features/agent/lib/agent-portfolio';
import type { AgentCampaign } from '@/features/agent/services/agent-portfolio.service';
import { formatImpressions } from '@/features/campaigns/lib/campaign-impressions';
import { tndLabel } from '@/lib/money';

import { CampaignStatusBadge } from './CampaignStatusBadge';

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4 border-b border-gray-100 py-2.5 text-sm">
    <span className="text-gray-500">{label}</span>
    <span className="text-right font-medium text-gray-900">{value}</span>
  </div>
);

/**
 * AGT-4 (spec §5 « Drawer de détail ») — read-only; no Screenhost is ever named (the advertiser
 * itself does not know where it airs).
 */
export function AgentCampaignDrawer({
  campaign,
  onClose,
}: {
  campaign: AgentCampaign | null;
  onClose: () => void;
}) {
  return (
    <Drawer open={campaign !== null} onClose={onClose} width={480}>
      {campaign && (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between border-b px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold">{campaign.name}</h2>
              <p className="text-sm text-gray-500">{campaign.affiliate_name}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Fermer">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="mb-3">
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <Row label="Screencaster" value={campaign.affiliate_name} />
            <Row label="Type de campagne" value={CAMPAIGN_TYPE_FR[campaign.type]} />
            <Row label="Date de début" value={frDate(campaign.start_date)} />
            <Row label="Date de fin" value={frDate(campaign.end_date)} />
            <Row label="Impressions générées" value={formatImpressions(campaign.impressions)} />
            <Row label="Revenu acquis à date" value={tndLabel(campaign.revenue_tnd)} />
            <Row label="Revenu prévisionnel total" value={tndLabel(campaign.forecast_tnd)} />
          </div>
        </div>
      )}
    </Drawer>
  );
}
