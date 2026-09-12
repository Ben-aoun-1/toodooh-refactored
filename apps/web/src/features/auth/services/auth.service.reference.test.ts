import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiClient } from '@/lib/api-client';

import { authService } from './auth.service';

// Stub the Supabase module so importing authService (which still imports it for the deferred,
// later-slice methods) doesn't pull in the missing ./database.types at runtime.

// Mock apiClient.get; keep ApiError real (via importActual) for the error-path assertion.
vi.mock('@/lib/api-client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api-client')>();
  return {
    ApiError: actual.ApiError,
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      postForm: vi.fn(),
      onUnauthorized: vi.fn(),
    },
  };
});

const get = vi.mocked(apiClient.get);

describe('authService reference reads (F1 repoint → apiClient)', () => {
  beforeEach(() => get.mockReset());

  it('getGovernorates → GET /governorates, returns the array', async () => {
    const rows = [{ id: 'g1', name: 'Tunis' }];
    get.mockResolvedValue(rows);
    await expect(authService.getGovernorates()).resolves.toEqual(rows);
    expect(get).toHaveBeenCalledWith('/governorates');
  });

  it('getBusinessSectors → GET /business-sectors?audience=advertiser', async () => {
    const rows = [{ id: 's1', name: 'Retail', audience: 'advertiser', display_order: 1 }];
    get.mockResolvedValue(rows);
    await expect(authService.getBusinessSectors()).resolves.toEqual(rows);
    expect(get).toHaveBeenCalledWith('/business-sectors?audience=advertiser');
  });

  it('getOwnerBusinessSectors → GET /business-sectors?audience=owner (no remap)', async () => {
    const rows = [{ id: 's9', name: 'Café', audience: 'owner', display_order: 2 }];
    get.mockResolvedValue(rows);
    await expect(authService.getOwnerBusinessSectors()).resolves.toEqual(rows);
    expect(get).toHaveBeenCalledWith('/business-sectors?audience=owner');
  });

  it('throws a French message when the GET fails', async () => {
    get.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.getGovernorates()).rejects.toThrow(/connexion/i);
  });
});
