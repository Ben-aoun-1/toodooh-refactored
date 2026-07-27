import { apiClient } from '@/lib/api-client';

// EV1 — the sport-event catalogue over the live REST api (the Supabase-era events.service RPCs
// are gone). snake_case wire shapes mirror the api exactly; the diffusion window arrives DERIVED
// on every row (never stored, never recomputed client-side).

export interface EventBlocView {
  phase: 'avant' | 'apres';
  start: string;
  end: string;
}

export interface EventItemView {
  id: string;
  name: string;
  description: string | null;
  type: string;
  category: string | null;
  kickoff_at: string;
  ends_at: string;
  statut: 'a_venir' | 'en_cours' | 'termine';
  source: 'official' | 'suggested';
  has_image: boolean;
  fenetre: {
    window_start: string;
    window_end: string;
    blocs: EventBlocView[];
  };
}

export interface SuggestMatchInput {
  team_a: string;
  team_b: string;
  date: string;
  kickoff_time: string;
}

export const eventsApi = {
  catalogue(): Promise<{ events: EventItemView[] }> {
    return apiClient.get('/events');
  },
  suggested(): Promise<{ events: EventItemView[] }> {
    return apiClient.get('/events/suggested');
  },
  suggest(input: SuggestMatchInput): Promise<EventItemView> {
    return apiClient.post('/events/suggest', input);
  },
  imageUrl(eventId: string): Promise<{ url: string }> {
    return apiClient.get(`/events/${eventId}/image-url`);
  },
};
