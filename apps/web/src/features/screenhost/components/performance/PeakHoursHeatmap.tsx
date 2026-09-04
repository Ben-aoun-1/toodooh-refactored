import { CalendarClock } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DAY_LABELS_SHORT } from '../../lib/affluence-grid';
import {
  type AffluenceSource,
  PROVENANCE_LABELS,
  provenanceGrid,
  provenanceLabel,
} from '../../lib/affluence-provenance';
import {
  HEATMAP_HINT,
  PEAK_HOURS_EMPTY_TITLE,
  PEAK_HOURS_LEAD,
  heatmapCellTitle,
  type HalfCell,
  collapseHourCell,
  heatmapHours,
  heatmapSlots,
  slotLabel,
  heatmapLevel,
  heatmapScale,
  peakHoursEmpty,
} from '../../lib/peak-hours';

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
  /** The api's 7×48 MERGED typical-week grid (grid[0]=Monday), values as served — SLOT columns. */
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
 * that carry data. A venue with no data at all gets the explanatory state instead of a mute wall
 * of hachures.
 *
 * MEJ-3 (Mejri 31/08 pt 3) — the native `title` tooltip is GONE. ONE `describe()` builds each
 * cell's (value, kind, closed) descriptor, and both the colour and the text read from it, so the
 * caption can never describe a different cell than the one under the cursor (the native tooltip
 * lagged a cell behind on a fast traverse, which is what read as « an incorrect value »). The
 * text itself lives in lib/peak-hours (`heatmapCellTitle`) where a test can pin it; `aria-label`
 * carries the same string for assistive tech.
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
  // Slice C — desktop draws both halves of every hour; ≤375 px collapses them back to the HIGHER
  // half's peak (PEAK-MAX1). The rules live in lib/peak-hours, never here: WEB-GATE1.
  const slots = useMemo(() => heatmapSlots(openingHour, closingHour), [openingHour, closingHour]);
  const kinds = useMemo(() => provenanceGrid(grid, sources), [grid, sources]);
  const empty = peakHoursEmpty({ has_data: hasData, counts });
  const [hovered, setHovered] = useState<{ day: number; slot: number } | null>(null);

  // MEJ-3 — THE cell descriptor. The colour, the aria-label and the caption all read from this
  // one call, so what the caption says is by construction what the cell renders.
  const describe = useCallback(
    (day: number, slot: number) => ({
      dayLabel: DAY_LABELS_SHORT[day] ?? '',
      slot,
      closed: closedHour(Math.floor(slot / 2), openingHour, closingHour),
      kind: kinds[day]?.[slot] ?? ('none' as const),
      value: grid[day]?.[slot] ?? 0,
    }),
    [grid, kinds, openingHour, closingHour],
  );

  const scale = useMemo(() => {
    // The scale spans the SLOTS the reader actually sees, so the collapsed phone layout colours
    // against the same bounds as the desktop one.
    const visible: (number | null)[] = [];
    for (let day = 0; day < 7; day += 1) {
      for (const slot of slots) {
        if (!closedHour(Math.floor(slot / 2), openingHour, closingHour)) {
          visible.push(kinds[day]?.[slot] === 'none' ? null : (grid[day]?.[slot] ?? null));
        }
      }
    }
    return heatmapScale(visible);
  }, [grid, kinds, slots, openingHour, closingHour]);

  const caption = hovered ? heatmapCellTitle(describe(hovered.day, hovered.slot)) : HEATMAP_HINT;

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
        <div
          className="mt-8 overflow-x-auto rounded-xl border border-perf-line bg-white p-[26px]"
          onMouseLeave={() => setHovered(null)}
        >
          {/* Slice C — DESKTOP: two sub-columns per hour, the hour label spanning both. */}
          <div className="hidden min-w-[920px] min-[376px]:block">
            <div className="flex gap-1">
              <div className="w-[52px] flex-shrink-0" />
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="perf-mono min-w-0 flex-[2] pb-2 text-center text-[10px] text-perf-mist"
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
                {hours.map((hour) => (
                  <div key={`${label}-${hour}`} className="flex min-w-0 flex-[2] gap-px">
                    {[hour * 2, hour * 2 + 1].map((slot) => {
                      const cell = describe(day, slot);
                      const level = cell.kind === 'none' ? 0 : heatmapLevel(cell.value, scale);
                      const hachure = cell.closed || level === 0;
                      return (
                        <div
                          key={slot}
                          aria-label={heatmapCellTitle(cell)}
                          data-provenance={cell.closed ? 'closed' : cell.kind}
                          data-slot={slot}
                          onMouseEnter={() => setHovered({ day, slot })}
                          onFocus={() => setHovered({ day, slot })}
                          tabIndex={-1}
                          className={`h-[26px] min-w-0 flex-1 rounded-[2px] ${
                            hachure
                              ? HEATMAP_CLOSED_CLASS
                              : `${HEATMAP_LEVEL_CLASSES[level - 1]}${cell.kind === 'backup' ? ` ${HEATMAP_ESTIMATION_CLASS}` : ''}`
                          }`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Slice C — ≤375 px: 28 columns do not fit a phone, so the halves collapse back into
              their hour. PEAK-MAX1: the column shows the HIGHER of the two half-hour peaks and
              carries that half's provenance, so it names a reading that actually happened. */}
          <div className="min-w-0 min-[376px]:hidden">
            <div className="flex gap-1">
              <div className="w-[38px] flex-shrink-0" />
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="perf-mono min-w-0 flex-1 pb-2 text-center text-[8px] text-perf-mist"
                >
                  {hour}
                </div>
              ))}
            </div>
            {DAY_LABELS_SHORT.map((label, day) => (
              <div key={label} className="mt-1 flex gap-1">
                <div className="perf-mono w-[38px] flex-shrink-0 self-center pr-1 text-[10px] uppercase tracking-[0.04em] text-perf-grey">
                  {label}
                </div>
                {hours.map((hour) => {
                  const halves: HalfCell[] = [hour * 2, hour * 2 + 1].map((slot) => {
                    const c = describe(day, slot);
                    return { value: c.kind === 'none' ? null : c.value, kind: c.kind };
                  });
                  const merged = collapseHourCell(halves);
                  const closed = closedHour(hour, openingHour, closingHour);
                  const level = merged.value === null ? 0 : heatmapLevel(merged.value, scale);
                  const hachure = closed || level === 0;
                  const estimated = merged.kind === 'backup';
                  return (
                    <div
                      key={`${label}-h${hour}`}
                      aria-label={`${label} ${slotLabel(hour * 2)} — ${
                        closed ? 'fermé' : provenanceLabel(merged.kind)
                      }`}
                      data-provenance={closed ? 'closed' : merged.kind}
                      className={`h-[22px] min-w-0 flex-1 rounded-[2px] ${
                        hachure
                          ? HEATMAP_CLOSED_CLASS
                          : `${HEATMAP_LEVEL_CLASSES[level - 1]}${estimated ? ` ${HEATMAP_ESTIMATION_CLASS}` : ''}`
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* MEJ-3 — the live cell readout: always the hovered cell's own value + source. */}
          <p
            aria-live="polite"
            className={`mt-[18px] text-[12.5px] leading-[1.45] ${
              hovered ? 'font-medium text-perf-ink' : 'text-perf-mist'
            }`}
          >
            {caption}
          </p>

          <div className="perf-mono mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] uppercase tracking-[0.04em] text-perf-grey">
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
            {/* Slice C — narrow layout ONLY: on this width an hour is one column, so a mixed hour
                is drawn in the estimation treatment (the conservative side — it never claims to be
                a measure) and this line is what tells the reader such an hour exists. On desktop
                the two halves are drawn separately and there is nothing to explain. */}
          </div>
        </div>
      )}
    </section>
  );
}
