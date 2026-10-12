import { type CampaignStatut, formatIntFr } from '../../lib/performance-derive';

import { PendingValue } from './Pending';
import { SectionHeading } from './SectionHeading';
import { Var } from './Var';

export interface CampaignTableRow {
  id: string;
  name: string;
  period: string;
  typeLabel: string;
  statut: CampaignStatut;
  /** US-P.9 — Impressions_affichées (prédites − perdues), via the ONE display home. */
  impressions: number;
  revenueLabel: string;
}

interface CampaignsSectionProps {
  count: number;
  cumulativeImpressions: number;
  top3: string[];
  rows: CampaignTableRow[];
  /** CAST first-data flag — until true, the 'En attente' variants; after, values with 0s. */
  hasCastData: boolean;
}

/** US-P.9 — one presentation home per statut, so the pill can't drift from the rule. */
const STATUT_STYLES: Record<CampaignStatut, { text: string; dot: string }> = {
  'À venir': { text: 'text-brand-deep', dot: 'bg-brand-deep' },
  'En cours': { text: 'text-perf-green', dot: 'bg-perf-green' },
  Passée: { text: 'text-perf-grey', dot: 'bg-perf-mist' },
};

function KpiLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="perf-mono flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] text-perf-mist">
      <span className="h-[5px] w-[5px] rounded-full bg-perf-mist opacity-70" aria-hidden />
      {children}
    </div>
  );
}

/** S06 — "Vos campagnes": KPI trio (count / cumulative impressions / top 3) + the history table. */
export function CampaignsSection({
  count,
  cumulativeImpressions,
  top3,
  rows,
  hasCastData,
}: CampaignsSectionProps) {
  const empty = !hasCastData;
  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 06"
        title="Vos campagnes"
        lead="Synthèse et historique des campagnes diffusées dans votre lieu sur la période analysée."
      />

      <h3 className="mt-8 text-[19px] font-semibold tracking-[-0.01em] text-perf-ink">
        Vos campagnes en chiffres
      </h3>
      <p className="mt-1.5 max-w-[560px] text-[13.5px] text-perf-grey">
        Synthèse des campagnes diffusées dans votre lieu sur la période analysée.
      </p>
      <div className="mt-6 grid grid-cols-1 border-t-2 border-t-perf-green md:grid-cols-3 md:border-b md:border-b-perf-line">
        <div className="border-b border-perf-line py-[22px] md:border-b-0 md:border-r md:border-r-perf-soft md:py-[26px] md:pr-6">
          <KpiLabel>Campagnes diffusées</KpiLabel>
          <div className="mt-4">
            {empty ? (
              <PendingValue />
            ) : (
              <span className="text-[46px] font-semibold leading-none tracking-[-0.03em] text-perf-ink">
                {count}
              </span>
            )}
          </div>
          <p className="mt-2.5 text-[12.5px] leading-[1.45] text-perf-grey">
            Nombre de campagnes ayant tourné dans votre lieu sur la période
          </p>
        </div>
        <div className="border-b border-perf-line py-[22px] md:border-b-0 md:border-r md:border-r-perf-soft md:py-[26px] md:pl-6 md:pr-6">
          <KpiLabel>Impressions cumulées</KpiLabel>
          <div className="mt-4">
            {empty ? (
              <PendingValue />
            ) : (
              <span className="text-[46px] font-semibold leading-none tracking-[-0.03em] text-perf-ink">
                {formatIntFr(cumulativeImpressions)}
              </span>
            )}
          </div>
          <p className="mt-2.5 text-[12.5px] leading-[1.45] text-perf-grey">
            Total des impressions servies sur la période analysée
          </p>
        </div>
        <div className="py-[22px] md:py-[26px] md:pl-6">
          <KpiLabel>Top 3 campagnes</KpiLabel>
          {/* GREEN2 item 8b — rows map over the DATA: no more three literal « Nom de la
              campagne » filler rows at zero campaigns. */}
          <div className="mt-4 flex flex-col gap-3.5">
            {top3.length === 0 ? (
              <p className="text-[12.5px] leading-[1.45] text-perf-mist">
                Aucune campagne sur la période.
              </p>
            ) : (
              top3.map((name, idx) => (
                <div key={`${idx}-${name}`} className="flex items-baseline gap-[11px]">
                  <span
                    className={`w-4 flex-shrink-0 text-base font-semibold ${
                      idx === 0 ? 'text-perf-green' : 'text-perf-mist'
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <span className="truncate text-[13.5px] text-perf-ink">
                    <Var>{name}</Var>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <h3 className="mt-[38px] text-[19px] font-semibold tracking-[-0.01em] text-perf-ink">
        Historique des campagnes
      </h3>
      <p className="mt-1.5 max-w-[560px] text-[13.5px] text-perf-grey">
        Détail campagne par campagne sur la période analysée, avec leurs principaux indicateurs de
        performance.
      </p>
      {empty ? (
        <div className="mt-6 rounded-xl border border-perf-line bg-white px-5 py-[34px] text-center text-[13.5px] italic text-perf-mist">
          En attente du premier deal.
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-perf-line bg-white px-5 py-[34px] text-center text-[13.5px] italic text-perf-mist">
          Aucune campagne sur la période analysée.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <thead>
              <tr>
                {['Campagne', 'Période', 'Type', 'Statut', 'Impressions affichées', 'Revenu'].map(
                  (th, idx, arr) => (
                    <th
                      key={th}
                      className={`perf-mono border-b-2 border-brand-deep pb-3 pr-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-perf-mist ${
                        idx === arr.length - 1 ? 'pr-0 text-right' : ''
                      }`}
                    >
                      {th}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="border-b border-perf-soft py-[13px] pr-3 align-middle text-perf-ink">
                    {row.name}
                  </td>
                  <td className="border-b border-perf-soft py-[13px] pr-3 align-middle text-perf-ink">
                    {row.period}
                  </td>
                  <td className="border-b border-perf-soft py-[13px] pr-3 align-middle text-perf-ink">
                    {row.typeLabel}
                  </td>
                  <td className="border-b border-perf-soft py-[13px] pr-3 align-middle">
                    {/* US-P.9 — three states: « En cours » is the live one (green), « À venir »
                        is scheduled (deep brand), « Passée » is done (grey). */}
                    <span
                      className={`perf-mono inline-flex items-center gap-1.5 text-[11px] ${STATUT_STYLES[row.statut].text}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${STATUT_STYLES[row.statut].dot}`}
                        aria-hidden
                      />
                      {row.statut}
                    </span>
                  </td>
                  <td className="border-b border-perf-soft py-[13px] pr-3 align-middle text-perf-ink">
                    {formatIntFr(row.impressions)}
                  </td>
                  <td className="perf-mono border-b border-perf-soft py-[13px] text-right align-middle font-semibold text-brand-accent">
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
