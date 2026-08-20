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

/** A finite, strictly-positive TND/1000 rate (mirrors the server refine — a non-positive CPM
 * makes I_cible = ⌊budget·1000/cpm⌋ blow up / go negative at activation). */
export function parseCpm(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── CPM-ADMIN — per-block patch composition (each block saves alone; Mejri 05/08) ───────────────
// One pure function per Tarification block: raw input strings + the loaded config in, either a
// French refusal or the minimal PATCH body (only the keys that actually changed) out. The rules
// mirror the server's; keeping them here (not in the page) is what makes them pinnable — apps/web
// has no render harness, so a rule living in JSX is untestable.
export type BlockPatchResult = { ok: true; patch: CpmPatch } | { ok: false; error: string };

export function composeCpmPatch(
  raw: { standard: string; event: string },
  config: Pick<DispatchConfigView, 'standard_cpm_tnd' | 'event_cpm_tnd'>,
): BlockPatchResult {
  const standard = parseCpm(raw.standard);
  const event = parseCpm(raw.event);
  if (standard === null || event === null) {
    return { ok: false, error: 'Le CPM doit être un nombre strictement positif' };
  }
  const patch: CpmPatch = {};
  if (standard !== config.standard_cpm_tnd) patch.standard_cpm_tnd = standard;
  if (event !== config.event_cpm_tnd) patch.event_cpm_tnd = event;
  return { ok: true, patch };
}

export function composeLeadPatch(
  raw: { lead: string },
  config: Pick<DispatchConfigView, 'campaign_lead_working_days'>,
): BlockPatchResult {
  const lead = parseCampaignLead(raw.lead);
  if (lead === null) {
    return { ok: false, error: 'Le délai de lancement doit être un entier entre 0 et 30' };
  }
  const patch: CpmPatch = {};
  if (lead !== config.campaign_lead_working_days) patch.campaign_lead_working_days = lead;
  return { ok: true, patch };
}

export function composeAttentionPatch(
  raw: { t10: string; t20: string; t30: string },
  config: Pick<DispatchConfigView, 't_10s' | 't_20s' | 't_30s'>,
): BlockPatchResult {
  const t10 = parseAttention(raw.t10);
  const t20 = parseAttention(raw.t20);
  const t30 = parseAttention(raw.t30);
  if (t10 === null || t20 === null || t30 === null) {
    return { ok: false, error: "L'indice d'attention doit être compris entre 0 (exclu) et 1" };
  }
  if (!attentionOrderingValid(t10, t20, t30)) {
    return { ok: false, error: "L'ordre requis est T ≤ 10 s ≤ T ≤ 20 s ≤ T ≤ 30 s" };
  }
  const patch: CpmPatch = {};
  if (t10 !== config.t_10s) patch.t_10s = t10;
  if (t20 !== config.t_20s) patch.t_20s = t20;
  if (t30 !== config.t_30s) patch.t_30s = t30;
  return { ok: true, patch };
}

export function composeReversementPatch(
  raw: { sh: string; toodooh: string; agentSh: string; agentSc: string },
  config: Pick<DispatchConfigView, 'pct_sh' | 'pct_toodooh' | 'pct_agent_sh' | 'pct_agent_sc'>,
): BlockPatchResult {
  const parsePct = (s: string): number | null => {
    if (s.trim() === '') return null; // Number('') is 0 — an empty field is NOT a zero share
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  };
  const sh = parsePct(raw.sh);
  const toodooh = parsePct(raw.toodooh);
  const agentSh = parsePct(raw.agentSh);
  const agentSc = parsePct(raw.agentSc);
  if (sh === null || toodooh === null || agentSh === null || agentSc === null) {
    return {
      ok: false,
      error: 'Chaque pourcentage de reversement doit être un nombre entre 0 et 100',
    };
  }
  if (!reversementSumIsValid(sh, toodooh, agentSh, agentSc)) {
    return {
      ok: false,
      error: `Les pourcentages de reversement doivent totaliser 100 (obtenu : ${
        sh + toodooh + agentSh + agentSc
      })`,
    };
  }
  const patch: CpmPatch = {};
  if (sh !== config.pct_sh) patch.pct_sh = sh;
  if (toodooh !== config.pct_toodooh) patch.pct_toodooh = toodooh;
  if (agentSh !== config.pct_agent_sh) patch.pct_agent_sh = agentSh;
  if (agentSc !== config.pct_agent_sc) patch.pct_agent_sc = agentSc;
  return { ok: true, patch };
}

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
