import { Sparkles } from 'lucide-react';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { useMyCampaigns } from '@/features/campaigns/hooks/useMyCampaigns';

import { useEventsCatalogue } from '../hooks/useEvents';
import { suggestEventsForCampaigns } from '../lib/event-positioning';

import CatalogueEventCard from './catalogue/CatalogueEventCard';

interface EventSuggestionsBlockProps {
  /** The panier's CLASSIC campaign windows — the proximity rule runs against these. */
  campaignWindows: { start_date: string | null; end_date: string | null }[];
}

/**
 * EV3 (voie 3) — « Suggestions d'événements » on the panier: matches whose kickoff falls inside
 * one of the carted classic campaigns' windows (or ≤ 7 days after its end), top 3 by proximity.
 * EVT-PLAY1 (operator ruling Q3 A) — each suggestion is the Événements page's EVT-CAT2 card
 * (poster, round, date, window, impressions, « Je me positionne »), without « Ma sélection »:
 * the card's own CTA creates the positioning and opens the parcours.
 */
export default function EventSuggestionsBlock({ campaignWindows }: EventSuggestionsBlockProps) {
  const user = useAuthStore((st) => st.user);
  const { data: catalogue } = useEventsCatalogue();
  const { campaigns: myCampaigns } = useMyCampaigns(user?.id);

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
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        {suggestions.map((event) => (
          <CatalogueEventCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
