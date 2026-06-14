import { beforeEach, describe, expect, it, vi } from 'vitest';

const { patchMock } = vi.hoisted(() => ({ patchMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { patch: patchMock } }));

import { adminScreenhostService } from './admin-screenhost.service';

describe('adminScreenhostService', () => {
  beforeEach(() => {
    patchMock.mockReset();
  });

  it('updateWifi PATCHes the ADMIN path /admin/screenhosts/:id/wifi (not the owner path)', async () => {
    const view = { id: 'a', name: 'Café', wifi_ssid: 'NEW', wifi_password_set: true };
    patchMock.mockResolvedValue(view);

    const result = await adminScreenhostService.updateWifi('a', {
      wifi_ssid: 'NEW',
      wifi_password: 'p',
    });

    expect(patchMock).toHaveBeenCalledWith('/admin/screenhosts/a/wifi', {
      wifi_ssid: 'NEW',
      wifi_password: 'p',
    });
    expect(result).toEqual(view);
  });

  it('forwards a partial patch verbatim', async () => {
    patchMock.mockResolvedValue({
      id: 'a',
      name: 'Café',
      wifi_ssid: 'X',
      wifi_password_set: false,
    });
    await adminScreenhostService.updateWifi('a', { wifi_ssid: 'X' });
    expect(patchMock).toHaveBeenCalledWith('/admin/screenhosts/a/wifi', { wifi_ssid: 'X' });
  });

  it('propagates apiClient errors (never swallows)', async () => {
    patchMock.mockRejectedValue(new Error('boom'));
    await expect(adminScreenhostService.updateWifi('a', { wifi_password: 'p' })).rejects.toThrow(
      'boom',
    );
  });
});
