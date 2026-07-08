import { CheckCircle2 } from 'lucide-react';

import { formatTndFr } from '../../lib/performance-derive';

import { BrandMark } from './BrandMark';
import { SectionHeading } from './SectionHeading';
import { Var } from './Var';

export interface RevenueRow {
  id: string;
  name: string;
  period: string;
  amountLabel: string;
}

interface RevenueSectionProps {
  total: number;
  count: number;
  rows: RevenueRow[];
}

/** S05 — "Vos revenus de la période": total + per-campaign detail, or the 'À venir' empty state. */
export function RevenueSection({ total, count, rows }: RevenueSectionProps) {
  const empty = count === 0;
  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 05"
        title="Vos revenus de la période"
        lead="Voici le total de vos revenus pour la période analysée, avec le détail des campagnes qui les ont générés."
      />

      <div className="mt-8 rounded-xl border border-perf-line bg-white p-[30px]">
        <div className="mb-[26px] flex flex-wrap items-start justify-between gap-4 border-b border-perf-line pb-[22px]">
          <div className="flex items-center gap-[13px]">
            <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-perf-lavender text-brand-accent">
              <BrandMark className="h-[18px] w-[18px]" />
            </div>
            <div>
              <div className="perf-mono text-[10px] uppercase tracking-[0.08em] text-perf-mist">
                Revenu cumulé
              </div>
              {empty ? (
                <>
                  <div className="mt-1.5 text-[30px] font-semibold leading-tight text-perf-ink">
                    À venir
                  </div>
                  <p className="mt-1 text-xs italic text-perf-mist">
                    Vos premiers gains arrivent dès le lancement des campagnes.
                  </p>
                </>
              ) : (
                <div className="mt-1.5 text-[30px] font-semibold leading-tight text-brand-accent">
                  {formatTndFr(total)}
                  <span className="ml-1 text-[15px] font-normal text-perf-grey">TND</span>
                </div>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="perf-mono text-[10px] uppercase tracking-[0.08em] text-perf-mist">
              Campagnes
            </div>
            {empty ? (
              <div className="mt-1.5 text-lg font-semibold text-perf-ink">
                0 <span className="text-[13px] font-medium text-perf-mist">pour l'instant</span>
              </div>
            ) : (
              <div className="mt-1.5 text-lg font-semibold text-perf-ink">
                <Var>{count}</Var> diffusées
              </div>
            )}
          </div>
        </div>

        {empty ? (
          <div className="flex items-start gap-3 rounded-md border border-perf-line border-l-[3px] border-l-perf-green bg-[#E8F6ED] p-4 px-5 text-[13px] leading-[1.6] text-perf-ink">
            <CheckCircle2
              className="mt-0.5 h-[17px] w-[17px] flex-shrink-0 text-perf-green"
              aria-hidden
            />
            <div>
              <strong className="font-semibold">
                Vos écrans sont prêts à recevoir nos annonceurs.
              </strong>{' '}
              Conservez un score de priorité élevé pour capter les premiers budgets dès leur
              déploiement.
            </div>
          </div>
        ) : (
          <div>
            <div className="perf-mono mb-2.5 flex items-baseline justify-between text-[10px] uppercase tracking-[0.08em] text-perf-mist">
              <span>Détail par campagne</span>
              <span>Votre revenu</span>
            </div>
            <div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-[18px] gap-y-0.5 border-b border-perf-soft py-[13px] last:border-b-0 sm:grid-cols-[1fr_auto_auto]"
                >
                  <div className="min-w-0 truncate text-[13.5px] font-medium text-perf-ink">
                    {row.name}
                  </div>
                  <div className="perf-mono order-3 col-span-2 whitespace-nowrap text-[11px] text-perf-mist sm:order-none sm:col-span-1">
                    {row.period}
                  </div>
                  <div className="perf-mono whitespace-nowrap text-[13.5px] font-semibold text-brand-accent">
                    {row.amountLabel}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-[18px] flex items-center gap-2 text-[11.5px] text-perf-mist">
          <BrandMark className="h-[11px] w-[11px] flex-shrink-0 opacity-70" />
          Calculé sur les impressions effectivement servies dans votre lieu pendant chaque campagne
        </div>
      </div>
    </section>
  );
}
