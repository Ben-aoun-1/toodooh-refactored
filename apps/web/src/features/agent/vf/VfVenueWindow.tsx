import { useNavigate } from 'react-router-dom';

import { useFollowupSheet } from '@/features/agent/hooks/useAgentPortfolio';
import { vfNum, vfPct, vfTnd } from '@/features/agent/lib/agent-format';
import { AGENT_PATHS } from '@/features/agent/lib/agent-shell';
import {
  vfAttentionLabel,
  vfCategoryKey,
  vfDate,
  vfParticipation,
  vfSparkPoints,
  vfVenueSubline,
} from '@/features/agent/lib/agent-vf';
import type { FollowupSheet } from '@/features/agent/services/agent-portfolio.service';

import { VfFrame, VfLogo } from './VfFrame';
import { useVfOverlay } from './VfOverlay';

export function VfTrend({ trend }: { trend: 'up' | 'down' | 'flat' | null }) {
  if (trend === 'up') return <span className="trend up">▲ en hausse</span>;
  if (trend === 'down') return <span className="trend dn">▼ en baisse</span>;
  return <span className="trend nd">● stable</span>;
}

const R = 26;
const C = 2 * Math.PI * R;

function Ring({ value }: { value: number | null }) {
  const offset = value === null ? C : C * (1 - value / 100);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={R} fill="none" stroke="#E6ECE9" strokeWidth="7" />
      <circle
        cx="32"
        cy="32"
        r={R}
        fill="none"
        stroke="#1D9E75"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={C.toFixed(1)}
        strokeDashoffset={offset.toFixed(1)}
        transform="rotate(-90 32 32)"
      />
    </svg>
  );
}

function Spark({ values }: { values: (number | null)[] }) {
  const points = vfSparkPoints(values);
  if (!points) return null;
  return (
    <div className="vf-mt10">
      <svg viewBox="0 0 400 74" width="100%" height="80" preserveAspectRatio="none">
        <defs>
          <linearGradient id="vf-sg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#76E6AB" stopOpacity=".45" />
            <stop offset="1" stopColor="#76E6AB" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,70 ${points} 400,70`} fill="url(#vf-sg)" />
        <polyline
          points={points}
          fill="none"
          stroke="#1D9E75"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <div className="tiny">Évolution sur 90 jours</div>
    </div>
  );
}

/**
 * AGENT-VF (spec VF « Fenêtres de détail », « Mes Screenhosts ») — a Screenhost's fiche in the
 * window at the centre: identity, figures, actions and attention points on the left; engagement
 * (priority score and its trend, the four rates, the last 30 days) on the right.
 */
export function VfVenueWindow({
  screenhostId,
  trend,
}: {
  screenhostId: string;
  trend: 'up' | 'down' | 'flat' | null;
}) {
  const { closeAll } = useVfOverlay();
  const navigate = useNavigate();
  const sheet = useFollowupSheet(screenhostId);
  const data: FollowupSheet | undefined = sheet.data;
  if (!data) {
    return (
      <div className="bh">
        <div>
          <h2>Chargement…</h2>
        </div>
        <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
          ✕
        </button>
      </div>
    );
  }
  const v = data.venue;
  const e = data.engagement;
  const kind = vfCategoryKey(v.category);
  const active = v.status !== 'en_attente_activation';
  const attention = e?.attention.map((a) => a.label) ?? v.attention;
  const sps = e?.sps === null || e?.sps === undefined ? null : Math.round(e.sps);
  const go = (path: string) => {
    closeAll();
    navigate(path);
  };
  const missed = data.history?.missed.length ?? 0;
  const noAnswer = data.history?.unaccepted.filter((u) => u.outcome === 'sans_reponse').length ?? 0;
  const refused = data.history?.unaccepted.filter((u) => u.outcome === 'refusee').length ?? 0;

  return (
    <>
      <div className="bh">
        <VfLogo kind={kind} size={60} title={v.name} attention={attention.length > 0} />
        <div>
          <h2>{v.name}</h2>
          <p>{vfVenueSubline(v)}</p>
          <div className="tags">
            {v.status === 'terminee' ? (
              <span className="badge b-ter">Affiliation terminée</span>
            ) : active ? (
              <span className="badge b-act">Affiliation en cours</span>
            ) : (
              <span className="badge b-wait">En attente d&apos;activation</span>
            )}
            {attention.length > 0 && (
              <span className="badge b-att">{vfAttentionLabel(attention.length)}</span>
            )}
          </div>
        </div>
        <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="bb">
        <div>
          <div className="logoedit">
            <VfFrame name={v.name} kind={kind} attention={attention.length > 0} />
            <div>
              <b className="vf-b13">Logo de l&apos;établissement</b>
              <div className="tiny vf-logo-note">Aucun logo pour le moment.</div>
            </div>
          </div>
          <div className="kv">
            <div>
              <small>Revenus générés</small>
              <b>{vfTnd(v.revenue_tnd)}</b>
            </div>
            <div>
              <small>Impressions générées</small>
              <b>{vfNum(v.impressions)}</b>
            </div>
            {v.start_date && (
              <>
                <div>
                  <small>Date d&apos;activation</small>
                  <b>{vfDate(v.start_date)}</b>
                </div>
                <div>
                  <small>Fin d&apos;affiliation</small>
                  <b>{vfDate(v.end_date)}</b>
                </div>
              </>
            )}
            {v.address && (
              <div className="vf-span-all">
                <small>Adresse</small>
                <b>{v.address}</b>
              </div>
            )}
          </div>
          <div className="vf-fiche-acts">
            <button
              type="button"
              className="btn"
              onClick={() => go(`${AGENT_PATHS.campaigns}?affilie=${v.screenhost_id}`)}
            >
              Voir ses campagnes
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => go(`${AGENT_PATHS.calendar}?avec=${encodeURIComponent(v.name)}`)}
            >
              Voir ses rendez-vous
            </button>
          </div>
          {attention.length > 0 && (
            <div className="sec">
              <h4>Points d&apos;attention</h4>
              <div className="att">
                <ul className="vf-att-list">
                  {attention.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {e && (
            <div className="sec">
              <h4>Sur les 30 derniers jours</h4>
              <div className="list">
                {(
                  [
                    ['Offres reçues', e.offers.received],
                    ['Offres acceptées', e.offers.accepted],
                    ['Offres refusées', e.offers.refused],
                    ['Sans réponse sous 24 h', e.offers.no_answer],
                    ['Passages ratés, écran éteint ou hors ligne', e.missed.ecran],
                    ['Passages ratés, événement non diffusé', e.missed.evenement],
                    ['Jours indisponibles déclarés', e.unavailable_days],
                    ['Dernière diffusion', vfDate(e.last_diffusion_at)],
                  ] as const
                ).map(([label, value]) => (
                  <div className="li" key={label}>
                    <span className="muted">{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div>
          <div className="sec">
            <h4>
              Engagement{' '}
              <span
                className="tiny"
                title="Le score de priorité détermine l'ordre dans lequel les campagnes sont proposées. Il n'entraîne aucune pénalité financière."
              >
                ⓘ
              </span>
            </h4>
            <div className="ring">
              <Ring value={sps} />
              <div>
                <b>
                  {sps === null ? (
                    '–'
                  ) : (
                    <>
                      {sps} <span className="vf-ring-of">/ 100</span>
                    </>
                  )}
                </b>
                <div className="tiny">Score de priorité</div>
                {sps !== null && (
                  <div className="vf-mt4">
                    <VfTrend trend={trend} />
                  </div>
                )}
              </div>
            </div>
            {e && <Spark values={e.curve.map((p) => p.sps)} />}
          </div>
          <div className="kv">
            <div>
              <small>Acceptation des campagnes</small>
              <b>{vfPct(roundOrNull(e?.rates?.acceptation))}</b>
            </div>
            <div>
              <small>Respect des événements</small>
              <b>{vfPct(roundOrNull(e?.rates?.respect_evenements))}</b>
            </div>
            <div>
              <small>Activité des écrans</small>
              <b>{vfPct(roundOrNull(e?.rates?.activite))}</b>
            </div>
            <div>
              <small>Participation</small>
              <b>{vfPct(e?.rates ? vfParticipation(e.unavailable_days) : null)}</b>
            </div>
          </div>
          {sps === null && (
            <p className="tiny vf-mt12">
              Les indicateurs s&apos;affichent dès la première offre reçue par ce Screenhost.
            </p>
          )}
          {e && (
            <div className="sec vf-mt18">
              <h4>Historique des 30 derniers jours</h4>
              <div className="kv">
                <div>
                  <small>Passages ratés</small>
                  <b className="vf-w500">
                    {missed === 0
                      ? 'Aucun passage raté.'
                      : `${missed} passage${missed > 1 ? 's' : ''} raté${missed > 1 ? 's' : ''}`}
                  </b>
                </div>
                <div>
                  <small>Offres non acceptées</small>
                  <b className="vf-w500">
                    {refused + noAnswer === 0
                      ? 'Aucune'
                      : [
                          refused ? `${refused} refusée${refused > 1 ? 's' : ''}` : null,
                          noAnswer ? `${noAnswer} sans réponse` : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                  </b>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const roundOrNull = (v: number | null | undefined): number | null =>
  v === null || v === undefined ? null : Math.round(v);
