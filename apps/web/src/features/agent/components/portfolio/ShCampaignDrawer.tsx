import { X } from 'lucide-react';

import Drawer from '@/components/Drawer';
import { CAMPAIGN_TYPE_FR, frDate } from '@/features/agent/lib/agent-portfolio';
import type { ShAgentCampaign } from '@/features/agent/services/agent-portfolio.service';
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
 * AGT-7 (Agent Screenhost spec v1.0 §5 « Drawer de détail ») — the affiliated venues airing the
 * campaign with their impressions; no venue outside the portfolio, no budget, no campaign total.
 */
export function ShCampaignDrawer({
  campaign,
  onClose,
}: {
  campaign: ShAgentCampaign | null;
  onClose: () => void;
}) {
  return (
    <Drawer open={campaign !== null} onClose={onClose} width={480}>
      {campaign && (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between border-b px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold">{campaign.name}</h2>
              <p className="text-sm text-gray-500">{campaign.advertiser_name}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Fermer">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="mb-3">
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <Row label="Annonceur" value={campaign.advertiser_name} />
            <Row label="Type de campagne" value={CAMPAIGN_TYPE_FR[campaign.type]} />
            <Row label="Date de début" value={frDate(campaign.start_date)} />
            <Row label="Date de fin" value={frDate(campaign.end_date)} />
            <p className="mt-5 text-sm font-semibold">Vos Screenhosts qui la diffusent</p>
            <ul className="mt-2 divide-y rounded-lg border">
              {campaign.venues.map((v) => (
                <li key={v.id} className="flex justify-between px-3 py-2 text-sm">
                  <span>{v.name}</span>
                  <span className="font-medium">
                    {formatImpressions(v.impressions)} impressions
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t px-6 py-4">
            <Row label="Revenu acquis à date" value={tndLabel(campaign.revenue_tnd)} />
            <Row label="Revenu prévisionnel total" value={tndLabel(campaign.forecast_tnd)} />
          </div>
        </div>
      )}
    </Drawer>
  );
}
