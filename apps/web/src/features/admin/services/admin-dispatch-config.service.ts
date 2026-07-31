import { apiClient } from '@/lib/api-client';

// Admin dispatch-config surface (new engine) over REST — the CPM the activation derivation prices a
// campaign at (operator ruling: 15 TND/1000 standard, 30 events; ADMIN-EDITABLE without a migration).
// Backed by GET/PATCH /api/admin/dispatch-config (Lane 1). apiClient prepends BASE='/api', so paths
// are WITHOUT the /api prefix; both routes are [requireAuth, requireAdmin] server-side. The wire is
// snake_case numbers (never numeric strings). Methods throw ApiError on failure (apiClient contract).

// The resolved singleton config. The two CPM knobs are admin-editable here; the remaining thresholds
// are read-only context (seeded/POC) the page surfaces alongside the editable rates.
export interface DispatchConfigView {
  seuil_diffusable: number;
  g_mois: number;
  jours_actifs: number;
  r_min_efficace: number;
  f_max_seconds: number;
  standard_cpm_tnd: number;
  event_cpm_tnd: number;
  /** E1 — the attention index T by spot-duration bucket ((0,1], t_10s ≤ t_20s ≤ t_30s). */
  t_10s: number;
  t_20s: number;
  t_30s: number;
  /** CF-D1 — the campaign start-date lead in jours ouvrés (0–30; 0 = floor is today, tests only). */
  campaign_lead_working_days: number;
  /** E7 — the reversement split, each ∈ [0,100] and Σ = 100 (server-validated at the edit path). */
  pct_sh: number;
  pct_toodooh: number;
  pct_agent_sh: number;
  pct_agent_sc: number;
}

// A partial edit — any subset of the editable knobs. The server refines that at least one is
// present, that each CPM is finite + strictly positive (a non-positive CPM blows up
// I_cible = ⌊budget·1000/cpm⌋), that each T is in (0, 1], and that the MERGED t ordering holds.
export interface CpmPatch {
  standard_cpm_tnd?: number;
  event_cpm_tnd?: number;
  t_10s?: number;
  t_20s?: number;
  t_30s?: number;
  campaign_lead_working_days?: number;
  pct_sh?: number;
  pct_toodooh?: number;
  pct_agent_sh?: number;
  pct_agent_sc?: number;
}

/**
 * E7 — the reversement shares must total exactly 100. The server refuses a drifted split with
 * « les pourcentages de reversement doivent totaliser 100 » (and the money rail would otherwise
 * throw at settlement); this mirror lets the screen say so before a pointless round trip.
 */
export const reversementSumIsValid = (
  sh: number,
  toodooh: number,
  agentSh: number,
  agentSc: number,
): boolean => Math.abs(sh + toodooh + agentSh + agentSc - 100) <= 1e-9;

// ── E1 — the attention-T client checks, mirrors of the server rules (pinned by unit test) ───────
/** A T value in (0, 1] — an attention index is a discount, never a boost. */
export function parseAttention(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : null;
}

/** The VF ordering: a longer spot holds attention better — t_10s ≤ t_20s ≤ t_30s. */
export const attentionOrderingValid = (t10: number, t20: number, t30: number): boolean =>
  t10 <= t20 && t20 <= t30;

/** CF-D1 — the campaign lead: an integer count of jours ouvrés in [0, 30] (server bounds). */
export function parseCampaignLead(raw: string): number | null {
  if (raw.trim() === '') return null; // Number('') is 0 — an empty field is NOT a zero lead
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 30 ? n : null;
}

export const adminDispatchConfigService = {
  async get(): Promise<DispatchConfigView> {
    return apiClient.get<DispatchConfigView>('/admin/dispatch-config');
  },

  async patchCpm(patch: CpmPatch): Promise<DispatchConfigView> {
    return apiClient.patch<DispatchConfigView>('/admin/dispatch-config', patch);
  },
};
