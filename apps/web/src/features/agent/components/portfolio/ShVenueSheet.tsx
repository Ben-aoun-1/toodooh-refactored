import { Info, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import Drawer from '@/components/Drawer';
import { useFollowupSheet } from '@/features/agent/hooks/useAgentPortfolio';
import { frDate, rateLabel, scoreLabel } from '@/features/agent/lib/agent-portfolio';
import { AGENT_PATHS } from '@/features/agent/lib/agent-shell';
import { formatImpressions } from '@/features/campaigns/lib/campaign-impressions';
import { tndLabel } from '@/lib/money';

import { AgentAvatar } from './AgentAvatar';

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm">
    <span className="text-gray-500">{label}</span>
    <span className="text-right font-medium text-gray-900">{value}</span>
  </div>
);

const STATUS_FR = {
  en_attente_activation: 'En attente d’activation',
  en_cours: 'En cours',
  terminee: 'Affiliation terminée',
} as const;

const SCORE_TIP =
  'Le score de priorité détermine l’ordre dans lequel les campagnes sont proposées. Il n’entraîne aucune pénalité financière.';

/**
 * AGT-7 (Agent Screenhost spec v1.0 §6 « Fiche Screenhost ») — identity and affiliation;
 * engagement (score and its 90-day curve, the four rates, 30-day counters); the 30-day history
 * (missed plays, offers not accepted — never the advertiser of an offer not accepted).
 */
export function ShVenueSheet({
  screenhostId,
  onClose,
}: {
  screenhostId: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const sheet = useFollowupSheet(screenhostId);
  const d = sheet.data;
  const e = d?.engagement;

  return (
    <Drawer open={screenhostId !== null} onClose={onClose} width={520}>
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div className="flex items-center gap-3">
            {d && <AgentAvatar name={d.venue.name} />}
            <div>
              <h2 className="text-lg font-semibold">{d?.venue.name ?? 'Screenhost'}</h2>
              <p className="text-sm text-gray-500">{d?.venue.category ?? ''}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        {d && (
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
            <section>
              <Row label="Adresse" value={d.venue.address ?? '—'} />
              <Row label="Statut d’affiliation" value={STATUS_FR[d.venue.status]} />
              <Row
                label="Date d’activation"
                value={d.venue.start_date ? frDate(d.venue.start_date) : 'En attente d’activation'}
              />
              <Row label="Fin d’affiliation" value={frDate(d.venue.end_date)} />
              <Row label="Revenus générés" value={tndLabel(d.venue.revenue_tnd)} />
              <Row label="Impressions générées" value={formatImpressions(d.venue.impressions)} />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(`${AGENT_PATHS.campaigns}?screenhost=${d.venue.screenhost_id}`)
                  }
                  className="rounded-lg border px-3 py-1.5 text-sm"
                >
                  Voir ses campagnes
                </button>
                <button
                  type="button"
                  onClick={() => navigate(AGENT_PATHS.calendar)}
                  className="rounded-lg border px-3 py-1.5 text-sm"
                >
                  Voir ses rendez-vous
                </button>
              </div>
            </section>

            {e && (
              <section>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">Engagement</p>
                  <span title={SCORE_TIP} className="text-gray-400">
                    <Info className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold">{scoreLabel(e.sps)}</p>
                <p className="text-xs text-gray-500">Score de priorité</p>
                {e.curve.length > 1 && (
                  <div className="mt-3 h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={e.curve}>
                        <XAxis dataKey="day" hide />
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip
                          formatter={(v) => `${String(v)} / 100`}
                          labelFormatter={(l) => frDate(String(l))}
                        />
                        <Line
                          type="monotone"
                          dataKey="sps"
                          strokeWidth={2}
                          dot={false}
                          className="stroke-brand-primary"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(
                    [
                      ['Acceptation des campagnes', e.rates?.acceptation ?? null],
                      ['Respect des événements', e.rates?.respect_evenements ?? null],
                      ['Activité des écrans', e.rates?.activite ?? null],
                      ['Remplissage', e.rates?.remplissage ?? null],
                    ] as const
                  ).map(([label, v]) => (
                    <div key={label} className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">{label}</p>
                      <p className="font-semibold">{rateLabel(v)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <Row label="Offres reçues (30 j)" value={String(e.offers.received)} />
                  <Row label="Offres acceptées" value={String(e.offers.accepted)} />
                  <Row label="Offres refusées" value={String(e.offers.refused)} />
                  <Row label="Sans réponse sous 24 h" value={String(e.offers.no_answer)} />
                  <Row
                    label="Passages ratés — écran éteint ou hors ligne"
                    value={String(e.missed.ecran)}
                  />
                  <Row
                    label="Passages ratés — événement non diffusé"
                    value={String(e.missed.evenement)}
                  />
                  <Row label="Jours indisponibles déclarés" value={String(e.unavailable_days)} />
                  <Row
                    label="Dernière diffusion"
                    value={e.last_diffusion_at ? frDate(e.last_diffusion_at) : '—'}
                  />
                </div>
                {e.attention.length > 0 && (
                  <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                    {e.attention.map((a) => (
                      <p key={a.key}>• {a.label}</p>
                    ))}
                  </div>
                )}
              </section>
            )}

            {d.history && (
              <section>
                <p className="text-sm font-semibold">Historique des 30 derniers jours</p>
                <p className="mt-2 text-xs font-medium uppercase text-gray-500">Passages ratés</p>
                {d.history.missed.length === 0 ? (
                  <p className="text-sm text-gray-500">Aucun passage raté.</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {d.history.missed.slice(0, 30).map((m) => (
                      <li key={`${m.at}${m.campaign}`} className="flex justify-between py-1.5">
                        <span>
                          {new Date(m.at).toLocaleString('fr-FR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}{' '}
                          — {m.campaign}
                        </span>
                        <span className="text-gray-500">
                          {m.cause === 'ecran' ? 'Écran hors ligne' : 'Événement non diffusé'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs font-medium uppercase text-gray-500">
                  Offres non acceptées
                </p>
                {d.history.unaccepted.length === 0 ? (
                  <p className="text-sm text-gray-500">Aucune offre non acceptée.</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {d.history.unaccepted.map((o) => (
                      <li key={o.at} className="flex justify-between py-1.5">
                        <span>
                          {frDate(o.at)} — {o.type === 'evenement' ? 'Événement' : 'Standard'}
                        </span>
                        <span className="text-gray-500">
                          {o.outcome === 'refusee' ? 'Refusée' : 'Sans réponse'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
