import { useEffect, useState } from 'react';

import { logger } from '../../../lib/logger';
import { eventsService } from '../../events/services/events.service';
import type { SpecialEvent } from '../../events/types/event';

const log = logger.child({ module: 'useFeaturedEvents' });

interface UseFeaturedEventsResult {
  events: SpecialEvent[];
  loading: boolean;
  error: Error | null;
}

export function useFeaturedEvents(limit = 3): UseFeaturedEventsResult {
  const [events, setEvents] = useState<SpecialEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await eventsService.getFeaturedEvents(limit);
        if (!cancelled) setEvents(list);
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof Error ? e : new Error(String(e));
        log.error({ error: err }, 'Error loading featured events');
        setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return { events, loading, error };
}
