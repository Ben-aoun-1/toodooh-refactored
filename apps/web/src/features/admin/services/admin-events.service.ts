import type { EventItemView } from '@/features/events/services/events.api';
import { apiClient } from '@/lib/api-client';

// EV1 — the admin event surface over /api/admin/events (the Supabase-era CRUD is gone).
// The §10 field set only: name, description, category, type (LOCKED sport server-side),
// kickoff_at, ends_at, plus the affiche (multipart attach) and the annuler soft cancel.

export interface AdminEventView extends EventItemView {
  annule: boolean;
  suggested_by: string | null;
  created_at: string;
}

export interface UpsertEventInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  kickoff_at?: string;
  ends_at?: string;
}

// EV2 — the read-only tarification detail (GET /api/admin/events/:id/tarification).
export interface EventTarificationView {
  c_max_evt_tnd: number;
  i_max: number;
  eligible_count: number;
  cpm_evt_tnd: number;
  min_budget_tnd: number;
  annule: boolean;
  venues: {
    screenhost_id: string;
    name: string;
    amax_pph: number;
    blocs_disponibles: number;
    impressions: number;
  }[];
}

export const adminEventsService = {
  list(): Promise<{ events: AdminEventView[] }> {
    return apiClient.get('/admin/events');
  },
  tarification(id: string): Promise<EventTarificationView> {
    return apiClient.get(`/admin/events/${id}/tarification`);
  },
  create(input: UpsertEventInput): Promise<EventItemView> {
    return apiClient.post('/admin/events', input);
  },
  update(id: string, patch: UpsertEventInput): Promise<EventItemView> {
    return apiClient.patch(`/admin/events/${id}`, patch);
  },
  annuler(id: string): Promise<EventItemView & { annule: boolean }> {
    return apiClient.post(`/admin/events/${id}/annuler`);
  },
  uploadImage(id: string, file: File): Promise<EventItemView> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm(`/admin/events/${id}/image`, form);
  },
  imageUrl(id: string): Promise<{ url: string }> {
    return apiClient.get(`/admin/events/${id}/image-url`);
  },
};
