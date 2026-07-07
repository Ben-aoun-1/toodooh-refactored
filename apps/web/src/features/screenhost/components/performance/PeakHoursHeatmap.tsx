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
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <SectionHeading
        num="Section 02"
        title="Vos peak hours"
        lead="Audience moyenne croisant les jours de la semaine et les heures d'ouverture, sur l'ensemble de la période. Plus la couleur est vive, plus l'audience est élevée. Les zones rayées correspondent à vos heures de fermeture."
      />

      <div className="mt-5 overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[2.5rem_repeat(14,minmax(0,1fr))] gap-1">
            <div />
            {HEATMAP_HOURS.map((hour) => (
              <div key={hour} className="text-center text-[10px] font-medium text-gray-400">
                {hour}h
              </div>
            ))}
            {DAY_LABELS_SHORT.map((label, day) => (
              <Fragment key={label}>
                <div className="flex items-center text-xs font-medium text-gray-500">{label}</div>
                {HEATMAP_HOURS.map((hour) => {
                  const closed = closedHour(hour, hasData, openingHour, closingHour);
                  const value = grid[day]?.[hour] ?? 0;
                  const level = intensityLevel(value, thresholds);
                  return (
                    <div
                      key={`${label}-${hour}`}
                      title={closed ? 'Fermé' : `${label} ${hour}h — ${value}`}
                      className={`h-6 rounded ${closed ? HEATMAP_CLOSED_CLASS : HEATMAP_LEVEL_CLASSES[level - 1]}`}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
        <span>Faible</span>
        <div className="flex gap-1">
          {HEATMAP_LEVEL_CLASSES.map((cls) => (
            <div key={cls} className={`h-3 w-6 rounded ${cls}`} />
          ))}
        </div>
        <span>Élevée</span>
      </div>
    </section>
  );
}
