import { apiClient } from '@/lib/api-client';

/**
 * EV4 — owner-scoped EVENT-allocation proposals (§11.1), served by apps/api:
 *   GET  /api/screenhosts/event-allocations                 — the owner's EN_ATTENTE proposals
 *   POST /api/screenhosts/event-allocations/:id/accept      — ACCEPTE (+ the antenne reminder)
 *   POST /api/screenhosts/event-allocations/:id/refuse      — REFUSE (final; the cascade re-places)
 *   GET  /api/screenhosts/event-allocations/:id/creative-url — short-TTL presigned spot view
 *
 * SIBLING of the campaign-allocation service BY DESIGN: the campaign surface is pinned untouched.
 * An accepted event allocation airs NOTHING until EV5 (the playout pin) — acceptance is the
 * owner's commitment for the diffusion window, not an immediate broadcast.
 */
export interface EventAllocationBloc {
  start: string;
  end: string;
  impressions: number;
}

export interface PendingEventAllocation {
  id: string;
  campaign_id: string;
  match_name: string;
  kickoff_at: string;
  ends_at: string;
  screenhost_id: string;
  screenhost_name: string;
  blocs: EventAllocationBloc[];
  blocs_count: number;
  impressions_total: number;
  montant_tnd: number;
  creative: { kind: 'video' | 'photo'; duration_seconds: number | null } | null;
  created_at: string;
}

/** The période line — the ± 1 h contract with the match's dates, spelled once. */
export const EVENT_PERIODE_LINE = '1 h avant · match · 1 h après';

/** Refuse is consequential and final — mirror the campaign confirm idiom, event voice. */
export const EVENT_REFUSE_CONFIRM =
  'Refuser cet événement ? Votre part sera réattribuée aux autres écrans.\nCette action est définitive.';

export const EVENT_REFUSED_STATE_LABEL = 'Refus enregistré';
export const EVENT_REFUSED_STATE_DETAIL = 'Cet événement ne sera pas diffusé sur cet écran.';

export const screenhostEventAllocationsApi = {
  pending(): Promise<PendingEventAllocation[]> {
    return apiClient.get('/screenhosts/event-allocations');
  },
  /** The 200 carries the antenne reminder — the UI speaks it on every accept. */
  accept(id: string): Promise<{ id: string; statut: string; reminder?: string }> {
    return apiClient.post(`/screenhosts/event-allocations/${id}/accept`, {});
  },
  refuse(id: string): Promise<{ id: string; statut: string }> {
    return apiClient.post(`/screenhosts/event-allocations/${id}/refuse`, {});
  },
  creativeUrl(id: string): Promise<{ url: string }> {
    return apiClient.get(`/screenhosts/event-allocations/${id}/creative-url`);
  },
};
