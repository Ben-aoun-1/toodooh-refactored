import { useMutation, useQueryClient } from '@tanstack/react-query';

import { screensService } from '@/features/screens/services/screens.service';

import { screensKeys } from './queryKeys';

/** The payload accepted by `screensService.createUnavailabilityPeriod`. */
export type CreateUnavailabilityPeriodInput = Parameters<
  typeof screensService.createUnavailabilityPeriod
>[0];

/**
 * Creates a screen unavailability period (used by ScreenCalendar). onSuccess
 * invalidates `screensKeys.all` — the new period shows in both screens
 * composites.
 */
export function useCreateUnavailabilityPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUnavailabilityPeriodInput) =>
      screensService.createUnavailabilityPeriod(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: screensKeys.all });
    },
  });
}
