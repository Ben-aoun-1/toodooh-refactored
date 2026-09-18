import { configNumber, fmtTnd } from '@/features/admin/lib/testing-labels';
import type { TestingReport } from '@/features/admin/services/admin-testing.service';

// ADM-OBS2 items 10–11 — the campaigns on this venue, every column with its unit and a line that
// says what it counts. Ruling C: the value of the missed slots AND the host's own share of it.

const LEGEND: [string, string][] = [
  [
    'Créneau',
    'une heure (date, heure) où la campagne est programmée sur cet établissement. Les colonnes de créneaux comptent des heures.',
  ],
  [
    'Écoulés / diffusés / manqués',
    'écoulés = créneaux dont l’heure est passée ; diffusés = écoulés avec au moins une preuve de diffusion (fin de vidéo reçue) ; manqués = écoulés sans preuve.',
  ],
  [
    'Impressions physiques / facturables',
    'physiques = personnes exposées prévues (affluence × répétitions) ; facturables = physiques × T, l’indice d’attention selon la durée du spot.',
  ],
  [
    'Valeur non diffusée',
    'impressions facturables manquées × CPM / 1000 (règle du 12/09) : la valeur totale des créneaux non joués, redirigée vers les établissements du redispatch.',
  ],
  [
    'Manque à gagner du host',
    'la part de cette valeur qui serait revenue à cet établissement, arrondie au millime inférieur comme au règlement.',
  ],
  [
    'Redirigé vers',
    'les établissements qui ont reçu ces impressions lors d’un redispatch (+ impressions facturables).',
  ],
];

export function CampaignsOnVenueSection({ r }: { r: TestingReport }) {
  const pctSh = configNumber(r.config, 'pctSh');
  const shareHeader = `manque à gagner du host${pctSh === null ? '' : `, ${pctSh} %`} (TND)`;
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        Campagnes sur cet établissement — diffusée en entier / perturbée / reçue en redispatch /
        argent perdu
      </h2>
      <dl className="mb-3 grid gap-x-4 gap-y-1 text-xs text-gray-500 md:grid-cols-[max-content_1fr]">
        {LEGEND.map(([term, definition]) => (
          <div key={term} className="contents">
            <dt className="font-medium text-gray-600">{term}</dt>
            <dd>{definition}</dd>
          </div>
        ))}
      </dl>
      {r.campaigns.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune campagne avec des créneaux sur la période.</p>
      ) : (
        <div className="overflow-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pr-4">campagne</th>
                <th className="pr-4">statut</th>
                <th className="pr-4">acceptation</th>
                <th className="pr-4">créneaux période (h)</th>
                <th className="pr-4">écoulés (h)</th>
                <th className="pr-4">diffusés (h)</th>
                <th className="pr-4">manqués (h)</th>
                <th className="pr-4">impr. manquées — phys. / fact. (pers.)</th>
                <th className="pr-4">verdict</th>
                <th className="pr-4">valeur non diffusée (TND)</th>
                <th className="pr-4">{shareHeader}</th>
                <th className="pr-4">redirigé vers (impr. fact.)</th>
              </tr>
            </thead>
            <tbody>
              {r.campaigns.map((c) => (
                <tr key={c.campaign_id} className="border-t">
                  <td className="py-0.5 pr-4">{c.campaign_name}</td>
                  <td className="py-0.5 pr-4">{c.campaign_status}</td>
                  <td className="py-0.5 pr-4">{c.statut_acceptation}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{c.slots_in_period}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{c.slots_elapsed}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{c.slots_delivered}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{c.slots_missed}</td>
                  <td className="py-0.5 pr-4 tabular-nums">
                    {c.impressions_missed_physical} / {c.impressions_missed_fact}
                  </td>
                  <td className="py-0.5 pr-4">
                    {c.ran_fully ? 'diffusée en entier' : c.disrupted ? 'perturbée' : 'à venir'}
                    {c.received_redispatch ? ' · reçue en redispatch' : ''}
                  </td>
                  <td className="py-0.5 pr-4 tabular-nums">{fmtTnd(c.missed_value_tnd)}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{fmtTnd(c.host_share_lost_tnd)}</td>
                  <td className="py-0.5 pr-4 font-mono text-xs">
                    {c.redirected_to.length === 0
                      ? '—'
                      : c.redirected_to
                          .map((t) => `${t.screenhost_id.slice(0, 8)} (+${t.added_fact})`)
                          .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
