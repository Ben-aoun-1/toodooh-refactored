import { Calendar, Download, Eye, Loader2 } from 'lucide-react';

import { formatIntFr } from '../../lib/performance-derive';
import { firstOfFollowingMonth, monthLabelFr } from '../../lib/performance-period';

import { PENDING_LABEL } from './Pending';
import { Var } from './Var';

interface MonthlyReportCardProps {
  /** The latest hub-pushed month for the venue, or null (EMPTY variant). */
  latestMonth: { month: string; total_audience: number } | null;
  /** Σ delivered impressions of that month (from the impressions-daily read). */
  monthImpressions: number;
  /** Count of campaigns whose end falls in that month. */
  campaignsCount: number;
  /** HOST first-data flag — gates the "Personnes atteintes" tile (Mejri ruling). */
  hasHostData: boolean;
  /** CAST first-data flag — gates the "Impressions générées" + "Campagnes diffusées" tiles. */
  hasCastData: boolean;
  onConsult: () => void;
  onDownload: () => void;
  downloading: boolean;
}

/** §3 — "Votre rendez-vous mensuel": the mockups' LIGHT lavender-gradient card + three tiles. */
export function MonthlyReportCard({
  latestMonth,
  monthImpressions,
  campaignsCount,
  hasHostData,
  hasCastData,
  onConsult,
  onDownload,
  downloading,
}: MonthlyReportCardProps) {
  const hasMonth = latestMonth !== null;
  const stats: { label: string; value: string | null; suffix?: string }[] = [
    { label: 'Impressions générées', value: hasCastData ? formatIntFr(monthImpressions) : null },
    {
      label: 'Personnes atteintes',
      value: hasHostData ? formatIntFr(latestMonth?.total_audience ?? 0) : null,
      suffix: 'pers.',
    },
    { label: 'Campagnes diffusées', value: hasCastData ? formatIntFr(campaignsCount) : null },
  ];

  return (
    <section className="relative isolate mb-12 mt-9 overflow-hidden rounded-[20px] border border-perf-line bg-[linear-gradient(155deg,#ECEDFD_0%,#FFFFFF_55%,#F5F6F8_100%)] p-[30px] px-[22px] pb-8 sm:p-10 sm:px-11 sm:pb-11">
      <div
        className="pointer-events-none absolute -top-[100px] right-[-80px] z-0 h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle_at_35%_35%,#9195F8,transparent_72%)] opacity-[0.16] blur-[42px]"
        aria-hidden
      />
      <div className="perf-mono relative z-10 inline-flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
        <Calendar className="h-[13px] w-[13px]" aria-hidden />
        Rapports mensuels
      </div>
      <h2 className="relative z-10 mt-4 text-[27px] font-bold tracking-[-0.015em] text-perf-ink">
        Votre rendez-vous <em className="not-italic text-brand-accent">mensuel</em>
      </h2>
      <p className="relative z-10 mt-2.5 max-w-[520px] text-sm leading-[1.6] text-perf-grey">
        Chaque mois, votre rapport d'audience est généré automatiquement et vous êtes notifié.
        Consultez le dernier et retrouvez tout l'historique, à télécharger à tout moment.
      </p>

      <div className="relative z-10 mt-7 rounded-2xl border border-perf-line bg-white/55 p-[22px] sm:p-[26px] sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <span className="perf-mono inline-flex items-center rounded-full bg-brand-accent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
            Nouveau
          </span>
          <span className="perf-mono text-[11px] text-perf-mist">
            Généré automatiquement le{' '}
            {hasMonth ? <Var>{firstOfFollowingMonth(latestMonth.month)}</Var> : <Var>—</Var>}
          </span>
        </div>

        <div className="mb-[22px] mt-5 flex flex-col items-start gap-4 border-b border-perf-line pb-[22px] sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div>
            <div className="perf-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-perf-mist">
              Dernier rapport mensuel
            </div>
            <div className="mt-2.5 text-[34px] font-bold tracking-[-0.02em] text-perf-ink">
              {hasMonth ? monthLabelFr(latestMonth.month) : '—'}
            </div>
            <p className="mt-2.5 max-w-[420px] text-[13px] leading-[1.6] text-perf-grey">
              Votre synthèse d'audience du mois : impressions générées, personnes touchées et profil
              de votre clientèle.
            </p>
          </div>
          <div className="flex w-full flex-shrink-0 items-center gap-2.5 sm:w-auto">
            <button
              type="button"
              onClick={onConsult}
              disabled={!hasMonth}
              className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-perf-line bg-white px-[19px] py-[11px] text-[13.5px] font-semibold text-perf-ink transition duration-150 hover:border-perf-mist hover:bg-[#F6F8FA] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
            >
              <Eye className="h-[15px] w-[15px]" aria-hidden />
              Consulter
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={!hasMonth || downloading}
              className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand-primary px-5 py-3 text-[13.5px] font-semibold text-[#0D2B1F] transition duration-150 hover:-translate-y-px hover:bg-[#65DCA0] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
            >
              {downloading ? (
                <Loader2 className="h-[15px] w-[15px] animate-spin" aria-hidden />
              ) : (
                <Download className="h-[15px] w-[15px]" aria-hidden />
              )}
              Télécharger
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-0">
          {stats.map((stat, idx) => (
            <div
              key={stat.label}
              className={`border-b border-perf-line pb-4 last:border-b-0 last:pb-0 sm:border-b-0 sm:px-[22px] sm:pb-0 ${
                idx === 0 ? 'sm:pl-0' : ''
              } ${idx < stats.length - 1 ? 'sm:border-r sm:border-r-perf-line' : ''}`}
            >
              <div className="perf-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-perf-mist">
                {stat.label}
              </div>
              {stat.value !== null ? (
                <div className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-perf-ink">
                  {stat.value}
                  {stat.suffix && (
                    <span className="ml-1 text-[13px] font-medium text-perf-mist">
                      {stat.suffix}
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-[14.5px] font-semibold italic text-perf-mist">
                  {PENDING_LABEL}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
