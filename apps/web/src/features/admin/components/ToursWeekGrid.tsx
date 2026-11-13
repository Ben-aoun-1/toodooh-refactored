import type { ToursFicheVenue } from '@/features/admin/lib/eligible-hosts';
import { weekGrid } from '@/features/admin/lib/tours-fiche';

// DISP-TOURS — bloc 3 of the admin fiche (Mariem's spec §3.3): one venue's typical week, weekdays
// in columns (with their number of dates in the period), hours in rows. Each cell shows the
// affluence and is coloured by the tour that took it; an hour with no usable date (unavailable,
// closed that day, full, held by an event) is greyed. « C'est la vue la plus utile pour vérifier
// que les pics ont été pris dans le bon ordre. »

const TOUR_CELL = [
  'bg-orange-400 text-white',
  'bg-orange-200 text-gray-900',
  'bg-amber-100 text-gray-900',
];

const cellClass = (tour: number | null, n: number): string => {
  if (n === 0) return 'bg-gray-100 text-gray-300';
  if (tour === null) return 'bg-white text-gray-700 border border-gray-200';
  return TOUR_CELL[Math.min(tour, TOUR_CELL.length) - 1] ?? 'bg-amber-100 text-gray-900';
};

export function ToursWeekGrid({ venue, rPlein }: { venue: ToursFicheVenue; rPlein: number }) {
  const grid = weekGrid(venue);
  return (
    <div className="mt-2 rounded-lg border border-orange-100 bg-orange-50/30 p-3">
      <p className="mb-2 text-xs font-semibold text-gray-700">
        {venue.name} · heures prises (affluence de la semaine type)
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-[28rem] border-separate border-spacing-1 text-center text-xs">
          <thead>
            <tr>
              <th />
              {grid.days.map((d) => (
                <th key={d.dayOfWeek} className="font-semibold text-gray-700">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.hours.map((h) => (
              <tr key={h}>
                <td className="pr-1 text-right text-gray-500">{h} h</td>
                {grid.days.map((d) => {
                  const c = grid.cell(d.dayOfWeek, h);
                  if (!c) return <td key={d.dayOfWeek} />;
                  return (
                    <td
                      key={d.dayOfWeek}
                      className={`rounded-md px-2 py-1 font-bold tabular-nums ${cellClass(c.tour, c.n)}`}
                      title={
                        c.tour === null
                          ? c.n === 0
                            ? 'Indisponible, fermé ou complet'
                            : 'Non prise'
                          : `Tour ${c.tour} · ${c.passages ?? rPlein} passages/h · ${c.n} date(s)`
                      }
                    >
                      {c.affluence}
                      {c.tour !== null && c.passages !== null && c.passages < rPlein && (
                        <span className="ml-0.5 text-[10px] font-normal">({c.passages})</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-orange-400" /> Tour 1 : 2 heures de pic
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-orange-200" /> Tour 2
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-amber-100" /> Tour 3 et suivants
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-gray-100" /> Indisponible, fermé ou
          complet
        </span>
        <span>(n) = passages/h d’une tranche partielle · ×2 = 2 dates de ce jour</span>
      </div>
    </div>
  );
}
