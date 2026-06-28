import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock, patch: patchMock } }));

import { adminDispatchConfigService } from './admin-dispatch-config.service';

const CONFIG = {
  seuil_diffusable: 1000,
  g_mois: 30,
  jours_actifs: 30,
  r_min_efficace: 1,
  f_max_seconds: 300,
  standard_cpm_tnd: 15,
  event_cpm_tnd: 30,
};

describe('adminDispatchConfigService', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
  });

  it('GET reads /admin/dispatch-config (no /api prefix — apiClient adds BASE)', async () => {
    getMock.mockResolvedValue(CONFIG);
    const result = await adminDispatchConfigService.get();
    expect(getMock).toHaveBeenCalledWith('/admin/dispatch-config');
    expect(result.standard_cpm_tnd).toBe(15);
  });

  it('PATCH sends only the supplied CPM knob and returns the resolved config', async () => {
    patchMock.mockResolvedValue({ ...CONFIG, standard_cpm_tnd: 18.5 });
    const result = await adminDispatchConfigService.patchCpm({ standard_cpm_tnd: 18.5 });
    expect(patchMock).toHaveBeenCalledWith('/admin/dispatch-config', { standard_cpm_tnd: 18.5 });
    expect(result.standard_cpm_tnd).toBe(18.5);
  });

  it('propagates apiClient errors (no swallow)', async () => {
    patchMock.mockRejectedValue(new Error('Validation failed'));
    await expect(adminDispatchConfigService.patchCpm({ event_cpm_tnd: -1 })).rejects.toThrow(
      'Validation failed',
    );
  });
});
