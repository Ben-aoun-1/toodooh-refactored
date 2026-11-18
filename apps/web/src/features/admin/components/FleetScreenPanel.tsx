import { Loader2, Radio, X } from 'lucide-react';

import FleetHealthSection from '@/features/admin/components/FleetHealthSection';
import { useFleetScreen } from '@/features/admin/hooks/useFleet';
import {
  HOUR_TONE_CLASS,
  HOUR_TONE_LABEL,
  STATUS_META,
  type HourTone,
  hourTone,
  sinceLabel,
  statusSentence,
} from '@/features/admin/lib/fleet';

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const LEGEND: readonly HourTone[] = ['ok', 'partial', 'missed', 'future', 'match', 'idle'];

/**
 * FLEET-1 — « Fiche écran »: one screen NOW (what should air), its DAY hour by hour (planned
 * against aired, matches shaded) and its CAMPAIGNS. Refreshed every 30 s.
 */
export default function FleetScreenPanel({
  screenId,
  onClose,
}: {
  screenId: string;
  onClose: () => void;
}) {
  const q = useFleetScreen(screenId);
  const s = q.data;
  const now = s ? new Date(s.computed_at) : new Date();
  const currentHour = Number(
    new Intl.DateTimeFormat('fr-FR', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Africa/Tunis',
    }).format(now),
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fermer la fiche"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <aside className="relative h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-100 p-5">
          {s ? (
            <div>
              <p className="text-xs text-gray-500">{s.venue.zone ?? 'Sans zone'}</p>
              <h2 className="text-lg font-semibold text-gray-900">
                {s.venue.name} · {s.name}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_META[s.status].chip}`}
                >
                  {STATUS_META[s.status].label}
                </span>
                {s.connected && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <Radio className="h-3.5 w-3.5" /> Connecté en direct
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-gray-700">{statusSentence(s, now)}</p>
              <p className="text-xs text-gray-500">
                Dernier signal {sinceLabel(s.last_seen_at, now)}
              </p>
            </div>
          ) : (
            <div className="h-16" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            title="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {q.isLoading || !s ? (
          <div className="flex justify-center p-10 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6 p-5">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Maintenant</h3>
              {s.match_now ? (
                <p className="rounded-lg bg-brand-accent/10 p-3 text-sm text-brand-deep">
                  Match en cours : les campagnes classiques sont en pause sur cet écran.
                </p>
              ) : s.now.campaigns.length === 0 ? (
                <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                  Aucune campagne prévue à cette heure.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {s.now.campaigns.map((c) => (
                    <li key={c.id} className="flex justify-between p-3 text-sm">
                      <span className="font-medium text-gray-900">{c.name}</span>
                      <span className="text-gray-600">{c.reps} passages cette heure</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-900">
                  Aujourd’hui, heure par heure
                </h3>
                <span className="text-xs text-gray-500">
                  {s.today.aired} passés · {s.today.planned_so_far} prévus à cette heure ·{' '}
                  {s.today.planned_total} sur la journée
                </span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {s.hours.map((h) => {
                  const tone = hourTone(h, currentHour);
                  return (
                    <div
                      key={h.hour}
                      className={`rounded-md px-1 py-1.5 text-center text-[11px] leading-tight ${HOUR_TONE_CLASS[tone]} ${h.hour === currentHour ? 'ring-2 ring-brand-deep' : ''}`}
                      title={`${h.hour} h : ${h.aired} passé(s) sur ${h.planned} prévu(s)${h.campaigns.length ? ` · ${h.campaigns.map((c) => c.name).join(', ')}` : ''} · ${HOUR_TONE_LABEL[tone]}`}
                    >
                      <div className="font-semibold">{h.hour}h</div>
                      <div>{h.planned > 0 ? `${h.aired}/${h.planned}` : '·'}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
                {LEGEND.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1">
                    <span className={`inline-block h-3 w-3 rounded ${HOUR_TONE_CLASS[t]}`} />{' '}
                    {HOUR_TONE_LABEL[t]}
                  </span>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Campagnes</h3>
              {s.campaigns.length === 0 ? (
                <p className="text-sm text-gray-500">Aucune campagne aujourd’hui sur cet écran.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="pb-2">Campagne</th>
                      <th className="pb-2">Aujourd’hui</th>
                      <th className="pb-2">Au total</th>
                      <th className="pb-2">Dernier passage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {s.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2">
                          <div className="font-medium text-gray-900">{c.name}</div>
                          <div className="text-xs text-gray-500">
                            {fmtDate(c.start_date)} → {fmtDate(c.end_date)}
                          </div>
                        </td>
                        <td className="py-2">
                          {c.aired_today} / {c.planned_today}
                        </td>
                        <td className="py-2">{c.aired_total}</td>
                        <td className="py-2 text-gray-600">{sinceLabel(c.last_proof_at, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <FleetHealthSection s={s} now={now} />

            <p className="text-xs text-gray-400">Actualisé toutes les 30 secondes.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
