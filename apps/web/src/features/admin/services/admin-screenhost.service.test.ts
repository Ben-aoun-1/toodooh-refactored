import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock, patch: patchMock } }));

import { adminScreenhostService } from './admin-screenhost.service';

describe('adminScreenhostService', () => {
  beforeEach(() => {
    getMock.mockReset();
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

  const eligibilityView = {
    business_sector_id: null,
    class: null,
    opening_hour: null,
    closing_hour: null,
    broadcast_capacity: null,
    sps: 50,
  };

  it('getEligibility GETs the ADMIN eligibility view', async () => {
    getMock.mockResolvedValue(eligibilityView);
    const result = await adminScreenhostService.getEligibility('a');
    expect(getMock).toHaveBeenCalledWith('/admin/screenhosts/a/eligibility');
    expect(result).toEqual(eligibilityView);
  });

  it('updateEligibility PATCHes the partial body verbatim (null clears ride through)', async () => {
    patchMock.mockResolvedValue({ ...eligibilityView, broadcast_capacity: 40 });
    await adminScreenhostService.updateEligibility('a', {
      broadcast_capacity: 40,
      opening_hour: null,
      closing_hour: null,
    });
    expect(patchMock).toHaveBeenCalledWith('/admin/screenhosts/a/eligibility', {
      broadcast_capacity: 40,
      opening_hour: null,
      closing_hour: null,
    });
  });

  it('updateEligibility propagates apiClient errors (field errors reach the card)', async () => {
    patchMock.mockRejectedValue(new Error('invalid'));
    await expect(
      adminScreenhostService.updateEligibility('a', { business_sector_id: 'x' }),
    ).rejects.toThrow('invalid');
  });
});
