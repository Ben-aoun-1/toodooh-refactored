import { Download, Eye, FileText, Loader2 } from 'lucide-react';

import { formatIntFr } from '../../lib/performance-derive';
import { firstOfFollowingMonth, monthLabelFr } from '../../lib/performance-period';

import { PENDING_LABEL } from './Pending';

interface MonthlyReportCardProps {
  /** The latest hub-pushed month for the venue, or null (EMPTY variant). */
  latestMonth: { month: string; total_audience: number } | null;
  /** Σ delivered impressions of that month (from the impressions-daily read). */
  monthImpressions: number;
  /** Count of campaigns whose end falls in that month. */
  campaignsCount: number;
  onConsult: () => void;
  onDownload: () => void;
  downloading: boolean;
}

/** §3 — "Votre rendez-vous mensuel": the latest monthly report + its three tiles. */
export function MonthlyReportCard({
  latestMonth,
  monthImpressions,
  campaignsCount,
  onConsult,
  onDownload,
  downloading,
}: MonthlyReportCardProps) {
  const hasMonth = latestMonth !== null;
  const stats: { label: string; value: string | null }[] = [
    { label: 'Impressions générées', value: hasMonth ? formatIntFr(monthImpressions) : null },
    {
      label: 'Personnes atteintes',
      value: hasMonth ? formatIntFr(latestMonth.total_audience) : null,
    },
    { label: 'Campagnes diffusées', value: hasMonth ? formatIntFr(campaignsCount) : null },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl bg-brand-deep p-6 text-white sm:p-8">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-primary/20 blur-2xl"
        aria-hidden
      />
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-brand-primary">
        <FileText className="h-4 w-4" aria-hidden />
        Rapports mensuels
      </div>
      {/* text-white must be EXPLICIT — a global heading rule would otherwise repaint it dark. */}
      <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
        Votre rendez-vous <em className="not-italic text-brand-primary">mensuel</em>
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-white/80">
        Chaque mois, votre rapport d'audience est généré automatiquement et vous êtes notifié.
        Consultez le dernier et retrouvez tout l'historique, à télécharger à tout moment.
      </p>

      <div className="mt-6 rounded-2xl bg-white/10 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand-primary px-2.5 py-0.5 text-xs font-bold text-brand-deep">
            Nouveau
          </span>
          <span className="text-xs text-white/70">
            Généré automatiquement le{' '}
            <span className="font-semibold text-white">
              {hasMonth ? firstOfFollowingMonth(latestMonth.month) : '—'}
            </span>
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/60">
              Dernier rapport mensuel
            </div>
            <div className="mt-1 text-xl font-semibold">
              {hasMonth ? monthLabelFr(latestMonth.month) : '—'}
            </div>
            <p className="mt-1 max-w-md text-sm text-white/75">
              Votre synthèse d'audience du mois : impressions générées, personnes touchées et profil
              de votre clientèle.
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={onConsult}
              disabled={!hasMonth}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/40 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Eye className="h-4 w-4" aria-hidden />
              Consulter
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={!hasMonth || downloading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              Télécharger
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl bg-white/10 p-3">
              <div className="text-xs text-white/60">{stat.label}</div>
              {stat.value !== null ? (
                <div className="mt-1 text-2xl font-bold tabular-nums">
                  {stat.value}
                  {stat.label === 'Personnes atteintes' && (
                    <span className="ml-1 text-sm font-medium text-white/60">pers.</span>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-sm font-medium italic text-white/50">{PENDING_LABEL}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
