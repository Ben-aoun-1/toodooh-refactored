import { CalendarClock } from 'lucide-react';
import { useMemo } from 'react';

import { DAY_LABELS_SHORT } from '../../lib/affluence-grid';
import {
  type AffluenceSource,
  PROVENANCE_LABELS,
  provenanceGrid,
} from '../../lib/affluence-provenance';
import {
  PEAK_HOURS_EMPTY_TITLE,
  PEAK_HOURS_LEAD,
  heatmapHours,
  heatmapLevel,
  heatmapScale,
  peakHoursEmpty,
} from '../../lib/peak-hours';
import { formatDecimalFr } from '../../lib/performance-derive';

import {
  HEATMAP_CLOSED_CLASS,
  HEATMAP_ESTIMATION_CLASS,
  HEATMAP_LEVEL_CLASSES,
} from './chart-colors';
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
  /** The api's 7×24 MERGED typical-week grid (grid[0]=Monday), values as served. */
  grid: number[][];
  /** AFF1 — the matching 7×24 provenance grid (null = unknown / no row). */
  sources: (AffluenceSource | null)[][];
  hasData: boolean;
  counts: { measured: number; backup: number };
  openingHour: number | null;
  closingHour: number | null;
}

/**
 * S02 — "Vos peak hours": weekday × hour heatmap of the venue's TYPICAL WEEK (the hub's 4-week
 * rolling merge — AFF1 ruling: NOT period-scoped) WITH provenance. This component stays a pure
 * renderer: the (value, source) → kind rule lives in lib/affluence-provenance.
 * Hour columns come from the venue's REAL hours (8h–21h only as the unknown-hours fallback). A
 * cell is SOLID when measured by the sensor, DOTTED (lighter, dashed outline) when it is an
 * estimation, and HACHURÉE when the hour is closed OR the slot carries no data at all — never a
 * coloured 0 without provenance. The ramp is relative to the grid's own min/max over open cells
 * that carry data; the tooltip shows the exact value and its provenance. A venue with no data at
 * all gets the explanatory state instead of a mute wall of hachures.
 */
export function PeakHoursHeatmap({
  grid,
  sources,
  hasData,
  counts,
  openingHour,
  closingHour,
}: PeakHoursHeatmapProps) {
  const hours = useMemo(() => heatmapHours(openingHour, closingHour), [openingHour, closingHour]);
  const kinds = useMemo(() => provenanceGrid(grid, sources), [grid, sources]);
  const empty = peakHoursEmpty({ has_data: hasData, counts });
  const scale = useMemo(() => {
    const visible: (number | null)[] = [];
    for (let day = 0; day < 7; day += 1) {
      for (const hour of hours) {
        if (!closedHour(hour, openingHour, closingHour)) {
          visible.push(kinds[day]?.[hour] === 'none' ? null : (grid[day]?.[hour] ?? null));
        }
      }
    }
    return heatmapScale(visible);
  }, [grid, kinds, hours, openingHour, closingHour]);

  return (
    <section className="mb-[76px]">
      <SectionHeading num="Section 02" title="Vos peak hours" lead={PEAK_HOURS_LEAD} />

      {empty ? (
        <div className="mt-8 rounded-xl border-2 border-dashed border-perf-line bg-white px-6 py-12 text-center">
          <CalendarClock className="mx-auto h-8 w-8 text-perf-mist" aria-hidden />
          <p className="mt-3 font-medium text-perf-ink">{PEAK_HOURS_EMPTY_TITLE}</p>
          <p className="mt-1 text-sm text-perf-grey">
            La carte des peak hours apparaîtra ici dès que votre capteur d'audience aura mesuré des
            passages dans votre établissement.
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
                  const kind = kinds[day]?.[hour] ?? 'none';
                  const value = grid[day]?.[hour] ?? 0;
                  const level = kind === 'none' ? 0 : heatmapLevel(value, scale);
                  const hachure = closed || level === 0;
                  const title = closed
                    ? 'Fermé'
                    : kind === 'none'
                      ? `${label} ${hour}h — aucune donnée`
                      : `${label} ${hour}h — ${formatDecimalFr(value)} pers. (${kind === 'measured' ? 'mesuré' : 'estimation'})`;
                  return (
                    <div
                      key={`${label}-${hour}`}
                      title={title}
                      data-provenance={closed ? 'closed' : kind}
                      className={`h-[26px] min-w-0 flex-1 rounded ${
                        hachure
                          ? HEATMAP_CLOSED_CLASS
                          : `${HEATMAP_LEVEL_CLASSES[level - 1]}${kind === 'backup' ? ` ${HEATMAP_ESTIMATION_CLASS}` : ''}`
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div className="perf-mono mt-[18px] flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] uppercase tracking-[0.04em] text-perf-grey">
            <div className="flex items-center gap-2.5">
              <span>Faible</span>
              <div className="flex gap-[3px]">
                {HEATMAP_LEVEL_CLASSES.map((cls) => (
                  <div key={cls} className={`h-3.5 w-3.5 rounded-[3px] ${cls}`} />
                ))}
              </div>
              <span>Élevée</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`h-3.5 w-3.5 rounded-[3px] ${HEATMAP_LEVEL_CLASSES[3]}`} />
              <span>{PROVENANCE_LABELS.measured}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className={`h-3.5 w-3.5 rounded-[3px] ${HEATMAP_LEVEL_CLASSES[3]} ${HEATMAP_ESTIMATION_CLASS}`}
              />
              <span>{PROVENANCE_LABELS.backup}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`h-3.5 w-3.5 rounded-[3px] ${HEATMAP_CLOSED_CLASS}`} />
              <span>Fermé / aucune donnée</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
