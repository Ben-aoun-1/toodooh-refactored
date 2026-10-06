import { apiClient } from '@/lib/api-client';

// EV1 — the sport-event catalogue over the live REST api (the Supabase-era events.service RPCs
// are gone). snake_case wire shapes mirror the api exactly; the diffusion window arrives DERIVED
// on every row (never stored, never recomputed client-side).

export interface EventBlocView {
  phase: 'avant' | 'apres';
  start: string;
  end: string;
}

/** EVT-CAT2 — a team on a catalogue card (logo optional — the colours always exist). */
export interface TeamView {
  id: string;
  name: string;
  is_national: boolean;
  color_main: string;
  color_second: string;
  color_crowd: string | null;
  logo_url: string | null;
}

/** EVT-CAT2 — one match of an event; away null = « Adversaire après tirage ». */
export interface MatchView {
  position: number;
  home: TeamView;
  away: TeamView | null;
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
  /** EVT-CAT2 — the card's football facts (optional; older rows carry nulls) and matches. */
  competition?: string | null;
  round?: string | null;
  stadium?: string | null;
  featured?: 'hero' | 'pinned' | null;
  date_tbc?: boolean;
  time_tbc?: boolean;
  qualification_pending?: boolean;
  date_label?: string | null;
  matches?: MatchView[];
  /** B1 — false while the date/time is « à confirmer » (or the match is over/annulé). */
  positionable?: boolean;
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

/** EV3 — the parcours entry's response (the created positioning DRAFT row). */
export interface PositioningCreatedView {
  id: string;
  event_id: string;
  name: string;
  campaign_type: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

/** SUGG-1 — GET /api/events/:id/cmax (the match's ceiling for the caller + its venue pool). */
export interface EventCmaxView {
  c_max_evt_tnd: number;
  i_max: number;
  eligible_count: number;
  min_budget_tnd: number;
  /** The DISTINCT stored sector names of the event pool (display labels map at render). */
  sectors: string[];
}

export const eventsApi = {
  /** EV3 — « Je me positionne »: create the positioning draft (409 annulé/terminé). */
  positionner(eventId: string): Promise<PositioningCreatedView> {
    return apiClient.post(`/events/${eventId}/positionner`, {});
  },
  /** EVT-CAT2 — « Je me positionne sur ces N événements »: N drafts in one transaction. */
  positionnerMultiple(
    eventIds: string[],
  ): Promise<{ positionings: { id: string; event_id: string; name: string }[] }> {
    return apiClient.post('/events/positionner-multiple', { event_ids: eventIds });
  },
  catalogue(): Promise<{ events: EventItemView[] }> {
    return apiClient.get('/events');
  },
  suggested(): Promise<{ events: EventItemView[] }> {
    return apiClient.get('/events/suggested');
  },
  suggest(input: SuggestMatchInput): Promise<EventItemView> {
    return apiClient.post('/events/suggest', input);
  },
  cmax(eventId: string): Promise<EventCmaxView> {
    return apiClient.get(`/events/${eventId}/cmax`);
  },
  imageUrl(eventId: string): Promise<{ url: string }> {
    return apiClient.get(`/events/${eventId}/image-url`);
  },
};
