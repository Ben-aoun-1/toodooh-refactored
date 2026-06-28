import { apiClient } from '@/lib/api-client';

/**
 * Owner-scoped dispatch-allocation acceptance, served by `apps/api`:
 *   GET  /api/screenhosts/allocations          — the owner's EN_ATTENTE allocations
 *   POST /api/screenhosts/allocations/:id/accept (→ ACCEPTE)
 *   POST /api/screenhosts/allocations/:id/reject (→ REFUSE)
 *
 * This is the de-Supabased replacement for the legacy per-campaign owner approval
 * (`campaign_owner_approvals`): the new model is per-ALLOCATION (one row per allocated screenhost),
 * and an allocation only airs once its screenhost owner accepts it (the playout gate requires
 * ACCEPTE). Session-cookie scoped — no ownerId argument. Wire shape is snake_case.
 */
export interface PendingAllocation {
  id: string;
  campaign_id: string;
  campaign_name: string;
  start_date: string | null;
  end_date: string | null;
  screenhost_id: string;
  screenhost_name: string;
  ii_potentiel: number;
  r_i: number;
  revenu_previsionnel: number;
  created_at: string;
}

export interface AllocationDecision {
  id: string;
  statut_acceptation: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
}

export const screenhostAllocationsService = {
  /** The signed-in owner's allocations awaiting their accept/reject decision (newest first). */
  listPending(): Promise<PendingAllocation[]> {
    return apiClient.get<PendingAllocation[]>('/screenhosts/allocations');
  },

  /** Accept an allocation on one of the owner's screenhosts (→ ACCEPTE; it may now air). */
  accept(id: string): Promise<AllocationDecision> {
    return apiClient.post<AllocationDecision>(`/screenhosts/allocations/${id}/accept`);
  },

  /** Reject an allocation on one of the owner's screenhosts (→ REFUSE; it stays off-air). */
  reject(id: string): Promise<AllocationDecision> {
    return apiClient.post<AllocationDecision>(`/screenhosts/allocations/${id}/reject`);
  },
};
