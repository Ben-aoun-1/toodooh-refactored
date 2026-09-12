import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { formatDateFr } from '@/features/screenhost/lib/performance-period';

import { SELECTOR_EMPTY } from '../../lib/performances-derive';
import {
  NATURE_PILLS,
  type NatureFilter,
  PERIOD_PILLS,
  type PeriodKey,
  type Scope,
  campaignCountLabel,
  campaignScopeLabel,
  natureBadge,
  natureLabel,
  periodLabel,
} from '../../lib/performances-period';
import type { ClosedCampaignWire } from '../../services/performances.service';

/**
 * Epic 6 — the generation filter (RG-PERF-15..19): the context band (US-6.5) always visible above
 * the sections; period pills + Personnalisé (US-6.1/6.2); nature (US-6.3, no effect in Campaign
 * mode); the direct campaign selector (US-6.4 — the SAME mechanism as Consulter).
 */
export function AnalysisFilterBar({
  scope,
  closed,
  campaignCount,
  onSelectPeriod,
  onSelectNature,
  onSelectCampaign,
  onApplyCustom,
}: {
  scope: Scope;
  closed: ClosedCampaignWire[];
  /** Campaigns in the analysed perimeter (Period mode badge). */
  campaignCount: number;
  onSelectPeriod: (key: PeriodKey) => void;
  onSelectNature: (nature: NatureFilter) => void;
  onSelectCampaign: (id: string) => void;
  onApplyCustom: (from: string, to: string) => void;
}) {
  const isCampaign = scope.mode === 'campaign';
  const current = isCampaign ? (closed.find((c) => c.id === scope.campaignId) ?? null) : null;
  const [customFrom, setCustomFrom] = useState(
    scope.mode === 'period' ? (scope.custom.from ?? '') : '',
  );
  const [customTo, setCustomTo] = useState(scope.mode === 'period' ? (scope.custom.to ?? '') : '');
  const [customOpen, setCustomOpen] = useState(
    scope.mode === 'period' && scope.period === 'custom',
  );
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCustomOpen(scope.mode === 'period' && scope.period === 'custom');
  }, [scope]);

  useEffect(() => {
    if (!selectorOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node))
        setSelectorOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [selectorOpen]);

  const pillClass = (on: boolean) =>
    `rounded-full px-[15px] py-[8px] text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
      on
        ? 'border border-brand-primary bg-brand-primary font-semibold text-[#0D2B1F]'
        : 'border border-perf-line bg-white font-medium text-perf-grey hover:border-perf-green hover:text-perf-ink'
    }`;

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-10 border-y border-perf-line bg-white px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {/* US-6.5 — the context band */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
        <span className="text-perf-grey">Analyse générée pour</span>
        <span className="font-semibold text-perf-ink">
          {isCampaign
            ? current
              ? campaignScopeLabel(current)
              : 'une campagne introuvable'
            : periodLabel(scope)}
        </span>
        <span className="perf-mono rounded-full bg-perf-soft px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-perf-grey">
          {isCampaign
            ? current
              ? natureBadge(current.nature)
              : '—'
            : campaignCountLabel(campaignCount)}
        </span>
      </div>

      <div className="mt-3.5 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:gap-6">
        <div>
          <div className="perf-mono mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-perf-mist">
            Période
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Période">
            {PERIOD_PILLS.map((pill) => {
              const on = scope.mode === 'period' && scope.period === pill.key;
              return (
                <button
                  key={pill.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    if (pill.key === 'custom') {
                      setCustomOpen(true);
                      return;
                    }
                    onSelectPeriod(pill.key);
                  }}
                  className={pillClass(on)}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="perf-mono mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-perf-mist">
            Nature
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Nature">
            {NATURE_PILLS.map((pill) => {
              const on = scope.mode === 'period' && scope.nature === pill.key;
              return (
                <button
                  key={pill.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelectNature(pill.key)}
                  className={pillClass(on)}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </div>

        <div ref={selectorRef} className="relative">
          <div className="perf-mono mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-perf-mist">
            Campagne
          </div>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={selectorOpen}
            onClick={() => setSelectorOpen((v) => !v)}
            className="inline-flex min-w-[220px] items-center justify-between gap-3 rounded-full border border-perf-line bg-white px-[15px] py-[8px] text-[13px] font-medium text-perf-ink hover:border-perf-green"
          >
            <span className="truncate">{current ? current.name : 'Toutes les campagnes'}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-perf-mist" aria-hidden />
          </button>
          {selectorOpen ? (
            <div
              role="listbox"
              className="absolute left-0 top-full z-30 mt-1.5 max-h-[320px] w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-perf-line bg-white p-1.5 shadow-[0_12px_32px_rgba(16,37,26,0.12)]"
            >
              {closed.length === 0 ? (
                <div className="px-3 py-3 text-[13px] italic text-perf-mist">{SELECTOR_EMPTY}</div>
              ) : (
                closed.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={current?.id === c.id}
                    onClick={() => {
                      setSelectorOpen(false);
                      onSelectCampaign(c.id);
                    }}
                    className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-perf-page ${
                      current?.id === c.id ? 'bg-[#E4F9EB]/70' : ''
                    }`}
                  >
                    <span className="text-[13px] font-semibold text-perf-ink">{c.name}</span>
                    <span className="perf-mono text-[11px] text-perf-mist">
                      {natureLabel(c.nature)} · Clôturée le {formatDateFr(c.closed_on)}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>

      {customOpen ? (
        <div className="mt-3.5 grid grid-cols-1 items-end gap-[14px] rounded-xl border border-perf-line bg-white p-[18px] sm:grid-cols-2 md:grid-cols-[1fr_1fr_auto]">
          <div className="flex flex-col gap-[6px]">
            <label
              htmlFor="scp-date-start"
              className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-perf-grey"
            >
              Date de début
            </label>
            <input
              id="scp-date-start"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-full rounded-lg border border-perf-line bg-white px-3 py-2.5 text-[13.5px] text-perf-ink focus:border-perf-green focus:outline-none focus:ring-2 focus:ring-perf-green/10"
            />
          </div>
          <div className="flex flex-col gap-[6px]">
            <label
              htmlFor="scp-date-end"
              className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-perf-grey"
            >
              Date de fin
            </label>
            <input
              id="scp-date-end"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-full rounded-lg border border-perf-line bg-white px-3 py-2.5 text-[13.5px] text-perf-ink focus:border-perf-green focus:outline-none focus:ring-2 focus:ring-perf-green/10"
            />
          </div>
          <button
            type="button"
            onClick={() => onApplyCustom(customFrom, customTo)}
            disabled={!customFrom || !customTo}
            className="whitespace-nowrap rounded-lg bg-brand-primary px-5 py-[11px] text-[13.5px] font-semibold text-[#0D2B1F] transition-colors hover:bg-[#65DCA0] disabled:opacity-50"
          >
            Actualiser la recherche
          </button>
        </div>
      ) : null}
    </div>
  );
}
