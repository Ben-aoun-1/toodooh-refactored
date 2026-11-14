import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import {
  useAgentAffiliates,
  useAgentCampaigns,
  useAgentFollowup,
  useShAgentAffiliates,
} from '@/features/agent/hooks/useAgentPortfolio';
import { vfNum, vfTnd } from '@/features/agent/lib/agent-format';
import { sortFollowup } from '@/features/agent/lib/agent-portfolio';
import type { AgentKind } from '@/features/agent/lib/agent-shell';
import {
  vfAttentionLabel,
  vfCategoryKey,
  vfDate,
  vfVenueSubline,
} from '@/features/agent/lib/agent-vf';
import type {
  AgentAffiliate,
  ShAffiliate,
} from '@/features/agent/services/agent-portfolio.service';
import {
  type PortfolioView,
  useAgentViewStore,
  viewOf,
} from '@/features/agent/stores/agent-view.store';
import { useAuthStore } from '@/features/auth/stores/auth.store';

import { VfCasterWindow } from './VfCasterWindow';
import { VfEmpty } from './VfEmpty';
import { VfFrame, VfLogo } from './VfFrame';
import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';
import { VfTrend, VfVenueWindow } from './VfVenueWindow';

function Toolbar({
  label,
  view,
  onView,
}: {
  label: string;
  view: PortfolioView;
  onView: (v: PortfolioView) => void;
}) {
  return (
    <div className="toolbar vf-mt0">
      <span className="muted">{label}</span>
      <span className="sp" />
      <div className="vt">
        <button
          type="button"
          aria-label="Vue cartes"
          className={view === 'cards' ? 'on' : undefined}
          onClick={() => onView('cards')}
        >
          <VfIcon k="dash" size={15} />
        </button>
        <button
          type="button"
          aria-label="Vue tableau"
          className={view === 'table' ? 'on' : undefined}
          onClick={() => onView('table')}
        >
          ≡
        </button>
      </div>
    </div>
  );
}

function useView() {
  const userId = useAuthStore((s) => s.user?.id);
  const views = useAgentViewStore((s) => s.views);
  const setView = useAgentViewStore((s) => s.setView);
  return {
    view: viewOf(views, userId, 'affiliates'),
    onView: (v: PortfolioView) => userId && setView(userId, 'affiliates', v),
  };
}

/** Opens the fiche named by `?fiche=<id>` once the list is there (a click on a Dashboard tile). */
function useFicheParam(ready: boolean, open: (id: string) => boolean) {
  const [params, setParams] = useSearchParams();
  const done = useRef(false);
  const id = params.get('fiche');
  useEffect(() => {
    if (!id || !ready || done.current) return;
    done.current = true;
    open(id);
    setParams({}, { replace: true });
  }, [id, ready, open, setParams]);
}

/**
 * AGENT-VF (spec VF « Mes Screenhosts ») — the Screenhosts as logo cards (or a table) on the left,
 * the follow-up panel on the right: attention points first, then increasing priority score, with
 * the score's 30-day trend. A click opens the fiche in the window at the centre.
 */
function ShAffiliates() {
  const { openBig } = useVfOverlay();
  const { view, onView } = useView();
  const affiliates = useShAgentAffiliates();
  const followup = useAgentFollowup();
  const account = useAgentAccount();
  const rows: ShAffiliate[] = affiliates.data?.affiliates ?? [];
  const follow = sortFollowup(followup.data?.rows ?? [], 'default');
  const trendOf = (id: string) => follow.find((f) => f.screenhost_id === id)?.trend ?? null;
  const open = (screenhostId: string) => {
    openBig(<VfVenueWindow screenhostId={screenhostId} trend={trendOf(screenhostId)} />);
    return true;
  };
  useFicheParam(affiliates.isSuccess && followup.isSuccess, open);

  if (affiliates.isSuccess && rows.length === 0) {
    return (
      <div className="card">
        <VfEmpty
          icon="sh"
          text={`Vous n’avez pas encore de Screenhost affilié. Partagez votre code agent${
            account.data?.code ? ` ${account.data.code}` : ''
          } avec les lieux que vous accompagnez lors de leur inscription.`}
        />
      </div>
    );
  }
  const subOf = (id: string) => {
    const a = rows.find((r) => r.screenhost_id === id);
    return a ? vfVenueSubline(a) : 'Screenhost affilié';
  };
  const catOf = (id: string) => rows.find((r) => r.screenhost_id === id)?.category ?? null;

  return (
    <div className="shgrid">
      <div>
        <Toolbar
          label={`${rows.length} Screenhost${rows.length > 1 ? 's' : ''} affilié${rows.length > 1 ? 's' : ''}`}
          view={view}
          onView={onView}
        />
        {view === 'table' ? (
          <div className="card vf-scroll">
            <table>
              <tbody>
                <tr>
                  <th>Screenhost</th>
                  <th>Affiliation</th>
                  <th>Fin</th>
                  <th>Revenus générés</th>
                  <th>Impressions</th>
                </tr>
                {rows.map((s) => (
                  <tr className="cl" key={s.id} onClick={() => open(s.screenhost_id)}>
                    <td>
                      <div className="vf-cell-id">
                        <VfLogo
                          kind={vfCategoryKey(s.category)}
                          size={34}
                          title={s.name}
                          attention={s.attention.length > 0}
                        />
                        <div className="nm">
                          <b>{s.name}</b>
                          <small>{vfVenueSubline(s)}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {s.start_date ? (
                        vfDate(s.start_date)
                      ) : (
                        <span className="badge b-wait">En attente d&apos;activation</span>
                      )}
                    </td>
                    <td>{vfDate(s.end_date)}</td>
                    <td>{vfTnd(s.revenue_tnd)}</td>
                    <td>{vfNum(s.impressions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="shcards">
            {rows.map((s) => (
              <button
                type="button"
                className="shc"
                key={s.id}
                onClick={() => open(s.screenhost_id)}
              >
                <VfFrame
                  name={s.name}
                  kind={vfCategoryKey(s.category)}
                  attention={s.attention.length > 0}
                />
                <div className="nm vf-mt10">
                  <b>{s.name}</b>
                  <small>
                    {vfVenueSubline(s)}
                    {s.start_date ? ` · ${vfDate(s.start_date)} → ${vfDate(s.end_date)}` : ''}
                  </small>
                </div>
                {s.attention.length > 0 && (
                  <div className="vf-mt10">
                    <span className="badge b-att">{vfAttentionLabel(s.attention.length)}</span>
                  </div>
                )}
                <div className="nums">
                  <div>
                    <small>Revenus générés</small>
                    <b>{vfTnd(s.revenue_tnd)}</b>
                  </div>
                  <div>
                    <small>Impressions</small>
                    <b>{vfNum(s.impressions)}</b>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="card vf-sticky">
        <div className="ch">
          <div>
            <h3>Suivi de mes Screenhosts</h3>
            <p>Points d&apos;attention en tête, puis score de priorité croissant</p>
          </div>
        </div>
        <div className="vf-scroll">
          <table>
            <tbody>
              <tr>
                <th>Screenhost</th>
                <th>Score</th>
                <th>Refus</th>
                <th>Passages ratés</th>
                <th />
              </tr>
              {follow.map((f) => (
                <tr className="cl" key={f.screenhost_id} onClick={() => open(f.screenhost_id)}>
                  <td>
                    <div className="vf-cell-id">
                      <VfLogo
                        kind={vfCategoryKey(catOf(f.screenhost_id))}
                        size={32}
                        title={f.name}
                        attention={f.attention.length > 0}
                      />
                      <div className="nm">
                        <b className="vf-w500">{f.name}</b>
                        <small>{subOf(f.screenhost_id)}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {f.sps === null ? (
                      <span className="muted">–</span>
                    ) : (
                      <>
                        <b>{Math.round(f.sps)}</b>
                        <span className="tiny"> / 100</span>
                        <div>
                          <VfTrend trend={f.trend} />
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    {f.refused} <span className="tiny">({f.no_answer})</span>
                  </td>
                  <td>{vfNum(f.missed)}</td>
                  <td>
                    {f.attention.length > 0 && (
                      <span className="pill" title={f.attention.map((a) => a.label).join(', ')}>
                        {f.attention.length}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tiny vf-foot-note">
          Refus : offres refusées, et entre parenthèses offres sans réponse sous 24 h (30 jours).
        </div>
      </div>
    </div>
  );
}

/**
 * AGENT-VF (spec VF « Mes Screencasters ») — the Screencasters as logo cards (campaigns, revenue,
 * impressions) or a table; a click opens the fiche in the window at the centre.
 */
function ScAffiliates() {
  const { openBig } = useVfOverlay();
  const { view, onView } = useView();
  const affiliates = useAgentAffiliates();
  const campaigns = useAgentCampaigns();
  const account = useAgentAccount();
  const rows: AgentAffiliate[] = affiliates.data?.affiliates ?? [];
  const all = campaigns.data?.campaigns ?? [];
  const of = (a: AgentAffiliate) => all.filter((c) => c.affiliate_id === a.user_id);
  const open = (userId: string) => {
    const a = rows.find((r) => r.user_id === userId);
    if (!a) return false;
    openBig(<VfCasterWindow affiliate={a} campaigns={of(a)} />);
    return true;
  };
  useFicheParam(affiliates.isSuccess && campaigns.isSuccess, open);

  if (affiliates.isSuccess && rows.length === 0) {
    return (
      <div className="card">
        <VfEmpty
          icon="sh"
          text={`Vous n’avez pas encore de Screencaster affilié. Partagez votre code agent${
            account.data?.code ? ` ${account.data.code}` : ''
          } pour rattacher vos premiers annonceurs.`}
        />
      </div>
    );
  }
  const sub = (a: AgentAffiliate) =>
    a.status === 'terminee' ? 'Affiliation terminée' : 'Screencaster affilié';

  return (
    <>
      <Toolbar
        label={`${rows.length} Screencaster${rows.length > 1 ? 's' : ''} affilié${rows.length > 1 ? 's' : ''}`}
        view={view}
        onView={onView}
      />
      {view === 'table' ? (
        <div className="card vf-scroll">
          <table>
            <tbody>
              <tr>
                <th>Screencaster</th>
                <th>Date d&apos;affiliation</th>
                <th>Fin d&apos;affiliation</th>
                <th>Campagnes</th>
                <th>Revenus générés</th>
                <th>Impressions générées</th>
              </tr>
              {rows.map((a) => (
                <tr className="cl" key={a.id} onClick={() => open(a.user_id)}>
                  <td>
                    <div className="vf-cell-id">
                      <VfLogo kind="adv" size={34} title={a.name} />
                      <div className="nm">
                        <b>{a.name}</b>
                        <small>{sub(a)}</small>
                      </div>
                    </div>
                  </td>
                  <td>{vfDate(a.start_date)}</td>
                  <td>{vfDate(a.end_date)}</td>
                  <td>{of(a).length}</td>
                  <td>{vfTnd(a.revenue_tnd)}</td>
                  <td>{vfNum(a.impressions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="shcards vf-sc-grid">
          {rows.map((a) => (
            <button type="button" className="shc" key={a.id} onClick={() => open(a.user_id)}>
              <VfFrame name={a.name} kind="adv" />
              <div className="nm vf-mt10">
                <b>{a.name}</b>
                <small>{sub(a)}</small>
              </div>
              <div className="nums vf-nums-3">
                <div>
                  <small>Campagnes</small>
                  <b>{of(a).length}</b>
                </div>
                <div>
                  <small>Revenus générés</small>
                  <b>{vfTnd(a.revenue_tnd)}</b>
                </div>
                <div>
                  <small>Impressions</small>
                  <b>{vfNum(a.impressions)}</b>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function VfAffiliates({ kind }: { kind: AgentKind }) {
  return kind === 'screenhost' ? <ShAffiliates /> : <ScAffiliates />;
}
