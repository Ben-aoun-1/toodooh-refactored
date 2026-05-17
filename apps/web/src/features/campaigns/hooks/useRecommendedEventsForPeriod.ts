import { useQuery } from '@tanstack/react-query';

import type { SpecialEvent } from '@/features/events/types/event';
import { supabase } from '@/lib/supabase';

import { campaignsKeys } from './queryKeys';

interface UseRecommendedEventsOptions {
  /** Gate the fetch — the wizard only needs this once the post-cart step shows. */
  enabled?: boolean;
}

/**
 * Special events overlapping a campaign's diffusion period — the post-cart
 * step's "events to come" recommendations (`NewCampaign`).
 *
 * Commit 7b — folded in from 7a's CF-10 §5.1. The period-overlap +
 * exclude-current-event + top-3 filter is campaign-flow-specific (not a
 * generic events list), so the hook lives under `campaigns/` (D6 — the read
 * is wizard logic, not an `events.service` method). The former
 * `loadRecommendedEventsForSelectedPeriod` was triggered imperatively from
 * `handleAddToCart`; here the consumer gates it with `enabled`.
 */
export function useRecommendedEventsForPeriod(
  startDate: Date | null,
  endDate: Date | null,
  excludeEventId: string | null,
  { enabled = true }: UseRecommendedEventsOptions = {},
): {
  events: SpecialEvent[];
  loading: boolean;
} {
  const startIso = startDate ? startDate.toISOString() : '';
  const endIso = endDate ? endDate.toISOString() : '';

  const query = useQuery({
    queryKey: campaignsKeys.recommendedEvents(startIso, endIso, excludeEventId ?? ''),
    queryFn: async (): Promise<SpecialEvent[]> => {
      let request = supabase
        .from('special_events')
        .select('*')
        .eq('is_active', true)
        .lte('start_date', endIso)
        .gte('end_date', startIso)
        .order('start_date', { ascending: true })
        .limit(3);

      if (excludeEventId) {
        request = request.neq('id', excludeEventId);
      }

      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []) as SpecialEvent[];
    },
    enabled: enabled && Boolean(startDate && endDate),
  });

  return {
    events: query.data ?? [],
    loading: query.isLoading,
  };
}
