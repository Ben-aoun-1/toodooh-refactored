import { Calendar, Loader2, TrendingUp } from 'lucide-react';

import matchImg from '@/assets/match.png';

import { useEventCmax, useEventImageUrl } from '../hooks/useEvents';
import { POSITIONNE_CTA, formatEventDate, formatEventHours } from '../lib/event-display';
import {
  PERIOD_SUGGESTION_NOTE,
  formatApproxImpressions,
  sectorTags,
} from '../lib/period-suggestions';
import type { EventItemView } from '../services/events.api';

interface PeriodEventCardProps {
  event: EventItemView;
  pending: boolean;
  disabled: boolean;
  onPositionner: (eventId: string) => void;
}

/**
 * SUGG-1 — one event card of the cart-add page (Figma « Lancer une campagne », last frame):
 * affiche, name + type badge, the venue pool's sector tags, date | hours, « ~ N impressions »
 * (the match's I_max for this advertiser), the auto-inclusion note, « Je me positionne ».
 */
export default function PeriodEventCard({
  event,
  pending,
  disabled,
  onPositionner,
}: PeriodEventCardProps) {
  const { data: image } = useEventImageUrl(event.id, event.has_image);
  const { data: cmax } = useEventCmax(event.id);
  const tags = sectorTags(cmax?.sectors ?? []);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
      <img
        src={image?.url ?? matchImg}
        alt={event.name}
        className="h-32 w-full bg-gray-100 object-cover"
      />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug text-gray-900">{event.name}</h3>
          {/* The event's own catégorie (Figma: Sport / Ramadan / Culture) — no fixed « Sport ». */}
          {event.category?.trim() && (
            <span className="shrink-0 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {event.category}
            </span>
          )}
        </div>
        {tags.shown.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.shown.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-700"
              >
                {tag}
              </span>
            ))}
            {tags.extra > 0 && (
              <span className="rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                +{tags.extra}
              </span>
            )}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-xs text-gray-600">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          {formatEventDate(event.kickoff_at)}
          <span className="text-gray-300">|</span>
          {formatEventHours(event.kickoff_at, event.ends_at)}
        </p>
        {cmax !== undefined && (
          <p className="flex items-center gap-1.5 text-xs text-gray-600">
            <TrendingUp className="h-3.5 w-3.5 shrink-0" />
            {formatApproxImpressions(cmax.i_max)}
          </p>
        )}
        <p className="text-xs text-gray-500">{PERIOD_SUGGESTION_NOTE}</p>
        <div className="mt-auto pt-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPositionner(event.id)}
            className="w-full rounded-lg bg-gray-900 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-60"
          >
            {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : POSITIONNE_CTA}
          </button>
        </div>
      </div>
    </div>
  );
}
