import { zonesRecapLabel } from '@/features/campaigns/lib/zones-selection';
import { apiClient } from '@/lib/api-client';

/**
 * Owner-scoped dispatch-allocation acceptance, served by `apps/api`:
 *   GET  /api/screenhosts/allocations          — the owner's EN_ATTENTE allocations
 *   POST /api/screenhosts/allocations/:id/accept (→ ACCEPTE)
 *   POST /api/screenhosts/allocations/:id/reject (→ REFUSE)
 *   GET  /api/screenhosts/allocations/:id/creative-url — short-TTL presigned spot view (CF-O1)
 *
 * This is the de-Supabased replacement for the legacy per-campaign owner approval
 * (`campaign_owner_approvals`): the new model is per-ALLOCATION (one row per allocated screenhost),
 * and an allocation only airs once its screenhost owner accepts it (the playout gate requires
 * ACCEPTE). Session-cookie scoped — no ownerId argument. Wire shape is snake_case.
 */
export interface AllocationCreative {
  kind: 'video' | 'photo';
  duration_seconds: number | null;
}

export interface PendingAllocation {
  id: string;
  campaign_id: string;
  campaign_name: string;
  /** CF-O1 — the full proposal (spec §2.2): type, category/zone NAMES, creative meta. */
  campaign_type: string;
  start_date: string | null;
  end_date: string | null;
  screenhost_id: string;
  screenhost_name: string;
  ii_potentiel: number;
  r_i: number;
  revenu_previsionnel: number;
  created_at: string;
  /** Targeting category NAMES; [] = « Toutes les catégories » (classes are never owner-facing). */
  categories: string[];
  /** Zone NAMES; [] = « Tout le réseau » (CF-Z1 convention). */
  zones: string[];
  /** Linked creative meta; null when the campaign has no creative (no spot to view). */
  creative: AllocationCreative | null;
}

// ── CF-Q1 — pinned card/decision helpers (the page has no render-test harness) ─────────────────
/** The owner's money leads each allocation card (spec 2.2 « en tête le montant qui me revient »). */
export const revenueLabel = (tnd: number): string => `${tnd.toLocaleString('fr-FR')} TND`;

/** Reject is consequential and irreversible — it alone needs confirmation. */
export const decisionNeedsConfirm = (kind: 'accept' | 'reject'): boolean => kind === 'reject';

// RULED copy (CF-9 amendment): no reattribution claim — the SPS cascade does not exist yet, a
// refused share simply stays off-air. Upgrade truthfully when the refusal cascade ships.
export const REJECT_ALLOCATION_CONFIRM = 'Refuser cette campagne ? Cette action est définitive.';

// ── CF-O1 — pinned proposal labels + decision states (same no-render-harness idiom) ────────────
// Accept success replaces the bare toast with the spec's keep-screens-active reminder.
export const ACCEPT_ALLOCATION_REMINDER =
  'Campagne acceptée — pensez à maintenir vos écrans actifs pour assurer la diffusion.';

// After a confirmed refusal the card flips to this state instead of vanishing (the spec's
// confirmation screen, adapted to the card idiom).
export const REFUSED_STATE_LABEL = 'Refus enregistré';
export const REFUSED_STATE_DETAIL = 'Cette campagne ne sera pas diffusée sur cet écran.';

/** The campaign type as shown to the owner (wire values are internal English tokens). */
export const campaignTypeLabel = (type: string): string => {
  if (type === 'standard') return 'Campagne';
  if (type === 'event') return 'Événement';
  return type;
};

/** Category names, or the ALL fallback — [] means every category is targeted. */
export const categoriesLabel = (names: readonly string[]): string =>
  names.length === 0 ? 'Toutes les catégories' : names.join(', ');

/** Zone names, or « Tout le réseau » — the SAME fallback the wizard recap shows (CF-Z1). */
export const zonesLabel = (names: readonly string[]): string => zonesRecapLabel(names);

/** CreativePreviewTile props from the wire creative — null when there is no spot to view. */
export const spotViewerProps = (
  allocation: Pick<PendingAllocation, 'campaign_name' | 'creative'>,
): { creativeType: 'video' | 'photo'; durationSeconds: number | null; title: string } | null =>
  allocation.creative === null
    ? null
    : {
        creativeType: allocation.creative.kind,
        durationSeconds: allocation.creative.duration_seconds,
        title: allocation.campaign_name,
      };

/**
 * The rendered list: the server's EN_ATTENTE rows annotated with the session's refusals, plus
 * refused cards the server no longer returns (a refetch drops them from EN_ATTENTE) appended so a
 * « Refus enregistré » card never vanishes mid-session.
 */
export const displayAllocations = (
  pending: readonly PendingAllocation[],
  refusedById: ReadonlyMap<string, PendingAllocation>,
): { allocation: PendingAllocation; refused: boolean }[] => {
  const shown = pending.map((allocation) => ({
    allocation,
    refused: refusedById.has(allocation.id),
  }));
  const pendingIds = new Set(pending.map((a) => a.id));
  for (const [id, allocation] of refusedById) {
    if (!pendingIds.has(id)) shown.push({ allocation, refused: true });
  }
  return shown;
};

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

  /** Short-TTL presigned view url for the allocation's spot (owner-scoped; 404 on foreign). */
  creativeUrl(id: string): Promise<{ url: string }> {
    return apiClient.get<{ url: string }>(`/screenhosts/allocations/${id}/creative-url`);
  },
};
