import { Info, Wallet } from 'lucide-react';

import { formatTndFr } from '../../lib/performance-derive';

import { SectionHeading } from './SectionHeading';

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
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <SectionHeading
        num="Section 05"
        title="Vos revenus de la période"
        lead="Voici le total de vos revenus pour la période analysée, avec le détail des campagnes qui les ont générés."
      />

      <div className="mt-5 rounded-2xl border border-gray-100 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-primary/15 text-brand-deep">
              <Wallet className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Revenu cumulé
              </div>
              {empty ? (
                <>
                  <div className="text-2xl font-bold text-gray-400">À venir</div>
                  <p className="text-xs text-gray-500">
                    Vos premiers gains arrivent dès le lancement des campagnes.
                  </p>
                </>
              ) : (
                <div className="text-2xl font-bold tabular-nums text-brand-deep">
                  {formatTndFr(total)}{' '}
                  <span className="text-sm font-medium text-gray-400">TND</span>
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-gray-400">
              Campagnes
            </div>
            <div className="text-2xl font-bold tabular-nums text-brand-deep">
              {count}{' '}
              <span className="text-sm font-medium text-gray-400">
                {empty ? "pour l'instant" : 'diffusées'}
              </span>
            </div>
          </div>
        </div>

        {empty ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-brand-primary/40 bg-brand-primary/10 p-3 text-sm text-gray-600">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-deep" aria-hidden />
            <p>
              <strong className="font-semibold text-brand-deep">
                Vos écrans sont prêts à recevoir nos annonceurs.
              </strong>{' '}
              Conservez un score de priorité élevé pour capter les premiers budgets dès leur
              déploiement.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-xs font-medium uppercase tracking-wider text-gray-400">
              <span>Détail par campagne</span>
              <span>Votre revenu</span>
            </div>
            <div className="mt-2 divide-y divide-gray-100">
              {rows.map((row) => (
                <div key={row.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
                  <div className="min-w-0 flex-1 truncate font-medium text-brand-deep">
                    {row.name}
                  </div>
                  <div className="text-xs text-gray-400">{row.period}</div>
                  <div className="font-semibold tabular-nums text-brand-deep">
                    {row.amountLabel}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-1.5 text-xs text-gray-400">
          <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          Calculé sur les impressions effectivement servies dans votre lieu pendant chaque campagne
        </div>
      </div>
    </section>
  );
}
