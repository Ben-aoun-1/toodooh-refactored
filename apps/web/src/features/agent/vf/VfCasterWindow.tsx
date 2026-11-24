import { useNavigate } from 'react-router-dom';

import { vfNum, vfTnd } from '@/features/agent/lib/agent-format';
import { AGENT_PATHS } from '@/features/agent/lib/agent-shell';
import { vfDate } from '@/features/agent/lib/agent-vf';
import type {
  AgentAffiliate,
  AgentCampaign,
} from '@/features/agent/services/agent-portfolio.service';

import { useAgentLogos } from '../hooks/useAgentLogos';

import { VfStatusBadge } from './VfCampCard';
import { VfCampWindow } from './VfCampWindow';
import { VfLogo } from './VfFrame';
import { VfLogoEditor } from './VfLogoEditor';
import { useVfOverlay } from './VfOverlay';
import { VfRdvModal } from './VfRdvModal';

/**
 * AGENT-VF (spec VF « Mes Screencasters ») — a Screencaster's fiche in the window at the centre:
 * logo, figures and affiliation dates on the left with « Voir ses campagnes » / « Voir ses
 * rendez-vous »; his campaigns on the right, each opening its own detail.
 */
export function VfCasterWindow({
  affiliate: a,
  campaigns,
}: {
  affiliate: AgentAffiliate;
  campaigns: AgentCampaign[];
}) {
  const { closeAll, openBig, openModal } = useVfOverlay();
  const logos = useAgentLogos();
  const navigate = useNavigate();
  const go = (path: string) => {
    closeAll();
    navigate(path);
  };
  return (
    <>
      <div className="bh">
        <VfLogo kind="adv" size={60} title={a.name} logoUrl={logos.of(a.user_id)?.url} />
        <div>
          <h2>{a.name}</h2>
          <p>Screencaster affilié</p>
          <div className="tags">
            {a.status === 'terminee' ? (
              <span className="badge b-ter">Affiliation terminée</span>
            ) : (
              <span className="badge b-act">Affiliation en cours</span>
            )}
          </div>
        </div>
        <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="bb">
        <div>
          <VfLogoEditor subjectId={a.user_id} name={a.name} kind="adv" />
          <div className="kv">
            <div>
              <small>Revenus générés</small>
              <b>{vfTnd(a.revenue_tnd)}</b>
            </div>
            <div>
              <small>Impressions générées</small>
              <b>{vfNum(a.impressions)}</b>
            </div>
            <div>
              <small>Date d&apos;affiliation</small>
              <b>{vfDate(a.start_date)}</b>
            </div>
            <div>
              <small>Fin d&apos;affiliation</small>
              <b>{vfDate(a.end_date)}</b>
            </div>
          </div>
          <div className="vf-fiche-acts vf-fiche-acts-sc">
            <button
              type="button"
              className="btn"
              onClick={() => go(`${AGENT_PATHS.campaigns}?affilie=${a.user_id}`)}
            >
              Voir ses campagnes
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => go(`${AGENT_PATHS.calendar}?avec=${encodeURIComponent(a.name)}`)}
            >
              Voir ses rendez-vous
            </button>
            <button
              type="button"
              className="btn pri"
              onClick={() => openModal(<VfRdvModal presetId={a.user_id} />)}
            >
              Prendre un rendez-vous
            </button>
          </div>
        </div>
        <div>
          <div className="sec">
            <h4>Ses campagnes ({campaigns.length})</h4>
            <div className="list">
              {campaigns.map((c) => (
                <button
                  type="button"
                  className="li vf-li-btn"
                  key={c.id}
                  onClick={() => openBig(<VfCampWindow campaign={c} />)}
                >
                  <span className="nm vf-pr10">
                    <b className="vf-w500">{c.name}</b>
                    <small>
                      {vfDate(c.start_date)} → {vfDate(c.end_date)}
                    </small>
                  </span>
                  <VfStatusBadge status={c.status} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
