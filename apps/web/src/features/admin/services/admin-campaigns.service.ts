import type { EngineJournal, EngineJournalRun } from '@/features/admin/lib/engine-journal';
import type { AdminCampaignReversements } from '@/features/admin/lib/reversements';
import type {
  AdminCampaignRow,
  CampaignStatusFilter,
} from '@/features/admin/types/campaign-review';
import { apiClient } from '@/lib/api-client';

// Admin campaign-moderation surface (the ACTIVATION keystone) over REST. Mirrors adminCreativesService:
// apiClient prepends BASE='/api', so paths are WITHOUT the /api prefix; every route is
// [requireAuth, requireAdmin] server-side. Approve = ACTIVATE takes NO body — the engine inputs
// (cpm/i_cible/s/t) are DERIVED server-side from the campaign + dispatch config; the operator only
// confirms. Reject REQUIRES a reason (server rejectBodySchema min 1), surfaced to the advertiser.
// All methods throw ApiError on failure (the apiClient contract); the page branches in its try/catch.

// The activation result is the activated campaign + its frozen dispatch plan summary. The page only
// needs the success signal + the plan's headline numbers for the toast; typed loosely on purpose.
export interface AdminActivateResult {
  campaign: { id: string; status: string };
  plan: { i_cible: number; couvert: number; n_retenus: number };
}

export const adminCampaignsService = {
  // The review queue (newest first, server-ordered); optional status filter. The backend sends the
  // array directly (not wrapped), so the typed return is AdminCampaignRow[].
  async list(status?: CampaignStatusFilter): Promise<AdminCampaignRow[]> {
    const qs = status ? `?status=${status}` : '';
    return apiClient.get<AdminCampaignRow[]>(`/admin/campaigns${qs}`);
  },

  // Approve = activate: derive (cpm/i_cible/s/t) + dispatch + flip pending→active. NO body.
  async activate(id: string): Promise<AdminActivateResult> {
    return apiClient.post<AdminActivateResult>(`/admin/campaigns/${id}/activate`);
  },

  // Reject — pending→rejected; a reason is REQUIRED (surfaced to the advertiser as reject_reason).
  async reject(id: string, reason: string): Promise<AdminCampaignRow> {
    return apiClient.post<AdminCampaignRow>(`/admin/campaigns/${id}/reject`, { reason });
  },

  // E7 — the settlement's per-SH 50/44/3/3 breakdown + totals (empty lines = not settled yet).
  async getReversements(id: string): Promise<AdminCampaignReversements> {
    return apiClient.get<AdminCampaignReversements>(`/admin/campaigns/${id}/reversements`);
  },

  // LOG1 — the engine journal: runs newest-first with their events. One 50-run page (the modal's
  // working set; total_runs says when more history exists server-side).
  async getEngineJournal(id: string, phase?: EngineJournalRun['phase']): Promise<EngineJournal> {
    const qs = phase ? `?limit=50&phase=${phase}` : '?limit=50';
    return apiClient.get<EngineJournal>(`/admin/campaigns/${id}/engine-journal${qs}`);
  },
};
