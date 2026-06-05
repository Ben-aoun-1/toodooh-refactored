import { describe, it, expect, vi, beforeEach } from 'vitest';

// Slice-2 E — mock the apiClient and assert the establishment service's call shape + unwrapping.
const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock, post: postMock } }));

import { establishmentService } from './establishment.service';

describe('establishmentService', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('list() GETs /establishments and unwraps { establishments }', async () => {
    const rows = [{ id: 'e1', name: 'A' }];
    getMock.mockResolvedValue({ establishments: rows });
    const result = await establishmentService.list();
    expect(getMock).toHaveBeenCalledWith('/establishments');
    expect(result).toBe(rows);
  });

  it('create() POSTs /establishments with the body and unwraps { establishment }', async () => {
    const input = { name: 'Café', latitude: 36.8, longitude: 10.1, screen_count: 2 };
    const created = { id: 'e2', ...input };
    postMock.mockResolvedValue({ establishment: created });
    const result = await establishmentService.create(input);
    expect(postMock).toHaveBeenCalledWith('/establishments', input);
    expect(result).toEqual(created);
  });

  it('propagates apiClient errors (no swallow → the page surfaces the server message)', async () => {
    postMock.mockRejectedValue(new Error('Latitude invalide'));
    await expect(
      establishmentService.create({ name: 'X', latitude: 91, longitude: 0, screen_count: 1 }),
    ).rejects.toThrow('Latitude invalide');
  });
});
