import { apiClient } from '@/lib/api-client';

// E2 (VF jours_dispo_i) — the owner's per-day unavailability wire. VENUE-level only; future-only
// writes (the api refuses PAST_OR_TODAY); idempotent both directions.

export const screenhostUnavailabilityService = {
  /** The declared days in [from, to] (ISO dates), sorted. */
  list(screenhostId: string, from: string, to: string): Promise<string[]> {
    return apiClient
      .get<{ days: string[] }>(`/screenhosts/${screenhostId}/unavailability?from=${from}&to=${to}`)
      .then((r) => r.days);
  },
  /** Declare (unavailable: true) or undeclare one FUTURE day. */
  toggle(
    screenhostId: string,
    day: string,
    unavailable: boolean,
  ): Promise<{ screenhost_id: string; day: string; unavailable: boolean }> {
    return apiClient.put(`/screenhosts/${screenhostId}/unavailability`, { day, unavailable });
  },
};
