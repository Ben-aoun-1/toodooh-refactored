import { vfNum, vfTnd } from '@/features/agent/lib/agent-format';
import { VF_TYPE_FR, isShAgentCampaign, vfDate } from '@/features/agent/lib/agent-vf';
import type {
  AgentCampaign,
  ShAgentCampaign,
} from '@/features/agent/services/agent-portfolio.service';

import { VfStatusBadge } from './VfCampCard';
import { VfLogo } from './VfFrame';
import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

/**
 * AGENT-VF (spec VF « Fenêtres de détail ») — a campaign's detail, in the window at the centre.
 * Screenhost agent: the campaign, then his Screenhosts that air it. Screencaster agent: the
 * campaign and its impressions only (no Screenhost is named, the calculation is not explained).
 * The foot carries « Revenu acquis » and « À gagner ».
 */
export function VfCampWindow({ campaign: c }: { campaign: AgentCampaign | ShAgentCampaign }) {
  const { closeAll } = useVfOverlay();
  const sh = isShAgentCampaign(c);
  const party = sh ? c.advertiser_name : c.affiliate_name;
  const type = VF_TYPE_FR[c.type];
  return (
    <>
      <div className="bh">
        <VfLogo kind="adv" size={60} />
        <div>
          <h2>{c.name}</h2>
          <p>{party}</p>
          <div className="tags">
            <VfStatusBadge status={c.status} />
            <span className="tag">{type}</span>
            <span className="tag">
              {vfDate(c.start_date)} → {vfDate(c.end_date)}
            </span>
          </div>
        </div>
        <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className={sh ? 'bb' : 'bb one'}>
        <div className="sec">
          <h4>La campagne</h4>
          <div className="kv">
            <div>
              <small>{sh ? 'Annonceur' : 'Screencaster'}</small>
              <b>{party}</b>
            </div>
            <div>
              <small>{sh ? 'Type' : 'Type de campagne'}</small>
              <b>{type}</b>
            </div>
            <div>
              <small>Date de début</small>
              <b>{vfDate(c.start_date)}</b>
            </div>
            <div>
              <small>Date de fin</small>
              <b>{vfDate(c.end_date)}</b>
            </div>
            {!sh && (
              <div className="vf-span-all">
                <small>Impressions générées</small>
                <b>{vfNum(c.impressions)}</b>
              </div>
            )}
          </div>
        </div>
        {sh && (
          <div className="sec">
            <h4>Vos Screenhosts qui la diffusent</h4>
            <div className="list">
              {c.venues.map((v) => (
                <div className="li" key={v.id}>
                  <span className="vf-li-id">
                    <VfLogo kind="shop" size={32} title={v.name} />
                    <span className="nm">
                      <b className="vf-w500">{v.name}</b>
                      <small>Screenhost affilié</small>
                    </span>
                  </span>
                  <b>{vfNum(v.impressions)} impressions</b>
                </div>
              ))}
            </div>
            <div className="banner vf-banner-violet">
              <VfIcon k="rev" size={16} />
              <span>
                Le montant à gagner est ajusté à chaque redispatching, et vous êtes prévenu par
                notification. Le montant final s&apos;ajoute à vos revenus à la clôture, le{' '}
                {vfDate(c.end_date)}.
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="bf">
        <div>
          <small>Revenu acquis</small>
          <b>{vfTnd(c.revenue_tnd)}</b>
        </div>
        <div>
          <small>À gagner</small>
          <b className="vf-green">{vfTnd(c.to_earn_tnd)}</b>
        </div>
      </div>
    </>
  );
}
