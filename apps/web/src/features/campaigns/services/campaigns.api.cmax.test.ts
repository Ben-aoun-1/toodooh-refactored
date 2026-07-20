import { beforeEach, describe, expect, it, vi } from 'vitest';

// E5 — pin the C_max wire (the wallet.service.test.ts stub pattern): path + shape.
const spies = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import { campaignsApi } from './campaigns.api';

beforeEach(() => {
  spies.get.mockReset();
});

describe('campaignsApi.cmax (E5 — the live ceiling read)', () => {
  it('→ GET /campaigns/:id/cmax, the {c_max_tnd, i_max_facturable, eligible_count} shape', async () => {
    const read = { c_max_tnd: 540, i_max_facturable: 36_000, eligible_count: 1 };
    spies.get.mockResolvedValue(read);
    await expect(campaignsApi.cmax('c1')).resolves.toEqual(read);
    expect(spies.get).toHaveBeenCalledWith('/campaigns/c1/cmax');
  });
});
