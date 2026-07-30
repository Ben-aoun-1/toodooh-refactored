import { CalendarClock, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { useMyCampaigns } from '@/features/campaigns/hooks/useMyCampaigns';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import { useEventsCatalogue, usePositionner } from '../hooks/useEvents';
import { POSITIONNE_CTA, formatEventDate, formatEventHours } from '../lib/event-display';
import { suggestEventsForCampaigns } from '../lib/event-positioning';

const log = logger.child({ module: 'EventSuggestionsBlock' });

interface EventSuggestionsBlockProps {
  /** The panier's CLASSIC campaign windows — the proximity rule runs against these. */
  campaignWindows: { start_date: string | null; end_date: string | null }[];
}

/**
 * EV3 (voie 3) — « Suggestions d'événements » on the panier: matches whose kickoff falls inside
 * one of the carted classic campaigns' windows (or ≤ 7 days after its end), top 3 by proximity.
 * « Je me positionne » creates the positioning draft and opens the parcours — the fresh
 * suggestion becomes a positioning without leaving the flow.
 */
export default function EventSuggestionsBlock({ campaignWindows }: EventSuggestionsBlockProps) {
  const navigate = useNavigate();
  const user = useAuthStore((st) => st.user);
  const { data: catalogue } = useEventsCatalogue();
  const { campaigns: myCampaigns } = useMyCampaigns(user?.id);
  const positionner = usePositionner();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // EV3 amendment (ratified) — the advertiser's OWN positionings (any status, carted included)
  // exclude their matches from the block; other advertisers' positionings never do.
  const ownPositioned = new Set(
    myCampaigns.flatMap((c) => (c.event_id === null ? [] : [c.event_id])),
  );
  const suggestions = suggestEventsForCampaigns(
    campaignWindows,
    catalogue ?? [],
    new Date(),
    ownPositioned,
  );
  if (campaignWindows.length === 0 || suggestions.length === 0) return null;

  const handlePositionner = async (eventId: string) => {
    setPendingId(eventId);
    try {
      const created = await positionner.mutateAsync(eventId);
      navigate(`/evenements/positionnement/${created.id}`);
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Le positionnement n’a pas pu être créé.');
      log.error({ err: error }, 'suggestion positionner failed');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-brand-primary/30 bg-brand-primary/5 p-5">
      <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
        <Sparkles className="h-4 w-4 text-brand-deep" />
        Suggestions d’événements
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        Ces matchs se jouent pendant (ou juste après) vos campagnes — positionnez-vous sur leur
        fenêtre de diffusion.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {suggestions.map((event) => (
          <div
            key={event.id}
            className="flex flex-col rounded-xl border border-gray-200 bg-white p-4"
          >
            <p className="text-sm font-semibold text-gray-900">{event.name}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#5C5C5C]">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              {formatEventDate(event.kickoff_at)} ·{' '}
              {formatEventHours(event.kickoff_at, event.ends_at)}
            </p>
            <button
              type="button"
              disabled={positionner.isPending}
              onClick={() => void handlePositionner(event.id)}
              className="mt-3 rounded-lg bg-brand-primary py-2 text-sm font-medium text-brand-deep transition-colors hover:bg-brand-primary/90 disabled:opacity-60"
            >
              {pendingId === event.id ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                POSITIONNE_CTA
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
