import { type PeriodKey, PERIOD_PILLS } from '../../lib/performance-period';

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
 * section below them.
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
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {PERIOD_PILLS.map((pill) => {
          const isActive = pill.key === active;
          return (
            <button
              key={pill.key}
              type="button"
              onClick={() => onSelect(pill.key)}
              aria-pressed={isActive}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                isActive
                  ? 'bg-brand-deep text-white'
                  : pill.key === 'custom'
                    ? 'border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      {active === 'custom' && (
        <div className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <div>
            <label
              htmlFor="perf-date-start"
              className="mb-1 block text-sm font-semibold text-gray-700"
            >
              Date de début
            </label>
            <input
              id="perf-date-start"
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFromChange(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            />
          </div>
          <div>
            <label
              htmlFor="perf-date-end"
              className="mb-1 block text-sm font-semibold text-gray-700"
            >
              Date de fin
            </label>
            <input
              id="perf-date-end"
              type="date"
              value={customTo}
              onChange={(e) => onCustomToChange(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            />
          </div>
          <button
            type="button"
            onClick={onApplyCustom}
            className="h-11 rounded-lg bg-brand-primary px-4 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90"
          >
            Actualiser la recherche
          </button>
        </div>
      )}
    </section>
  );
}
