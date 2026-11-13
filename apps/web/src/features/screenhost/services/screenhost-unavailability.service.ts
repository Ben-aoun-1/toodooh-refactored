import type { RedispatchedShare } from '@/features/screenhost/lib/diffusion-calendar';
import type { UnavailabilityView } from '@/features/screenhost/lib/hour-unavailability';
import { apiClient } from '@/lib/api-client';

// E2 → HOUR-UNAV1 — the owner's availability wire, by the HOUR. VENUE-level only; future-only
// writes (the api refuses PAST_OR_TODAY); idempotent both directions.

export interface ToggleResult {
  screenhost_id: string;
  day: string;
  hours: number[] | null;
  unavailable: boolean;
  redispatched: RedispatchedShare[];
}

export const screenhostUnavailabilityService = {
  /** Whole unavailable days, every unavailable hour and the venue's window, over [from, to]. */
  list(screenhostId: string, from: string, to: string): Promise<UnavailabilityView> {
    return apiClient.get<UnavailabilityView>(
      `/screenhosts/${screenhostId}/unavailability?from=${from}&to=${to}`,
    );
  },
  /**
   * Declare (unavailable: true) or free some HOURS of one future opening day — no `hours` = the
   * whole day. CAL-1: a declaration returns what the api moved (créneaux and event slots of those
   * hours → re-placed elsewhere).
   */
  toggle(
    screenhostId: string,
    day: string,
    unavailable: boolean,
    hours?: readonly number[],
  ): Promise<ToggleResult> {
    return apiClient.put(`/screenhosts/${screenhostId}/unavailability`, {
      day,
      unavailable,
      ...(hours ? { hours } : {}),
    });
  },
};
