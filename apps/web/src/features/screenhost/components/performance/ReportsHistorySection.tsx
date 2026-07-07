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

/** §4 — "Historique de vos rapports mensuels": one row per archived month. */
export function ReportsHistorySection({ rows, onConsult, onDownload }: ReportsHistorySectionProps) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-brand-deep">
          Historique de vos rapports mensuels
        </h2>
        <p className="text-sm text-gray-500">
          Un rapport archivé chaque mois · à consulter et télécharger à tout moment
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-xl border-2 border-dashed border-gray-200 px-4 py-8 text-center text-sm italic text-gray-400">
          En attente du rapport mensuel.
        </div>
      ) : (
        <div className="mt-4 divide-y divide-gray-100">
          {rows.map((row) => (
            <div key={row.month} className="flex flex-wrap items-center gap-3 py-3 sm:gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-primary/15 text-brand-deep">
                <FileText className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-brand-deep">{monthLabelFr(row.month)}</div>
                <div className="text-xs text-gray-500">
                  Généré le {firstOfFollowingMonth(row.month)}
                </div>
              </div>
              <div className="hidden text-sm text-gray-500 sm:block">
                <strong className="font-semibold text-brand-deep">
                  {formatIntFr(row.impressions)}
                </strong>{' '}
                impressions ·{' '}
                <strong className="font-semibold text-brand-deep">
                  {formatIntFr(row.totalAudience)}
                </strong>{' '}
                pers.
              </div>
              <div className="flex flex-shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => onConsult(row.month)}
                  aria-label={`Consulter le rapport de ${monthLabelFr(row.month)}`}
                  className="rounded-lg border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-brand-deep"
                >
                  <Eye className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(row.month)}
                  aria-label={`Télécharger le rapport de ${monthLabelFr(row.month)}`}
                  className="rounded-lg border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-brand-deep"
                >
                  <Download className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
