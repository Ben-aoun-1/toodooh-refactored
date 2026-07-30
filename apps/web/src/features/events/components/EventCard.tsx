import { Calendar, Loader2, Radio } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import matchImg from '@/assets/match.png';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import { useEventImageUrl, usePositionner } from '../hooks/useEvents';
import {
  POSITIONNE_CTA,
  STATUT_CHIP_CLASSES,
  STATUT_LABELS,
  SUGGESTED_BADGE,
  WINDOW_LINE,
  formatEventDate,
  formatEventHours,
} from '../lib/event-display';
import type { EventItemView } from '../services/events.api';

interface EventCardProps {
  event: EventItemView;
}

const log = logger.child({ module: 'EventCard' });

/**
 * The match card (Figma « Mes événements »): affiche (or the default stadium), name + Sport chip,
 * catégorie chip, date | horaire (Tunis), the derived-status chip, the ± 1 h window line, and the
 * EV3 « Je me positionne » CTA — LIVE now (the disabled « Bientôt disponible » pin retired):
 * it creates the positioning draft and opens the 3-step parcours. Terminé cards keep a disabled
 * CTA (a finished match is not positionable — the api would 409 anyway).
 */
export default function EventCard({ event }: EventCardProps) {
  const navigate = useNavigate();
  const { data: image } = useEventImageUrl(event.id, event.has_image);
  const positionner = usePositionner();

  const positionable = event.statut !== 'termine';
  const handlePositionner = async () => {
    try {
      const created = await positionner.mutateAsync(event.id);
      navigate(`/evenements/positionnement/${created.id}`);
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Le positionnement n’a pas pu être créé.');
      log.error({ err: error }, 'positionner failed');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
      <img
        src={image?.url ?? matchImg}
        alt={event.name}
        className="h-40 w-full object-cover bg-gray-100"
      />
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-[#171717] leading-snug">{event.name}</h3>
          <span className="shrink-0 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
            Sport
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {event.category !== null && event.category !== '' && (
            <span className="px-2 py-0.5 rounded-md text-xs bg-gray-100 text-gray-700 border border-gray-200">
              {event.category}
            </span>
          )}
          <span
            className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUT_CHIP_CLASSES[event.statut]}`}
          >
            {STATUT_LABELS[event.statut]}
          </span>
          {event.source === 'suggested' && (
            <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-800">
              {SUGGESTED_BADGE}
            </span>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-sm text-[#5C5C5C]">
          <Calendar className="h-4 w-4 shrink-0" />
          {formatEventDate(event.kickoff_at)}
          <span className="text-gray-300">|</span>
          {formatEventHours(event.kickoff_at, event.ends_at)}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-[#5C5C5C]">
          <Radio className="h-4 w-4 shrink-0" />
          {WINDOW_LINE}
        </p>
        {event.description !== null && event.description !== '' && (
          <p className="text-xs text-[#8A8A8A] line-clamp-2">{event.description}</p>
        )}
        <div className="mt-auto pt-2">
          <button
            type="button"
            disabled={!positionable || positionner.isPending}
            onClick={() => void handlePositionner()}
            className={`w-full rounded-lg py-2.5 text-sm font-medium transition-colors ${
              positionable
                ? 'bg-brand-primary text-brand-deep hover:bg-brand-primary/90 disabled:opacity-60'
                : 'cursor-not-allowed bg-gray-200 text-gray-500'
            }`}
          >
            {positionner.isPending ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              POSITIONNE_CTA
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
