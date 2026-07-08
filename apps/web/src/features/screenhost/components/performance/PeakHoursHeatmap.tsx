import { Fragment, useMemo } from 'react';

import { DAY_LABELS_SHORT } from '../../lib/affluence-grid';
import { intensityLevel, quantileThresholds } from '../../lib/performance-derive';

import { HEATMAP_CLOSED_CLASS, HEATMAP_LEVEL_CLASSES } from './chart-colors';
import { SectionHeading } from './SectionHeading';

/** The mockups' visible hour columns — 8h through 21h. */
const HEATMAP_HOURS = Array.from({ length: 14 }, (_, i) => i + 8);

const closedHour = (
  hour: number,
  hasData: boolean,
  openingHour: number | null,
  closingHour: number | null,
): boolean => {
  if (!hasData) return true;
  if (openingHour === null || closingHour === null) return false;
  return hour < openingHour || hour >= closingHour;
};

interface PeakHoursHeatmapProps {
  /** 7×24 typical-week grid (grid[0]=Monday), from the existing affluence read. */
  grid: number[][];
  hasData: boolean;
  openingHour: number | null;
  closingHour: number | null;
}

/**
 * S02 — "Vos peak hours": weekday × hour heatmap. Intensity is quantile-bucketed over the visible
 * OPEN cells; hours outside [opening, closing) get the striped "fermé" treatment; no data at all →
 * everything striped (the EMPTY mockup).
 */
export function PeakHoursHeatmap({
  grid,
  hasData,
  openingHour,
  closingHour,
}: PeakHoursHeatmapProps) {
  const thresholds = useMemo(() => {
    const visible: number[] = [];
    for (let day = 0; day < 7; day += 1) {
      for (const hour of HEATMAP_HOURS) {
        if (!closedHour(hour, hasData, openingHour, closingHour)) {
          visible.push(grid[day]?.[hour] ?? 0);
        }
      }
    }
    return quantileThresholds(visible);
  }, [grid, hasData, openingHour, closingHour]);

  return (
    <section className="mb-[76px]">
      <SectionHeading
        num="Section 02"
        title="Vos peak hours"
        lead="Audience moyenne croisant les jours de la semaine et les heures d'ouverture, sur l'ensemble de la période. Plus la couleur est vive, plus l'audience est élevée. Les zones rayées correspondent à vos heures de fermeture."
      />

      <div className="mt-8 overflow-x-auto rounded-xl border border-perf-line bg-white p-[26px]">
        <div className="grid min-w-[680px] grid-cols-[52px_repeat(14,minmax(0,1fr))] gap-1">
          <div />
          {HEATMAP_HOURS.map((hour) => (
            <div key={hour} className="perf-mono pb-2 text-center text-[10px] text-perf-mist">
              {hour}h
            </div>
          ))}
          {DAY_LABELS_SHORT.map((label, day) => (
            <Fragment key={label}>
              <div className="perf-mono self-center pr-1.5 text-[11px] uppercase tracking-[0.05em] text-perf-grey">
                {label}
              </div>
              {HEATMAP_HOURS.map((hour) => {
                const closed = closedHour(hour, hasData, openingHour, closingHour);
                const value = grid[day]?.[hour] ?? 0;
                const level = intensityLevel(value, thresholds);
                return (
                  <div
                    key={`${label}-${hour}`}
                    title={closed ? 'Fermé' : `${label} ${hour}h — ${value}`}
                    className={`h-[26px] rounded ${closed ? HEATMAP_CLOSED_CLASS : HEATMAP_LEVEL_CLASSES[level - 1]}`}
                  />
                );
              })}
            </Fragment>
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
    </section>
  );
}
