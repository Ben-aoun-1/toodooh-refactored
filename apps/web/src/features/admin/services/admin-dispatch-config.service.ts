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
}

// A partial CPM edit — either or both. The server refines that at least one is present and that each
// is finite + strictly positive (a non-positive CPM blows up I_cible = ⌊budget·1000/cpm⌋).
export interface CpmPatch {
  standard_cpm_tnd?: number;
  event_cpm_tnd?: number;
}

export const adminDispatchConfigService = {
  async get(): Promise<DispatchConfigView> {
    return apiClient.get<DispatchConfigView>('/admin/dispatch-config');
  },

  async patchCpm(patch: CpmPatch): Promise<DispatchConfigView> {
    return apiClient.patch<DispatchConfigView>('/admin/dispatch-config', patch);
  },
};
