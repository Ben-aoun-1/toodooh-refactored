import { CheckCircle2 } from 'lucide-react';

import { formatTndFr } from '../../lib/performance-derive';

import { BrandMark } from './BrandMark';
import { SectionHeading } from './SectionHeading';
import { Var } from './Var';

interface RevenueSectionProps {
  total: number;
  count: number;
  /** CAST first-data flag — until true, the 'À venir' variant; after, values with 0s. */
  hasCastData: boolean;
}

/**
 * S05 — "Vos revenus de la période": US-P.8 (amendment 2026-08-20) reduces this section to
 * Revenu_période + « N campagne(s) diffusée(s) ». The per-campaign breakdown MOVED OUT — it is
 * US-P.9's « Vos campagnes » table, and showing it twice made the two lists drift apart in the
 * reader's head. The 'À venir' empty state is unchanged.
 */
export function RevenueSection({ total, count, hasCastData }: RevenueSectionProps) {
  const empty = !hasCastData;
  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 05"
        title="Vos revenus de la période"
        lead="Voici le total de vos revenus pour la période analysée."
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
                <Var>{count}</Var> campagne{count > 1 ? 's' : ''} diffusée
                {count > 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {empty && (
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
        )}

        <div className="mt-[18px] flex items-center gap-2 text-[11.5px] text-perf-mist">
          <BrandMark className="h-[11px] w-[11px] flex-shrink-0 opacity-70" />
          Calculé sur les impressions effectivement servies dans votre lieu pendant chaque campagne
        </div>
      </div>
    </section>
  );
}
