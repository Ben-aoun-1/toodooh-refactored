import { describe, expect, it, vi } from 'vitest';

import { screenhostUnavailabilityService } from '@/features/screenhost/services/screenhost-unavailability.service';
import { apiClient } from '@/lib/api-client';

import { applyOptimisticToggle } from './useScreenhostUnavailability';

// E2 — the optimistic toggle's pure step (the react-query wiring rolls back via the standard
// onError context) + the service wire shapes. No render harness in web — the seams are pinned.

describe('applyOptimisticToggle', () => {
  it('declaring inserts deduped and sorted; undeclaring removes; others untouched', () => {
    expect(applyOptimisticToggle(['2026-08-03'], '2026-08-01', true)).toEqual([
      '2026-08-01',
      '2026-08-03',
    ]);
    expect(applyOptimisticToggle(['2026-08-03'], '2026-08-03', true)).toEqual(['2026-08-03']);
    expect(applyOptimisticToggle(['2026-08-01', '2026-08-03'], '2026-08-03', false)).toEqual([
      '2026-08-01',
    ]);
    expect(applyOptimisticToggle([], '2026-08-05', false)).toEqual([]);
  });
});

describe('the service wire', () => {
  it('list GETs the range and unwraps {days}; toggle PUTs {day, unavailable}', async () => {
    const getMock = vi.spyOn(apiClient, 'get').mockResolvedValue({ days: ['2026-08-01'] } as never);
    const putMock = vi.spyOn(apiClient, 'put').mockResolvedValue({} as never);

    await expect(
      screenhostUnavailabilityService.list('sh1', '2026-08-01', '2026-08-31'),
    ).resolves.toEqual(['2026-08-01']);
    expect(getMock).toHaveBeenCalledWith(
      '/screenhosts/sh1/unavailability?from=2026-08-01&to=2026-08-31',
    );

    await screenhostUnavailabilityService.toggle('sh1', '2026-08-05', true);
    expect(putMock).toHaveBeenCalledWith('/screenhosts/sh1/unavailability', {
      day: '2026-08-05',
      unavailable: true,
    });
    vi.restoreAllMocks();
  });
});
