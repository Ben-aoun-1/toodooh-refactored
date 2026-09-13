import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock, delMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  delMock: vi.fn(),
}));
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { get: getMock, post: postMock, del: delMock } };
});

import { ApiError } from '@/lib/api-client';

import { adminSimulatorService, isSimulatorDisabled } from './admin-simulator.service';

describe('adminSimulatorService', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    delMock.mockReset();
  });

  it('list → GET /admin/simulations (no /api prefix — apiClient adds BASE)', async () => {
    getMock.mockResolvedValue({ simulations: [], max: 5 });
    const r = await adminSimulatorService.list();
    expect(getMock).toHaveBeenCalledWith('/admin/simulations');
    expect(r.max).toBe(5);
  });

  it('create → POST with name and the optional virtual_start', async () => {
    postMock.mockResolvedValue({ id: 's1', status: 'creating' });
    await adminSimulatorService.create({ name: 'Monde 1' });
    expect(postMock).toHaveBeenCalledWith('/admin/simulations', { name: 'Monde 1' });
    await adminSimulatorService.create({
      name: 'Monde 2',
      virtual_start: '2026-03-01T08:00:00.000Z',
    });
    expect(postMock).toHaveBeenLastCalledWith('/admin/simulations', {
      name: 'Monde 2',
      virtual_start: '2026-03-01T08:00:00.000Z',
    });
  });

  it('get / probe / remove hit the id routes', async () => {
    getMock.mockResolvedValue({});
    delMock.mockResolvedValue(undefined);
    await adminSimulatorService.get('s1');
    await adminSimulatorService.probe('s1');
    await adminSimulatorService.remove('s1');
    expect(getMock).toHaveBeenNthCalledWith(1, '/admin/simulations/s1');
    expect(getMock).toHaveBeenNthCalledWith(2, '/admin/simulations/s1/probe');
    expect(delMock).toHaveBeenCalledWith('/admin/simulations/s1');
  });

  it('propagates apiClient errors (no swallow)', async () => {
    postMock.mockRejectedValue(new Error('Validation failed'));
    await expect(adminSimulatorService.create({ name: '' })).rejects.toThrow('Validation failed');
  });

  it('isSimulatorDisabled recognises the 503 SIMULATOR_DISABLED refusal only', () => {
    expect(
      isSimulatorDisabled(new ApiError({ status: 503, code: 'SIMULATOR_DISABLED', message: '' })),
    ).toBe(true);
    expect(isSimulatorDisabled(new ApiError({ status: 503, code: 'OTHER', message: '' }))).toBe(
      false,
    );
    expect(
      isSimulatorDisabled(new ApiError({ status: 200, code: 'SIMULATOR_DISABLED', message: '' })),
    ).toBe(false);
    expect(isSimulatorDisabled(new Error('x'))).toBe(false);
  });
});
