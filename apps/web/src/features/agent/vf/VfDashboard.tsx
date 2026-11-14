import { useNavigate } from 'react-router-dom';

import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import { useAgentNotifications } from '@/features/agent/hooks/useAgentNotifications';
import { useAgentDashboard } from '@/features/agent/hooks/useAgentPortfolio';
import { vfNum, vfTnd } from '@/features/agent/lib/agent-format';
import { sortNotifications } from '@/features/agent/lib/agent-notifications';
import {
  AGENT_BUILT_PAGES,
  AGENT_PATHS,
  type AgentKind,
  onboardingProgress,
  onboardingStepCopy,
} from '@/features/agent/lib/agent-shell';
import { vfCampCard, vfCategoryKey, vfVenueSubline } from '@/features/agent/lib/agent-vf';
import { useAgentAppointments } from '@/features/appointments/hooks/useAppointments';
import { splitAppointments } from '@/features/appointments/lib/appointments';

import { VfCampCard } from './VfCampCard';
import { VfCampWindow } from './VfCampWindow';
import { VfEmpty } from './VfEmpty';
import { VfFrame } from './VfFrame';
import { VfIcon } from './VfIcon';
import { VfNotifItem } from './VfNotifItem';
import { useVfOverlay } from './VfOverlay';
import { VfRdvList } from './VfRdvList';

const COPY: Record<
  AgentKind,
  {
    code: string;
    affiliates: string;
    impressions: string;
    block: string;
    all: string;
    emptyAffiliates: string;
    emptyCampaigns: string;
  }
> = {
  screencaster: {
    code: 'Partagez ce code avec les annonceurs que vous accompagnez lors de leur inscription.',
    affiliates: 'Screencasters affiliés',
    impressions: 'Impressions générées par vos Screencasters affiliés',
    block: 'Mes Screencasters affiliés',
    all: 'Voir tous mes Screencasters affiliés',
    emptyAffiliates:
      'Vous n’avez pas encore de Screencaster affilié. Partagez votre code agent pour rattacher vos premiers annonceurs.',
    emptyCampaigns:
      'Aucune campagne en cours. Les campagnes de vos Screencasters affiliés apparaîtront ici dès leur lancement.',
  },
  screenhost: {
    code: 'Partagez ce code avec les lieux que vous accompagnez lors de leur inscription.',
    affiliates: 'Screenhosts affiliés',
    impressions: 'Impressions générées par vos Screenhosts affiliés',
    block: 'Mes Screenhosts affiliés',
    all: 'Voir mes Screenhosts',
    emptyAffiliates:
      'Vous n’avez pas encore de Screenhost affilié. Partagez votre code agent avec les lieux que vous accompagnez lors de leur inscription.',
    emptyCampaigns:
      'Aucune campagne en cours. Les campagnes acceptées par vos Screenhosts affiliés apparaîtront ici.',
  },
};

/**
 * AGENT-VF — the Dashboard as the prototype composes it: « Finalisez votre compte », the Revenu
 * actuel and Code agent heroes, four figures, the affiliates' logo tiles, the live campaigns, the
 * next rendez-vous and the notifications. Every figure comes from the api.
 */
export function VfDashboard({ kind }: { kind: AgentKind }) {
  const copy = COPY[kind];
  const navigate = useNavigate();
  const { openBig, toast } = useVfOverlay();
  const dash = useAgentDashboard();
  const d = dash.data;
  const appointments = useAgentAppointments();
  const upcoming = splitAppointments(appointments.data?.appointments ?? []).upcoming.slice(0, 3);
  const notifications = sortNotifications(useAgentNotifications().data ?? []);
  const sh = kind === 'screenhost';

  const copyCode = () => {
    if (!d?.code) return;
    void navigator.clipboard?.writeText(d.code).catch(() => undefined);
    toast('Code agent copié');
  };

  return (
    <>
      <Onboarding />
      <div className="hero2">
        <button
          type="button"
          className="rev"
          onClick={() => {
            if (AGENT_BUILT_PAGES.has('revenues')) navigate(AGENT_PATHS.revenues);
          }}
        >
          <small>
            <VfIcon k="rev" size={16} />
            Revenu actuel
          </small>
          <b>
            {vfTnd(d?.wallet.balance_tnd ?? 0).replace(' TND', '')} <em>TND</em>
          </b>
          <span className="go">Voir mes revenus →</span>
        </button>
        <div className="code">
          <small>
            <VfIcon k="key" size={16} />
            Code agent
          </small>
          <b>
            {d?.code ?? '–'}{' '}
            <button type="button" className="cp" onClick={copyCode}>
              <VfIcon k="copy" size={13} /> Copier
            </button>
          </b>
          <p>{copy.code}</p>
        </div>
      </div>

      <div className="grid4 mb">
        <div className="kpi">
          <span className="ic vf-mint">
            <VfIcon k="rev" />
          </span>
          <small>Revenus cumulés</small>
          <b>{vfTnd(d?.wallet.cumulative_tnd ?? 0)}</b>
        </div>
        <div className="kpi">
          <span className="ic vf-mint">
            <VfIcon k="sh" />
          </span>
          <small>{copy.affiliates}</small>
          <b>{vfNum(d?.affiliates_active ?? 0)}</b>
        </div>
        <div className="kpi">
          <span className="ic vf-violet">
            <VfIcon k="eye" />
          </span>
          <small>{copy.impressions}</small>
          <b>{vfNum(d?.impressions_total ?? 0)}</b>
        </div>
        <div className="kpi">
          <span className="ic vf-violet">
            <VfIcon k="trophy" />
          </span>
          <small>Classement de performance Agent</small>
          <b>{d?.rank ? `${d.rank}${d.rank === 1 ? 'er' : 'e'}` : '–'}</b>
        </div>
      </div>

      <div className="card mb">
        <div className="ch">
          <h3>{copy.block}</h3>
          <button type="button" className="link" onClick={() => navigate(AGENT_PATHS.affiliates)}>
            {copy.all}
          </button>
        </div>
        <div className="cb">
          {(d?.recent_affiliates.length ?? 0) === 0 ? (
            <VfEmpty icon="sh" text={copy.emptyAffiliates} />
          ) : (
            <div className="logogrid">
              {d?.recent_affiliates.map((a) => (
                <button
                  type="button"
                  className="lcard"
                  key={a.id}
                  onClick={() => navigate(`${AGENT_PATHS.affiliates}?fiche=${a.id}`)}
                >
                  <VfFrame
                    name={a.name}
                    kind={sh ? vfCategoryKey(a.category) : 'adv'}
                    attention={a.attention > 0}
                  />
                  <b>{a.name}</b>
                  <small>
                    {sh
                      ? vfVenueSubline(a)
                      : a.status === 'terminee'
                        ? 'Affiliation terminée'
                        : 'Screencaster affilié'}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card mb">
        <div className="ch">
          <h3>Mes campagnes affiliées en cours</h3>
          <button type="button" className="link" onClick={() => navigate(AGENT_PATHS.campaigns)}>
            Voir mes campagnes
          </button>
        </div>
        <div className="cb">
          {(d?.current_campaigns.length ?? 0) === 0 ? (
            <VfEmpty icon="camp" text={copy.emptyCampaigns} />
          ) : (
            <div className="camps">
              {d?.current_campaigns.slice(0, 3).map((c) => (
                <VfCampCard
                  key={c.id}
                  campaign={vfCampCard(c)}
                  onOpen={() => openBig(<VfCampWindow campaign={c} />)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card mb">
        <div className="ch">
          <h3>Mes rendez-vous</h3>
          <button type="button" className="link" onClick={() => navigate(AGENT_PATHS.calendar)}>
            Accéder au calendrier
          </button>
        </div>
        {upcoming.length === 0 ? (
          <VfEmpty icon="cal" text="Aucun rendez-vous à venir." />
        ) : (
          <VfRdvList rows={upcoming} />
        )}
      </div>

      <div className="card">
        <div className="ch">
          <div>
            <h3>Notifications</h3>
          </div>
        </div>
        <div>
          {notifications.length === 0 ? (
            <VfEmpty icon="bell" text="Aucune notification pour le moment." />
          ) : (
            notifications.slice(0, 5).map((n) => <VfNotifItem key={n.id} notification={n} />)
          )}
        </div>
      </div>
    </>
  );
}

/** « Finalisez votre compte »: shown until every mandatory step is done; each button opens its tab. */
function Onboarding() {
  const account = useAgentAccount();
  const navigate = useNavigate();
  const o = account.data?.onboarding;
  // The Dashboard's composition hangs on this card being the first child: once the onboarding is
  // complete it stays in the tree, unseen, so that the same layout holds.
  if (!o || o.complete) return <div className="card onb vf-gone" aria-hidden="true" />;
  const tenths = Math.round((o.done / o.steps.length) * 10);
  return (
    <div className="card onb mb">
      <div className="cb">
        <div className="vf-onb-head">
          <h3>Finalisez votre compte</h3>
          <span className="muted">{onboardingProgress(o.done, o.steps.length)}</span>
        </div>
        <div className="bar">
          <i className={`vf-w-${tenths}`} />
        </div>
        <div className="steps">
          {o.steps.map((step) => {
            const c = onboardingStepCopy(step);
            return (
              <div className={`step${step.done ? ' done' : ''}`} key={step.key}>
                <span className="ck">{step.done ? '✓' : ''}</span>
                <div>
                  <b>{c.label}</b>
                  <small>{c.status}</small>
                </div>
                {!step.done && c.tab && step.key !== 'cge' && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => navigate(`${AGENT_PATHS.settings}?tab=${c.tab}`)}
                  >
                    {step.pending ? 'Voir' : 'Compléter'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
