import { CalendarClock } from 'lucide-react';
import { useMemo } from 'react';

import { DAY_LABELS_SHORT } from '../../lib/affluence-grid';
import { PEAK_HOURS_LEAD, gridIsAllEmpty, heatmapHours } from '../../lib/peak-hours';
import { intensityLevel, quantileThresholds } from '../../lib/performance-derive';

import { HEATMAP_CLOSED_CLASS, HEATMAP_LEVEL_CLASSES } from './chart-colors';
import { SectionHeading } from './SectionHeading';

const closedHour = (
  hour: number,
  openingHour: number | null,
  closingHour: number | null,
): boolean => {
  if (openingHour === null || closingHour === null) return false;
  return hour < openingHour || hour >= closingHour;
};

interface PeakHoursHeatmapProps {
  /** 7×24 PERIOD grid (grid[0]=Monday) — periodWeekGrid over the active filter window. */
  grid: number[][];
  openingHour: number | null;
  closingHour: number | null;
}

/**
 * S02 — "Vos peak hours": weekday × hour heatmap over THE SELECTED PERIOD (PERF-QA2, ruling
 * 2026-08-20 — R7's rolling typical week is superseded; the grid arrives already period-scoped
 * from periodWeekGrid, and this component stays a pure renderer).
 * Hour columns come from the venue's REAL hours (8h–21h only as the unknown-hours fallback). A
 * cell is HACHURÉE when the hour is closed OR when it has no data (level 0 — the grid
 * zero-fills, so 0 reads as no-data; accepted approximation per the Mejri ruling). The quantile
 * ramp applies only to cells with data. An all-empty grid gets the explanatory state instead of
 * a mute full-hachure grid (her Aug-4 re-open of the Jul-8 item 1) — a period with no audience
 * day now lands there BY CONSTRUCTION.
 */
export function PeakHoursHeatmap({ grid, openingHour, closingHour }: PeakHoursHeatmapProps) {
  const hours = useMemo(() => heatmapHours(openingHour, closingHour), [openingHour, closingHour]);
  const allEmpty = useMemo(() => gridIsAllEmpty(grid), [grid]);
  const thresholds = useMemo(() => {
    const visible: number[] = [];
    for (let day = 0; day < 7; day += 1) {
      for (const hour of hours) {
        if (!closedHour(hour, openingHour, closingHour)) {
          visible.push(grid[day]?.[hour] ?? 0);
        }
      }
    }
    return quantileThresholds(visible);
  }, [grid, hours, openingHour, closingHour]);

  return (
    <section className="mb-[76px]">
      <SectionHeading num="Section 02" title="Vos peak hours" lead={PEAK_HOURS_LEAD} />

      {allEmpty ? (
        <div className="mt-8 rounded-xl border-2 border-dashed border-perf-line bg-white px-6 py-12 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-perf-mist" aria-hidden />
          <p className="mt-3 font-medium text-perf-ink">
            Pas encore de données d'affluence sur cette période
          </p>
          <p className="mt-1 text-sm text-perf-grey">
            La carte des peak hours apparaîtra ici dès que votre établissement aura des mesures
            d'affluence sur la période sélectionnée.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-perf-line bg-white p-[26px]">
          <div className="min-w-[680px]">
            <div className="flex gap-1">
              <div className="w-[52px] flex-shrink-0" />
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="perf-mono min-w-0 flex-1 pb-2 text-center text-[10px] text-perf-mist"
                >
                  {hour}h
                </div>
              ))}
            </div>
            {DAY_LABELS_SHORT.map((label, day) => (
              <div key={label} className="mt-1 flex gap-1">
                <div className="perf-mono w-[52px] flex-shrink-0 self-center pr-1.5 text-[11px] uppercase tracking-[0.05em] text-perf-grey">
                  {label}
                </div>
                {hours.map((hour) => {
                  const closed = closedHour(hour, openingHour, closingHour);
                  const value = grid[day]?.[hour] ?? 0;
                  const level = intensityLevel(value, thresholds);
                  const hachure = closed || level === 0;
                  return (
                    <div
                      key={`${label}-${hour}`}
                      title={
                        closed ? 'Fermé' : `${label} ${hour}h — ${value.toLocaleString('fr-FR')}`
                      }
                      className={`h-[26px] min-w-0 flex-1 rounded ${hachure ? HEATMAP_CLOSED_CLASS : HEATMAP_LEVEL_CLASSES[level - 1]}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div className="perf-mono mt-[18px] flex items-center gap-2.5 text-[10px] uppercase tracking-[0.04em] text-perf-grey">
            <span>Faible</span>
            <div className="flex gap-[3px]">
              {HEATMAP_LEVEL_CLASSES.map((cls) => (
                <div key={cls} className={`h-3.5 w-3.5 rounded-[3px] ${cls}`} />
              ))}
            </div>
            <span>Élevée</span>
          </div>
        </div>
      )}
    </section>
  );
}
