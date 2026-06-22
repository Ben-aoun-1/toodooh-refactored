import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock, patch: patchMock } }));

import { screenhostService } from './screenhost.service';

describe('screenhostService', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
  });

  it('getMine GETs /screenhosts/mine and returns the array as-is (no envelope)', async () => {
    const rows = [
      { id: 'a', name: 'Café A', wifi_ssid: 'NET-A', wifi_password_set: true },
      { id: 'b', name: 'Café B', wifi_ssid: null, wifi_password_set: false },
    ];
    getMock.mockResolvedValue(rows);

    const result = await screenhostService.getMine();

    expect(getMock).toHaveBeenCalledWith('/screenhosts/mine');
    expect(result).toEqual(rows);
  });

  it('updateWifi PATCHes /screenhosts/:id/wifi with the patch body and returns the view', async () => {
    const view = { id: 'a', name: 'Café A', wifi_ssid: 'NEW', wifi_password_set: true };
    patchMock.mockResolvedValue(view);

    const result = await screenhostService.updateWifi('a', {
      wifi_ssid: 'NEW',
      wifi_password: 'secret',
    });

    expect(patchMock).toHaveBeenCalledWith('/screenhosts/a/wifi', {
      wifi_ssid: 'NEW',
      wifi_password: 'secret',
    });
    expect(result).toEqual(view);
  });

  it('updateWifi forwards a partial patch verbatim (blank password omitted by the caller)', async () => {
    patchMock.mockResolvedValue({
      id: 'a',
      name: 'Café A',
      wifi_ssid: 'X',
      wifi_password_set: false,
    });

    await screenhostService.updateWifi('a', { wifi_ssid: 'X' });

    expect(patchMock).toHaveBeenCalledWith('/screenhosts/a/wifi', { wifi_ssid: 'X' });
  });

  it('updateWifi forwards an explicit null to clear the password', async () => {
    patchMock.mockResolvedValue({
      id: 'a',
      name: 'Café A',
      wifi_ssid: 'X',
      wifi_password_set: false,
    });

    await screenhostService.updateWifi('a', { wifi_password: null });

    expect(patchMock).toHaveBeenCalledWith('/screenhosts/a/wifi', { wifi_password: null });
  });

  it('propagates apiClient errors (never swallows)', async () => {
    patchMock.mockRejectedValue(new Error('boom'));
    await expect(screenhostService.updateWifi('a', { wifi_password: 'p' })).rejects.toThrow('boom');
  });

  it('revealWifi GETs /screenhosts/:id/wifi/reveal and returns { wifi_password }', async () => {
    getMock.mockResolvedValue({ wifi_password: 'super-secret' });

    const result = await screenhostService.revealWifi('a');

    expect(getMock).toHaveBeenCalledWith('/screenhosts/a/wifi/reveal');
    expect(result).toEqual({ wifi_password: 'super-secret' });
  });

  it('revealWifi surfaces a null password (no password set)', async () => {
    getMock.mockResolvedValue({ wifi_password: null });

    const result = await screenhostService.revealWifi('b');

    expect(getMock).toHaveBeenCalledWith('/screenhosts/b/wifi/reveal');
    expect(result).toEqual({ wifi_password: null });
  });

  it('revealWifi propagates apiClient errors (never swallows)', async () => {
    getMock.mockRejectedValue(new Error('nope'));
    await expect(screenhostService.revealWifi('a')).rejects.toThrow('nope');
  });
});
