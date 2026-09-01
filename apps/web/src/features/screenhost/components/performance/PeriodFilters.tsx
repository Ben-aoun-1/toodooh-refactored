import {
  type PeriodKey,
  PARKED_PERIOD_NOTE,
  PERIOD_PILLS,
  isPeriodParked,
  periodPillLabel,
} from '../../lib/performance-period';

interface PeriodFiltersProps {
  active: PeriodKey;
  onSelect: (key: PeriodKey) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
}

/**
 * §6 — the period pills + the "Personnalisé" panel. DEVIATION (ruled): the mockup's Campagne
 * select is dropped — V1 filters by period only. Filtering is client-side; the pills drive every
 * section below them — S02 included since PERF-QA2 (R7 superseded).
 *
 * PERF-QA2 — this is the page's PINNED filter bar: WHITE, edge to edge (negative margins undo the
 * content column's padding), and sticky to the top of the scroller so the filters stay reachable
 * while reading the sections they drive. It keeps its place in the flow — the ruling was to make
 * the chrome white and the bar pinned, not to move content.
 */
export function PeriodFilters({
  active,
  onSelect,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  onApplyCustom,
}: PeriodFiltersProps) {
  return (
    <section className="sticky top-0 z-20 -mx-5 mb-14 border-y border-perf-line bg-white px-5 py-4 sm:-mx-10 sm:px-10">
      <div className="flex flex-wrap gap-2">
        {PERIOD_PILLS.map((pill) => {
          const isActive = pill.key === active;
          // PERF-CUSTOM1 — a parked pill is rendered, DISABLED and annotated « bientôt disponible »:
          // an owner clicking it used to get nothing and no explanation. The label + the parked set
          // live in lib/performance-period (this repo has no render harness, so a rule that lives
          // in a component is unpinnable); the root cause is documented there.
          const parked = isPeriodParked(pill.key);
          return (
            <button
              key={pill.key}
              type="button"
              onClick={() => onSelect(pill.key)}
              disabled={parked}
              aria-pressed={isActive}
              aria-disabled={parked || undefined}
              title={parked ? PARKED_PERIOD_NOTE : undefined}
              className={`rounded-full px-[17px] py-[9px] text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                parked
                  ? 'cursor-not-allowed border border-dashed border-perf-line bg-white font-medium italic text-perf-mist'
                  : isActive
                    ? 'border border-brand-primary bg-brand-primary font-semibold text-[#0D2B1F]'
                    : 'border border-perf-line bg-white font-medium text-perf-grey hover:border-perf-green hover:text-perf-ink'
              }`}
            >
              {periodPillLabel(pill)}
            </button>
          );
        })}
      </div>

      {active === 'custom' && (
        <div className="mt-3.5 grid grid-cols-1 items-end gap-[18px] rounded-xl border border-perf-line bg-white p-[22px] px-6 sm:grid-cols-2 md:grid-cols-[1fr_1fr_auto]">
          <div className="flex flex-col gap-[7px]">
            <label
              htmlFor="perf-date-start"
              className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-perf-grey"
            >
              Date de début
            </label>
            <input
              id="perf-date-start"
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFromChange(e.target.value)}
              className="w-full rounded-lg border border-perf-line bg-white px-3 py-2.5 text-[13.5px] text-perf-ink focus:border-perf-green focus:outline-none focus:ring-2 focus:ring-perf-green/10"
            />
          </div>
          <div className="flex flex-col gap-[7px]">
            <label
              htmlFor="perf-date-end"
              className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-perf-grey"
            >
              Date de fin
            </label>
            <input
              id="perf-date-end"
              type="date"
              value={customTo}
              onChange={(e) => onCustomToChange(e.target.value)}
              className="w-full rounded-lg border border-perf-line bg-white px-3 py-2.5 text-[13.5px] text-perf-ink focus:border-perf-green focus:outline-none focus:ring-2 focus:ring-perf-green/10"
            />
          </div>
          <button
            type="button"
            onClick={onApplyCustom}
            className="whitespace-nowrap rounded-lg bg-brand-primary px-5 py-[11px] text-[13.5px] font-semibold text-[#0D2B1F] transition-colors hover:bg-[#65DCA0]"
          >
            Actualiser la recherche
          </button>
        </div>
      )}
    </section>
  );
}
