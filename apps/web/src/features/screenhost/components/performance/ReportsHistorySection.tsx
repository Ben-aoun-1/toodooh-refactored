import { Download, Eye, FileText } from 'lucide-react';

import { formatIntFr } from '../../lib/performance-derive';
import { firstOfFollowingMonth, monthLabelFr } from '../../lib/performance-period';

interface HistoryRow {
  month: string;
  totalAudience: number;
  impressions: number;
}

interface ReportsHistorySectionProps {
  /** Every month AFTER the latest one (the latest lives on the monthly card), newest first. */
  rows: HistoryRow[];
  onConsult: (month: string) => void;
  onDownload: (month: string) => void;
}

/** §4 — "Historique de vos rapports mensuels": one white card row per archived month. */
export function ReportsHistorySection({ rows, onConsult, onDownload }: ReportsHistorySectionProps) {
  return (
    <section className="mb-12">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="perf-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          Historique de vos rapports mensuels
        </div>
        <div className="text-[12.5px] text-perf-mist">
          Un rapport archivé chaque mois · à consulter et télécharger à tout moment
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-perf-line bg-white px-5 py-[34px] text-center text-[13.5px] italic text-perf-mist">
          En attente du rapport mensuel.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div
              key={row.month}
              className="flex flex-wrap items-center gap-4 rounded-xl border border-perf-line bg-white px-5 py-4 transition-colors hover:border-brand-accent"
            >
              <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-perf-lavender text-brand-accent">
                <FileText className="h-[17px] w-[17px]" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="text-[15.5px] font-semibold tracking-[-0.005em] text-perf-ink">
                  {monthLabelFr(row.month)}
                </div>
                <div className="perf-mono mt-0.5 text-[11px] text-perf-mist">
                  Généré le {firstOfFollowingMonth(row.month)}
                </div>
              </div>
              <div className="order-3 w-full whitespace-nowrap text-left text-[13px] font-medium text-perf-grey sm:order-none sm:ml-auto sm:w-auto sm:text-right">
                <strong className="font-semibold text-perf-ink">
                  {formatIntFr(row.impressions)}
                </strong>{' '}
                impressions ·{' '}
                <strong className="font-semibold text-perf-ink">
                  {formatIntFr(row.totalAudience)}
                </strong>{' '}
                pers.
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onConsult(row.month)}
                  aria-label={`Consulter le rapport de ${monthLabelFr(row.month)}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-perf-line bg-white text-perf-grey transition-colors hover:bg-[#F6F8FA]"
                >
                  <Eye className="h-[15px] w-[15px]" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(row.month)}
                  aria-label={`Télécharger le rapport de ${monthLabelFr(row.month)}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-perf-line bg-white text-perf-grey transition-colors hover:bg-[#F6F8FA]"
                >
                  <Download className="h-[15px] w-[15px]" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
