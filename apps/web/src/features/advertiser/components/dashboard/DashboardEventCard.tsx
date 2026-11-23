import { CalendarDays, Clock } from 'lucide-react';
import type { ReactNode } from 'react';

export type EventBadgeTone = 'sport' | 'ramadan' | 'neutral';

const BADGE_TONE: Record<EventBadgeTone, string> = {
  sport: 'bg-blue-50 text-blue-600',
  ramadan: 'bg-amber-50 text-amber-600',
  neutral: 'bg-brand-accent/10 text-brand-accent',
};

interface DashboardEventCardProps {
  /** The poster area (228 px high): an affiche, a match poster or a scene. */
  visual: ReactNode;
  title: string;
  badge: { label: string; tone: EventBadgeTone };
  /** Small grey chips under the title (the event's catégorie…). */
  chips?: string[];
  date?: string;
  hours?: string;
  /** A short line under the date (a reserve, a precision). */
  note?: string | null;
  /** The card's full-width action (a button or a link). */
  action: ReactNode;
}

/**
 * One card of the dashboard's « Événements à venir » row, in the layout of Mariem's Figma capture:
 * the poster, the title with its badge, the chips, the date and hours, a note, then the action
 * pinned to the bottom. Presentational: the row decides what goes in.
 */
export default function DashboardEventCard({
  visual,
  title,
  badge,
  chips = [],
  date,
  hours,
  note,
  action,
}: DashboardEventCardProps) {
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {visual}
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-gray-900">
            {title}
          </h3>
          <span
            className={`flex-shrink-0 rounded px-2 py-0.5 text-xs font-medium ${BADGE_TONE[badge.tone]}`}
          >
            {badge.label}
          </span>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        {(date || hours) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-700">
            {date && (
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" aria-hidden />
                {date}
              </span>
            )}
            {hours && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" aria-hidden />
                {hours}
              </span>
            )}
          </div>
        )}
        {note && <p className="text-xs leading-relaxed text-gray-500">{note}</p>}
        <div className="mt-auto pt-1.5">{action}</div>
      </div>
    </article>
  );
}

/** The dark full-width action of the capture (« Je me positionne »). */
export const EVENT_CARD_ACTION_CLASS =
  'inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg bg-brand-deep px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-deep/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500';
