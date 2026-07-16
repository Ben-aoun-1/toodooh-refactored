import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock, patch: patchMock } }));

import {
  adminDispatchConfigService,
  attentionOrderingValid,
  parseAttention,
} from './admin-dispatch-config.service';

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

// ── E1 — the admin T inputs mirror the server rules ((0, 1] + t_10s ≤ t_20s ≤ t_30s) ────────────
describe('parseAttention ((0, 1] — a discount, never a boost)', () => {
  it('accepts the open-zero/closed-one interval', () => {
    expect(parseAttention('0.6')).toBe(0.6);
    expect(parseAttention('1')).toBe(1);
    expect(parseAttention('0.01')).toBe(0.01);
  });

  it('rejects zero, negatives, above one and non-numbers', () => {
    expect(parseAttention('0')).toBeNull();
    expect(parseAttention('-0.5')).toBeNull();
    expect(parseAttention('1.01')).toBeNull();
    expect(parseAttention('abc')).toBeNull();
    expect(parseAttention('')).toBeNull();
  });
});

describe('attentionOrderingValid (t_10s ≤ t_20s ≤ t_30s)', () => {
  it('accepts ordered (incl. equal) buckets, rejects any inversion', () => {
    expect(attentionOrderingValid(0.6, 0.7, 0.8)).toBe(true);
    expect(attentionOrderingValid(0.7, 0.7, 0.7)).toBe(true);
    expect(attentionOrderingValid(0.8, 0.7, 0.9)).toBe(false);
    expect(attentionOrderingValid(0.6, 0.9, 0.8)).toBe(false);
  });
});
