import { useMutation, useQueryClient } from '@tanstack/react-query';

import { screensService } from '@/features/screens/services/screens.service';

import { screensKeys } from './queryKeys';
import type { CreateUnavailabilityPeriodInput } from './useCreateUnavailabilityPeriod';

/**
 * The pre-computed batch for one OwnerCalendarDevices availability change.
 * The page derives these arrays from the selected dates / establishments
 * (client state); this mutation only executes the writes.
 */
export interface CalendarAvailabilityBatch {
  toCreate: CreateUnavailabilityPeriodInput[];
  screensToSetUnavailable: string[];
  periodsToDelete: string[];
  screenIdsToActivate: string[];
}

/**
 * Applies a calendar availability change for OwnerCalendarDevices: creates
 * unavailability periods, flips screen statuses, deletes periods — whichever
 * the batch contains. onSuccess invalidates `screensKeys.all` (screens and
 * periods both changed).
 */
export function useCalendarAvailability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batch: CalendarAvailabilityBatch) => {
      if (batch.toCreate.length > 0) {
        await Promise.all(
          batch.toCreate.map((payload) => screensService.createUnavailabilityPeriod(payload)),
        );
      }
      if (batch.screensToSetUnavailable.length > 0) {
        await Promise.all(
          batch.screensToSetUnavailable.map((id) =>
            screensService.updateScreen(id, { status: 'unavailable' }),
          ),
        );
      }
      if (batch.periodsToDelete.length > 0) {
        await Promise.all(
          batch.periodsToDelete.map((id) => screensService.deleteUnavailabilityPeriod(id)),
        );
      }
      if (batch.screenIdsToActivate.length > 0) {
        await Promise.all(
          batch.screenIdsToActivate.map((id) =>
            screensService.updateScreen(id, { status: 'active' }),
          ),
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: screensKeys.all });
    },
  });
}
