import { beforeEach, describe, expect, it, vi } from 'vitest';

// CF-D1 — pin the live devices wire: the ONE owner-scoped read behind both OwnerScreens and the
// dashboard's screens leg.
const spies = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import { ownerDevicesService } from './owner-devices.service';

beforeEach(() => {
  spies.get.mockReset();
});

describe('ownerDevicesService', () => {
  it('list → GET /screenhosts/screens (server-computed connected, no secrets in the shape)', async () => {
    const rows = [
      {
        id: 's1',
        name: 'Écran 1',
        venue_id: 'v1',
        venue_name: 'Café Aouina',
        last_seen_at: '2026-07-20T10:00:00.000Z',
        connected: true,
        paired_at: '2026-07-01T09:00:00.000Z',
        created_at: '2026-07-01T09:00:00.000Z',
      },
    ];
    spies.get.mockResolvedValue(rows);
    await expect(ownerDevicesService.list()).resolves.toEqual(rows);
    expect(spies.get).toHaveBeenCalledWith('/screenhosts/screens');
  });
});
