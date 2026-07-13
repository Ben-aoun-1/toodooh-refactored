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

// ── CF-Q1 — pinned card/decision helpers (the page has no render-test harness) ─────────────────
/** The owner's money leads each allocation card (spec 2.2 « en tête le montant qui me revient »). */
export const revenueLabel = (tnd: number): string => `${tnd.toLocaleString('fr-FR')} TND`;

/** Reject is consequential and irreversible — it alone needs confirmation. */
export const decisionNeedsConfirm = (kind: 'accept' | 'reject'): boolean => kind === 'reject';

// RULED copy (CF-9 amendment): no reattribution claim — the SPS cascade does not exist yet, a
// refused share simply stays off-air. Upgrade truthfully when the refusal cascade ships.
export const REJECT_ALLOCATION_CONFIRM = 'Refuser cette campagne ? Cette action est définitive.';

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
