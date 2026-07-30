import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';

import { type SuggestMatchInput, eventsApi } from '../services/events.api';

import { eventsKeys } from './queryKeys';

/** The official catalogue (GET /api/events). */
export function useEventsCatalogue() {
  return useQuery({
    queryKey: eventsKeys.catalogue(),
    queryFn: () => eventsApi.catalogue(),
    select: (d) => d.events,
  });
}

/** The shared suggestion list (GET /api/events/suggested) — fetched when « Voir plus » opens. */
export function useSuggestedEvents(enabled: boolean) {
  return useQuery({
    queryKey: eventsKeys.suggested(),
    queryFn: () => eventsApi.suggested(),
    select: (d) => d.events,
    enabled,
  });
}

/** « Suggérer un match » — a success lands in the SHARED list, so that cache refreshes. */
export function useSuggestMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SuggestMatchInput) => eventsApi.suggest(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventsKeys.suggested() });
    },
  });
}

/**
 * EV3 — « Je me positionne »: create the positioning DRAFT (POST /:id/positionner). The caller
 * navigates into the parcours with the created row; the campaign list cache refreshes so the
 * new Brouillon shows up in Mes campagnes immediately.
 */
export function usePositionner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => eventsApi.positionner(eventId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.all });
    },
  });
}

/** A card's presigned affiche URL — idle until the card declares it has an image. */
export function useEventImageUrl(eventId: string, hasImage: boolean) {
  return useQuery({
    queryKey: eventsKeys.imageUrl(eventId),
    queryFn: () => eventsApi.imageUrl(eventId),
    enabled: hasImage,
  });
}
