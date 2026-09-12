import { ChevronLeft, ChevronRight, Download, Eye, Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatDateFr } from '@/features/screenhost/lib/performance-period';

import {
  HISTORY_NO_MATCH,
  WAITING_HISTORY,
  WAITING_TITLE,
  budgetLabel,
  filterHistory,
  pageOf,
  paginate,
} from '../../lib/performances-derive';
import { NATURE_PILLS, type NatureFilter } from '../../lib/performances-period';
import type { ClosedCampaignWire } from '../../services/performances.service';

import { NaturePill, SectionHeading, WaitingCard } from './shared';

/**
 * Epic 4 — « Historique de vos campagnes » (RG-PERF-08..12): every CLOSED campaign, newest
 * clôture first; search + nature filter; Consulter → Campaign mode (the page scrolls + the row is
 * highlighted); per-row download; 10/page (Q5). US-4.3: the waiting message pre-first-clôture is
 * distinct from « aucune campagne ne correspond ».
 */
export function HistorySection({
  campaigns,
  activeId,
  onConsult,
  onDownload,
  downloading,
}: {
  campaigns: ClosedCampaignWire[];
  activeId: string | null;
  onConsult: (id: string) => void;
  onDownload: (campaign: ClosedCampaignWire) => void;
  downloading: string | null;
}) {
  const [query, setQuery] = useState('');
  const [nature, setNature] = useState<NatureFilter>('all');
  const [page, setPage] = useState(1);

  const filtered = filterHistory(campaigns, query, nature);
  const paged = paginate(filtered, page);

  // Consulter (from anywhere) must land on a visible row: jump to the consulted row's page.
  useEffect(() => {
    if (!activeId) return;
    const p = pageOf(filtered, activeId);
    if (p !== null) setPage(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the selection only
  }, [activeId]);

  return (
    <section className="mb-[64px]" id="historique">
      <SectionHeading
        num="Historique"
        title="Historique de vos campagnes"
        lead="Toutes vos campagnes clôturées, de la plus récente à la plus ancienne. Recherchez celle qui vous intéresse, puis consultez son rapport pour générer son analyse détaillée plus bas."
      />
      <div className="mt-6">
        {campaigns.length === 0 ? (
          <WaitingCard title={WAITING_TITLE} text={WAITING_HISTORY} />
        ) : (
          <div className="rounded-xl border border-perf-line bg-white">
            <div className="flex flex-col gap-3 border-b border-perf-line p-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="relative flex-1 sm:max-w-[360px]">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-perf-mist"
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Rechercher une campagne..."
                  aria-label="Rechercher une campagne"
                  className="w-full rounded-lg border border-perf-line bg-white py-2.5 pl-9 pr-3 text-[13.5px] text-perf-ink placeholder:text-perf-mist focus:border-perf-green focus:outline-none focus:ring-2 focus:ring-perf-green/10"
                />
              </label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Nature">
                {NATURE_PILLS.map((pill) => {
                  const on = pill.key === nature;
                  return (
                    <button
                      key={pill.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setNature(pill.key);
                        setPage(1);
                      }}
                      className={`rounded-full px-3.5 py-2 text-[12.5px] transition-colors ${
                        on
                          ? 'border border-brand-primary bg-brand-primary font-semibold text-[#0D2B1F]'
                          : 'border border-perf-line bg-white font-medium text-perf-grey hover:border-perf-green hover:text-perf-ink'
                      }`}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13.5px]">
                <thead>
                  <tr className="perf-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-perf-mist">
                    <th className="px-5 py-3 font-semibold">Campagne</th>
                    <th className="px-3 py-3 font-semibold">Type</th>
                    <th className="px-3 py-3 font-semibold">Période de diffusion</th>
                    <th className="px-3 py-3 font-semibold">Clôture</th>
                    <th className="px-3 py-3 text-right font-semibold">Budget HT (TTC)</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-10 text-center text-[13.5px] italic text-perf-mist"
                      >
                        {HISTORY_NO_MATCH}
                      </td>
                    </tr>
                  ) : (
                    paged.rows.map((c) => {
                      const active = c.id === activeId;
                      return (
                        <tr
                          key={c.id}
                          data-campaign-id={c.id}
                          className={`border-t border-perf-line transition-colors ${
                            active ? 'bg-[#E4F9EB]/60' : 'hover:bg-perf-page'
                          }`}
                        >
                          <td className="px-5 py-3.5 font-semibold text-perf-ink">{c.name}</td>
                          <td className="px-3 py-3.5">
                            <NaturePill nature={c.nature} />
                          </td>
                          <td className="perf-mono px-3 py-3.5 text-[12.5px] text-perf-grey">
                            {c.start_date ? formatDateFr(c.start_date) : '—'} au{' '}
                            {c.end_date ? formatDateFr(c.end_date) : '—'}
                          </td>
                          <td className="perf-mono px-3 py-3.5 text-[12.5px] text-perf-grey">
                            {formatDateFr(c.closed_on)}
                          </td>
                          <td className="perf-mono whitespace-nowrap px-3 py-3.5 text-right text-[12.5px] text-perf-ink">
                            {budgetLabel(c.budget_ht)}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => onConsult(c.id)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-perf-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-perf-ink transition-colors hover:border-perf-green"
                              >
                                <Eye className="h-3.5 w-3.5" aria-hidden />
                                Consulter
                              </button>
                              <button
                                type="button"
                                onClick={() => onDownload(c)}
                                disabled={downloading === c.id}
                                title="Télécharger"
                                aria-label={`Télécharger le rapport de ${c.name}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-perf-line bg-white text-perf-grey transition-colors hover:border-perf-green hover:text-perf-ink disabled:opacity-60"
                              >
                                {downloading === c.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <Download className="h-3.5 w-3.5" aria-hidden />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {paged.pageCount > 1 ? (
              <div className="flex items-center justify-between border-t border-perf-line px-5 py-3 text-[12.5px] text-perf-grey">
                <span className="perf-mono">
                  Page {paged.page} / {paged.pageCount} · {paged.total} campagne
                  {paged.total > 1 ? 's' : ''}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={paged.page <= 1}
                    aria-label="Page précédente"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-perf-line bg-white text-perf-grey hover:border-perf-green disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(paged.pageCount, p + 1))}
                    disabled={paged.page >= paged.pageCount}
                    aria-label="Page suivante"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-perf-line bg-white text-perf-grey hover:border-perf-green disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
