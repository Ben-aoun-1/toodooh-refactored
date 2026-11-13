import { describe, expect, it, vi } from 'vitest';

import { screenhostUnavailabilityService } from '@/features/screenhost/services/screenhost-unavailability.service';
import { apiClient } from '@/lib/api-client';

// E2 → HOUR-UNAV1 — the service wire shapes (the optimistic step is lib/hour-unavailability's
// applyHoursToggle, pinned there). No render harness in web — the seams are pinned.

describe('the service wire', () => {
  it('list GETs the range and returns the view; toggle PUTs {day, unavailable, hours?}', async () => {
    const view = { days: ['2026-08-01'], hours: [], opening_hour: 8, closing_hour: 18 };
    const getMock = vi.spyOn(apiClient, 'get').mockResolvedValue(view as never);
    const putMock = vi.spyOn(apiClient, 'put').mockResolvedValue({} as never);

    await expect(
      screenhostUnavailabilityService.list('sh1', '2026-08-01', '2026-08-31'),
    ).resolves.toEqual(view);
    expect(getMock).toHaveBeenCalledWith(
      '/screenhosts/sh1/unavailability?from=2026-08-01&to=2026-08-31',
    );

    await screenhostUnavailabilityService.toggle('sh1', '2026-08-05', true);
    expect(putMock).toHaveBeenCalledWith('/screenhosts/sh1/unavailability', {
      day: '2026-08-05',
      unavailable: true,
    });
    await screenhostUnavailabilityService.toggle('sh1', '2026-08-05', false, [14, 15]);
    expect(putMock).toHaveBeenLastCalledWith('/screenhosts/sh1/unavailability', {
      day: '2026-08-05',
      unavailable: false,
      hours: [14, 15],
    });
    vi.restoreAllMocks();
  });
});
