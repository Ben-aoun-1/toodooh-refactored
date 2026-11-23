import { Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { windowHours } from '@/features/advertiser/lib/dashboard-events';
import EventPoster from '@/features/events/components/catalogue/EventPoster';
import { usePositionner } from '@/features/events/hooks/useEvents';
import { cardBadge, cardTitle, dateLine, roundLine } from '@/features/events/lib/event-catalogue';
import type { EventItemView } from '@/features/events/services/events.api';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import DashboardEventCard, { EVENT_CARD_ACTION_CLASS } from './DashboardEventCard';

const log = logger.child({ module: 'DashboardMatchCard' });

/**
 * A match of the dashboard's events row: the catalogue's own poster, title, date and badge, and
 * the catalogue's « Je me positionne » (the positioning draft, then its parcours).
 */
export default function DashboardMatchCard({ event }: { event: EventItemView }) {
  const navigate = useNavigate();
  const positionner = usePositionner();
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
    <DashboardEventCard
      visual={<EventPoster event={event} />}
      title={cardTitle(event)}
      badge={{ label: 'Sport', tone: 'sport' }}
      chips={[event.category?.trim(), round].filter((c): c is string => Boolean(c))}
      date={dateLine(event)}
      hours={windowHours(event)}
      note={cardBadge(event)}
      action={
        <button
          type="button"
          onClick={() => void handlePositionner()}
          disabled={positionner.isPending}
          className={EVENT_CARD_ACTION_CLASS}
        >
          {positionner.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Je me positionne
        </button>
      }
    />
  );
}
