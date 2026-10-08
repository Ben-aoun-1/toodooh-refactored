import { CalendarDays, Check, Clock, Loader2, MapPin, Plus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import { useEventCmax, usePositionner } from '../../hooks/useEvents';
import {
  CARD_IMPRESSIONS_LABEL,
  cardBadge,
  cardTitle,
  dateLine,
  kickoffLine,
  roundLine,
} from '../../lib/event-catalogue';
import type { EventItemView } from '../../services/events.api';

import EventPoster from './EventPoster';

const log = logger.child({ module: 'CatalogueEventCard' });
const impressionsFmt = new Intl.NumberFormat('fr-FR');

interface CatalogueEventCardProps {
  event: EventItemView;
  /** « Ma sélection » — omit onToggle where there is no selection (the panier's suggestions). */
  selected?: boolean;
  onToggle?: (eventId: string) => void;
  variant?: 'card' | 'hero';
}

/**
 * EVT-CAT2 — one card of the new « Événements » page (Youssef's validated design): the poster,
 * the title (the event name as typed) + competition/round, the catégorie, the date, the diffusion
 * window, the stadium and the description (ruling 2026-10-08: every admin field shows), its badge, the maximum potential
 * impressions (the match's I_max for this screencaster), « Ajouter à ma sélection » and the direct
 * « Je me positionne ». B1 — a match « à confirmer » is shown but can be neither selected nor
 * positioned.
 */
export default function CatalogueEventCard({
  event,
  selected = false,
  onToggle,
  variant = 'card',
}: CatalogueEventCardProps) {
  const navigate = useNavigate();
  const positionner = usePositionner();
  const { data: cmax } = useEventCmax(event.id);
  const hero = variant === 'hero';
  const positionable = event.positionable ?? event.statut !== 'termine';
  const title = cardTitle(event);
  const badge = cardBadge(event);
  const round = roundLine(event);

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
    <article
      className={`flex overflow-hidden rounded-[18px] border bg-white shadow-[0_1px_2px_rgba(13,43,31,.04),0_8px_24px_-16px_rgba(13,43,31,.18)] ${
        hero ? 'flex-row flex-wrap' : 'flex-col'
      } ${selected ? 'border-brand-primary ring-2 ring-brand-primary' : 'border-[#E1EAE5]'}`}
    >
      <div className={hero ? 'min-w-0 flex-[2_1_520px]' : ''}>
        <EventPoster event={event} variant={variant} />
      </div>
      <div
        className={`flex flex-1 flex-col ${hero ? 'basis-[320px] gap-5 p-7' : 'gap-3.5 px-[18px] pb-5 pt-[18px]'}`}
      >
        <div className="flex flex-col gap-1">
          <p className="text-[16.5px] font-bold leading-snug text-[#0D2B1F]">{title}</p>
          {round && <p className="text-[13.5px] text-[#4F6B60]">{round}</p>}
          {event.category?.trim() && (
            <span className="mt-1 self-start rounded-full bg-[#F2F9F5] px-2.5 py-0.5 text-xs font-semibold text-[#0E6B4E]">
              {event.category}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5 text-[13.5px] text-[#0D2B1F]">
          <span className="flex items-start gap-2 text-[#0D2B1F]">
            <CalendarDays className="mt-px h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
            {dateLine(event)}
          </span>
          <span className="flex items-start gap-2 text-[#0D2B1F]">
            <Clock className="mt-px h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
            {kickoffLine(event)}
          </span>
          {event.stadium?.trim() && (
            <span className="flex items-start gap-2 text-[#0D2B1F]">
              <MapPin className="mt-px h-4 w-4 shrink-0 text-[#1D9E75]" aria-hidden="true" />
              {event.stadium}
            </span>
          )}
          {badge && (
            <span className="self-start rounded-full bg-[#EEEFFE] px-2.5 py-0.5 text-xs font-semibold text-[#3B3FA8]">
              {badge}
            </span>
          )}
        </div>
        {event.description?.trim() && (
          <p className="line-clamp-3 text-[13px] leading-relaxed text-[#4F6B60]">
            {event.description}
          </p>
        )}
        <div
          className={`flex gap-2.5 rounded-xl border border-[#D7ECE0] bg-[#F2F9F5] ${
            hero ? 'flex-col items-start p-[18px]' : 'items-center justify-between px-3.5 py-3'
          }`}
        >
          <span className={`leading-snug text-[#4F6B60] ${hero ? 'text-[13px]' : 'text-[12.5px]'}`}>
            {CARD_IMPRESSIONS_LABEL}
          </span>
          <span
            className={`whitespace-nowrap font-mono text-[#0D2B1F] ${hero ? 'text-[28px]' : 'text-[15px]'}`}
          >
            {cmax ? impressionsFmt.format(cmax.i_max) : '…'}
          </span>
        </div>
        <div className="mt-auto flex flex-col gap-2">
          {onToggle && (
            <button
              type="button"
              onClick={() => onToggle(event.id)}
              disabled={!positionable}
              aria-pressed={selected}
              aria-label={`${selected ? 'Retirer' : 'Ajouter'} ${title} ${selected ? 'de' : 'à'} ma sélection`}
              title={
                positionable
                  ? undefined
                  : 'Disponible dès la confirmation de la date et de l’horaire'
              }
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-[1.5px] text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? 'border-[#1D9E75] bg-[#E6F7EE] text-[#0E6B4E]'
                  : 'border-[#0D2B1F] bg-white text-[#0D2B1F] hover:bg-[#F2F9F5]'
              }`}
            >
              {selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {selected ? 'Dans ma sélection' : 'Ajouter à ma sélection'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handlePositionner()}
            disabled={!positionable || positionner.isPending}
            className={`inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary font-bold text-[#0D2B1F] transition-colors hover:bg-[#A9F2CB] disabled:cursor-not-allowed disabled:bg-[#E3EAE6] disabled:text-[#8AA197] ${
              hero ? 'min-h-[50px] text-[15px]' : 'min-h-[46px] text-[14.5px]'
            }`}
          >
            {positionner.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {positionable ? 'Je me positionne' : 'Bientôt disponible'}
          </button>
        </div>
      </div>
    </article>
  );
}
