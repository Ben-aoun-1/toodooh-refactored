import { formatIntFr } from '../../lib/performance-derive';

import { PendingValue } from './Pending';
import { SectionHeading } from './SectionHeading';

export interface CampaignTableRow {
  id: string;
  name: string;
  period: string;
  typeLabel: string;
  statut: 'Active' | 'Passée';
  impressions: number;
  revenueLabel: string;
}

interface CampaignsSectionProps {
  count: number;
  cumulativeImpressions: number;
  top3: string[];
  rows: CampaignTableRow[];
}

/** S06 — "Vos campagnes": KPI trio (count / cumulative impressions / top 3) + the history table. */
export function CampaignsSection({
  count,
  cumulativeImpressions,
  top3,
  rows,
}: CampaignsSectionProps) {
  const empty = count === 0;
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <SectionHeading
        num="Section 06"
        title="Vos campagnes"
        lead="Synthèse et historique des campagnes diffusées dans votre lieu sur la période analysée."
      />

      <h3 className="mt-5 font-semibold text-brand-deep">Vos campagnes en chiffres</h3>
      <p className="text-sm text-gray-500">
        Synthèse des campagnes diffusées dans votre lieu sur la période analysée.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden />
            Campagnes diffusées
          </div>
          <div className="mt-2">
            {empty ? (
              <PendingValue />
            ) : (
              <span className="text-2xl font-bold tabular-nums text-brand-deep">{count}</span>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Nombre de campagnes ayant tourné dans votre lieu sur la période
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden />
            Impressions cumulées
          </div>
          <div className="mt-2">
            {empty ? (
              <PendingValue />
            ) : (
              <span className="text-2xl font-bold tabular-nums text-brand-deep">
                {formatIntFr(cumulativeImpressions)}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Total des impressions servies sur la période analysée
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden />
            Top 3 campagnes
          </div>
          <div className="mt-2 space-y-1.5">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-deep text-[10px] font-bold text-white">
                  {idx + 1}
                </span>
                <span
                  className={`truncate text-sm ${top3[idx] ? 'font-medium text-brand-deep' : 'italic text-gray-400'}`}
                >
                  {top3[idx] ?? 'Nom de la campagne'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h3 className="mt-6 font-semibold text-brand-deep">Historique des campagnes</h3>
      <p className="text-sm text-gray-500">
        Détail campagne par campagne sur la période analysée, avec leurs principaux indicateurs de
        performance.
      </p>
      {empty ? (
        <div className="mt-3 rounded-xl border-2 border-dashed border-gray-200 px-4 py-8 text-center text-sm italic text-gray-400">
          En attente du premier deal.
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wider text-gray-400">
                <th className="py-2 pr-3 font-medium">Campagne</th>
                <th className="py-2 pr-3 font-medium">Période</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Statut</th>
                <th className="py-2 pr-3 font-medium">Impressions</th>
                <th className="py-2 font-medium">Revenu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-2.5 pr-3 font-medium text-brand-deep">{row.name}</td>
                  <td className="py-2.5 pr-3 text-gray-500">{row.period}</td>
                  <td className="py-2.5 pr-3 text-gray-500">{row.typeLabel}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.statut === 'Active'
                          ? 'bg-brand-primary/20 text-brand-deep'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {row.statut}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums text-gray-600">
                    {formatIntFr(row.impressions)}
                  </td>
                  <td className="py-2.5 tabular-nums font-medium text-brand-deep">
                    {row.revenueLabel}
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
