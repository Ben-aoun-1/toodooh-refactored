import { Loader2, PartyPopper } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { useMyCampaigns } from '@/features/campaigns/hooks/useMyCampaigns';
import PeriodEventCard from '@/features/events/components/PeriodEventCard';
import { useEventsCatalogue, usePositionner } from '@/features/events/hooks/useEvents';
import {
  PERIOD_SUGGESTION_ADDED,
  PERIOD_SUGGESTION_HEADING,
  suggestEventsForPeriod,
} from '@/features/events/lib/period-suggestions';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'CampaignAddedToCart' });

/**
 * SUGG-1 — the page « Ajouter au panier » lands on (Figma « Lancer une campagne », last frame):
 * the confirmation, then up to 3 events INSIDE the campaign's period (Q3 A) with « Je me
 * positionne », and [Dashboard] / [Voir tous les événements]. No event in the period → straight
 * to the panier, as before (P4 A).
 */
export default function CampaignAddedToCart() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((st) => st.user);
  const { campaigns, loading } = useMyCampaigns(user?.id);
  const { data: catalogue, isLoading: catalogueLoading } = useEventsCatalogue();
  const positionner = usePositionner();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (loading || catalogueLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const campaign = campaigns.find((c) => c.id === campaignId);
  const ownPositioned = new Set(
    campaigns.flatMap((c) => (c.event_id === null ? [] : [c.event_id])),
  );
  const suggestions =
    campaign === undefined
      ? []
      : suggestEventsForPeriod(campaign, catalogue ?? [], new Date(), ownPositioned);
  if (suggestions.length === 0) return <Navigate to="/my-cart" replace />;

  const handlePositionner = async (eventId: string) => {
    setPendingId(eventId);
    try {
      const created = await positionner.mutateAsync(eventId);
      navigate(`/evenements/positionnement/${created.id}`);
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Le positionnement n’a pas pu être créé.');
      log.error({ err: error }, 'period suggestion positionner failed');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-8">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border-8 border-brand-primary/10 bg-white">
          <PartyPopper className="h-6 w-6 text-gray-800" />
        </div>
        <p className="text-lg text-gray-500">{PERIOD_SUGGESTION_ADDED}</p>
      </div>
      <h2 className="text-center text-lg font-medium text-gray-900">{PERIOD_SUGGESTION_HEADING}</h2>
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.map((event) => (
          <PeriodEventCard
            key={event.id}
            event={event}
            pending={pendingId === event.id}
            disabled={positionner.isPending}
            onPositionner={(id) => void handlePositionner(id)}
          />
        ))}
      </div>
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="rounded-lg border border-gray-200 bg-white py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => navigate('/evenements')}
          className="rounded-lg bg-brand-primary py-2.5 text-sm font-medium text-brand-deep transition-colors hover:bg-brand-primary/90"
        >
          Voir tous les événements
        </button>
      </div>
    </div>
  );
}
