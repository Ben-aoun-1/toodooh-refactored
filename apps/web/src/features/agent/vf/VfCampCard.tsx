import { vfNum, vfTnd } from '@/features/agent/lib/agent-format';
import { VF_STATUS_BADGE, type VfCampCard as Model } from '@/features/agent/lib/agent-vf';
import type { AgentCampaignStatus } from '@/features/agent/services/agent-portfolio.service';

import { VfFrame } from './VfFrame';
import { VfIcon } from './VfIcon';

export function VfStatusBadge({ status }: { status: AgentCampaignStatus }) {
  const b = VF_STATUS_BADGE[status];
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}

/** AGENT-VF — a campaign card: name, party, status, dates, À gagner / Revenu, impressions, logo frame. */
export function VfCampCard({
  campaign: c,
  logoUrl,
  onOpen,
}: {
  campaign: Model;
  logoUrl?: string | null;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="camp" onClick={onOpen}>
      <div className="h">
        <div className="nm">
          <b>{c.name}</b>
          <small>{c.party}</small>
        </div>
        <VfStatusBadge status={c.status} />
      </div>
      <div className="dates">
        <VfIcon k="cal" size={14} />
        {c.dates}
      </div>
      <div className="nums">
        <div>
          <small>{c.moneyLabel}</small>
          <b className="gain">{vfTnd(c.moneyTnd)}</b>
        </div>
        <div>
          <small>Impressions</small>
          <b>{vfNum(c.impressions)}</b>
        </div>
      </div>
      <VfFrame name={c.party} kind="adv" logoUrl={logoUrl} advertiser />
    </button>
  );
}
