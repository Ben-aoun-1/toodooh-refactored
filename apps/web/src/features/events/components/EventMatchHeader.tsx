import { Calendar, Radio } from 'lucide-react';

import {
  STATUT_CHIP_CLASSES,
  STATUT_LABELS,
  WINDOW_LINE,
  formatEventDate,
  formatEventHours,
} from '../lib/event-display';
import type { EventItemView } from '../services/events.api';

interface EventMatchHeaderProps {
  /** The positioned match; null while the catalogue loads (or the row aged out of it). */
  event: EventItemView | null;
  /** The positioning row's name — the fallback identity when the event is not loadable. */
  campaignName: string;
}

/**
 * EV3 — the match récap PINNED on top of every parcours step: name, date | horaire (Tunis), the
 * derived-status chip and the ± 1 h window line. The window is always the API-derived one (never
 * recomputed client-side); when the event row is unavailable the header degrades to the
 * positioning's snapshotted identity.
 */
export default function EventMatchHeader({ event, campaignName }: EventMatchHeaderProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Positionnement sur événement
          </p>
          <h2 className="mt-0.5 truncate text-lg font-bold text-gray-900">
            {event?.name ?? campaignName}
          </h2>
        </div>
        {event && (
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${STATUT_CHIP_CLASSES[event.statut]}`}
          >
            {STATUT_LABELS[event.statut]}
          </span>
        )}
      </div>
      {event && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-[#5C5C5C]">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 shrink-0" />
            {formatEventDate(event.kickoff_at)}
            <span className="text-gray-300">|</span>
            {formatEventHours(event.kickoff_at, event.ends_at)}
          </span>
          <span className="flex items-center gap-1.5">
            <Radio className="h-4 w-4 shrink-0" />
            {WINDOW_LINE}
          </span>
        </div>
      )}
    </div>
  );
}
