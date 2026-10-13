import { ChevronLeft, ChevronRight } from 'lucide-react';

import {
  DAY_CLASS,
  type DayState,
  dayState,
  monthCells,
  monthLabel,
  shiftMonth,
} from '../lib/appointments';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/**
 * AGT-5 — the monthly calendar shared by the agent's availability editor and the affiliate's
 * booking modal: pale green available, pale red unavailable, past days frozen, a dot on days
 * carrying an appointment, the selection ringed.
 */
export function MonthCalendar({
  month,
  onMonth,
  today,
  unavailable,
  dots = [],
  selected = [],
  onDay,
  pastSelectable = false,
  unavailableSelectable = true,
}: {
  month: string;
  onMonth: (m: string) => void;
  today: string;
  unavailable: string[];
  dots?: string[];
  selected?: string[];
  onDay: (day: string, state: DayState) => void;
  pastSelectable?: boolean;
  unavailableSelectable?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#E1E4EA] bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonth(shiftMonth(month, -1))}
          aria-label="Mois précédent"
          className="rounded p-1 hover:bg-gray-100"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="font-semibold capitalize">{monthLabel(month)}</p>
        <button
          type="button"
          onClick={() => onMonth(shiftMonth(month, 1))}
          aria-label="Mois suivant"
          className="rounded p-1 hover:bg-gray-100"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthCells(month).map((day, i) => {
          if (!day) return <span key={`pad-${i}`} />;
          const state = dayState(day, today, unavailable);
          const disabled =
            (state === 'past' && !pastSelectable) ||
            (state === 'unavailable' && !unavailableSelectable);
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onDay(day, state)}
              className={`relative flex h-10 items-center justify-center rounded-lg text-sm ${DAY_CLASS[state]} ${
                selected.includes(day) ? 'ring-2 ring-brand-primary' : ''
              } ${disabled ? 'cursor-not-allowed' : 'hover:brightness-95'}`}
            >
              {Number(day.slice(8))}
              {dots.includes(day) && (
                <span className="absolute bottom-1 h-1.5 w-1.5 rounded-full bg-brand-deep" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
