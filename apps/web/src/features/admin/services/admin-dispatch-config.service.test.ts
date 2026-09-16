import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock, patch: patchMock } }));

import {
  adminDispatchConfigService,
  attentionOrderingValid,
  composeAttentionPatch,
  composeCpmPatch,
  composeLeadPatch,
  composeReversementPatch,
  parseAttention,
  parseCampaignLead,
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

// ── CF-D1 — the campaign lead input mirrors the server bounds (integer in [1, 30]) ──────────────
describe('parseCampaignLead (integer jours ouvrés in [1, 30])', () => {
  it('accepts the bounds — 1 and 30 — and the default 2', () => {
    expect(parseCampaignLead('1')).toBe(1);
    expect(parseCampaignLead('2')).toBe(2);
    expect(parseCampaignLead('30')).toBe(30);
  });

  it('LEAD-1 — rejects 0 (a same-day start), negatives, above 30, non-integers and non-numbers', () => {
    expect(parseCampaignLead('0')).toBeNull();
    expect(parseCampaignLead('-1')).toBeNull();
    expect(parseCampaignLead('31')).toBeNull();
    expect(parseCampaignLead('2.5')).toBeNull();
    expect(parseCampaignLead('abc')).toBeNull();
    expect(parseCampaignLead('')).toBeNull();
  });
});

// ── CPM-ADMIN (Mejri 05/08) — per-block patch composition: refusal or MINIMAL diff, never silence ─
describe('composeCpmPatch (per-block save — CPM)', () => {
  const cfg = { standard_cpm_tnd: 15, event_cpm_tnd: 30 };

  it('refuses a non-positive or non-numeric CPM (both fields must parse)', () => {
    expect(composeCpmPatch({ standard: '0', event: '30' }, cfg).ok).toBe(false);
    expect(composeCpmPatch({ standard: '15', event: '-1' }, cfg).ok).toBe(false);
    expect(composeCpmPatch({ standard: '', event: '30' }, cfg).ok).toBe(false);
    expect(composeCpmPatch({ standard: 'abc', event: '30' }, cfg).ok).toBe(false);
  });

  it('diffs only the changed knob — an untouched field never rides the PATCH', () => {
    const r = composeCpmPatch({ standard: '18.5', event: '30' }, cfg);
    expect(r).toEqual({ ok: true, patch: { standard_cpm_tnd: 18.5 } });
  });

  it('nothing changed → an EMPTY patch (the page toasts « Aucune modification »)', () => {
    expect(composeCpmPatch({ standard: '15', event: '30' }, cfg)).toEqual({ ok: true, patch: {} });
  });
});

describe('composeLeadPatch (per-block save — délai de lancement)', () => {
  const cfg = { campaign_lead_working_days: 2 };

  it('refuses out-of-bounds and non-integer leads', () => {
    expect(composeLeadPatch({ lead: '-1' }, cfg).ok).toBe(false);
    expect(composeLeadPatch({ lead: '31' }, cfg).ok).toBe(false);
    expect(composeLeadPatch({ lead: '2.5' }, cfg).ok).toBe(false);
    expect(composeLeadPatch({ lead: '' }, cfg).ok).toBe(false);
  });

  it('1 is the lowest legal edit, 0 is refused (LEAD-1); unchanged → empty patch', () => {
    expect(composeLeadPatch({ lead: '1' }, cfg)).toEqual({
      ok: true,
      patch: { campaign_lead_working_days: 1 },
    });
    expect(composeLeadPatch({ lead: '0' }, cfg).ok).toBe(false);
    expect(composeLeadPatch({ lead: '2' }, cfg)).toEqual({ ok: true, patch: {} });
  });
});

describe('composeAttentionPatch (per-block save — indice T)', () => {
  const cfg = { t_10s: 0.6, t_20s: 0.7, t_30s: 0.8 };

  it('refuses values out of (0, 1] and nonsense orderings', () => {
    expect(composeAttentionPatch({ t10: '0', t20: '0.7', t30: '0.8' }, cfg).ok).toBe(false);
    expect(composeAttentionPatch({ t10: '0.6', t20: '1.01', t30: '0.8' }, cfg).ok).toBe(false);
    const inverted = composeAttentionPatch({ t10: '0.9', t20: '0.7', t30: '0.8' }, cfg);
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.error).toContain("L'ordre requis");
  });

  it('diffs only the changed buckets; unchanged → empty patch', () => {
    expect(composeAttentionPatch({ t10: '0.5', t20: '0.7', t30: '0.8' }, cfg)).toEqual({
      ok: true,
      patch: { t_10s: 0.5 },
    });
    expect(composeAttentionPatch({ t10: '0.6', t20: '0.7', t30: '0.8' }, cfg)).toEqual({
      ok: true,
      patch: {},
    });
  });
});

describe('composeReversementPatch (per-block save — Σ = 100 refused client-side)', () => {
  const cfg = { pct_sh: 50, pct_toodooh: 44, pct_agent_sh: 3, pct_agent_sc: 3 };

  it('accepts a split totalling exactly 100 and diffs only the changed shares', () => {
    const r = composeReversementPatch({ sh: '55', toodooh: '39', agentSh: '3', agentSc: '3' }, cfg);
    expect(r).toEqual({ ok: true, patch: { pct_sh: 55, pct_toodooh: 39 } });
  });

  it('refuses 99 and 101 — « une répartition différente est refusée » is now TRUE', () => {
    const at99 = composeReversementPatch(
      { sh: '49', toodooh: '44', agentSh: '3', agentSc: '3' },
      cfg,
    );
    expect(at99.ok).toBe(false);
    if (!at99.ok) expect(at99.error).toContain('totaliser 100 (obtenu : 99)');
    const at101 = composeReversementPatch(
      { sh: '51', toodooh: '44', agentSh: '3', agentSc: '3' },
      cfg,
    );
    expect(at101.ok).toBe(false);
    if (!at101.ok) expect(at101.error).toContain('totaliser 100 (obtenu : 101)');
  });

  it('refuses an empty or out-of-range share (empty ≠ zero) and never silently drops it', () => {
    expect(
      composeReversementPatch({ sh: '', toodooh: '44', agentSh: '3', agentSc: '3' }, cfg).ok,
    ).toBe(false);
    expect(
      composeReversementPatch({ sh: '101', toodooh: '-1', agentSh: '0', agentSc: '0' }, cfg).ok,
    ).toBe(false);
  });

  it('unchanged split → empty patch (the page toasts « Aucune modification »)', () => {
    expect(
      composeReversementPatch({ sh: '50', toodooh: '44', agentSh: '3', agentSc: '3' }, cfg),
    ).toEqual({ ok: true, patch: {} });
  });
});
