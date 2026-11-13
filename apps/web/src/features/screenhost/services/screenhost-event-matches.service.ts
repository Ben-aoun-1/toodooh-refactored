import { apiClient } from '@/lib/api-client';

/**
 * Mariem 05/11/2026 — the « Soir de match » decisions (api routes/screenhost-event-matches):
 *   GET  /api/screenhosts/event-matches — one entry per match and venue awaiting an answer
 *   POST /api/screenhosts/event-matches/:eventId/venues/:screenhostId/accept|refuse — every spot
 */
export interface EventMatchSpot {
  allocation_id: string;
  campaign_id: string;
  creative: {
    kind: 'video' | 'photo';
    title: string | null;
    filename: string | null;
    duration_seconds: number | null;
  } | null;
  /** The owner's share for this spot (TND). */
  montant_tnd: number;
}

export interface PendingEventMatch {
  event_id: string;
  match_name: string;
  kickoff_at: string;
  ends_at: string;
  /** When the « Soir de match » notice went out (kick-off − 24 h). */
  noticed_at: string;
  screenhost_id: string;
  screenhost_name: string;
  /** The owner's share for the match: Σ of the spots', millime-exact. */
  total_tnd: number;
  spots: EventMatchSpot[];
}

export interface EventMatchDecision {
  event_id: string;
  screenhost_id: string;
  statut: 'ACCEPTE' | 'REFUSE';
  decided: number;
  reminder?: string;
}

const matchPath = (eventId: string, screenhostId: string) =>
  `/screenhosts/event-matches/${eventId}/venues/${screenhostId}`;

export const screenhostEventMatchesApi = {
  pending(): Promise<PendingEventMatch[]> {
    return apiClient.get('/screenhosts/event-matches');
  },
  accept(eventId: string, screenhostId: string): Promise<EventMatchDecision> {
    return apiClient.post(`${matchPath(eventId, screenhostId)}/accept`, {});
  },
  refuse(eventId: string, screenhostId: string): Promise<EventMatchDecision> {
    return apiClient.post(`${matchPath(eventId, screenhostId)}/refuse`, {});
  },
};
