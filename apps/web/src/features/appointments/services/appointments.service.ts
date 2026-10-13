import { apiClient } from '@/lib/api-client';

// AGT-5 (agent specs v1.0 §7) — appointments over REST: the affiliate side (/api/appointments*)
// and the agent side (/api/agent/calendar, /api/agent/availability, /api/agent/appointments*).

export type AppointmentStatus =
  | 'en_attente'
  | 'nouvel_horaire'
  | 'confirme'
  | 'annule'
  | 'expire'
  | 'passe';

export interface AppointmentView {
  id: string;
  status: AppointmentStatus;
  day: string;
  hour: number;
  proposed_day: string | null;
  proposed_hour: number | null;
  message: string | null;
  objective: string | null;
  counterpart_id: string;
  counterpart_name: string;
  venue_name: string | null;
  venue_address: string | null;
  cancelled_by: 'agent' | 'affilie' | null;
}

export interface Referent {
  agent: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    photo_url: string | null;
  } | null;
  objectives: { id: string; label: string }[];
  slot_hours: number[];
}

export interface Availability {
  unavailable: string[];
  taken: { day: string; hour: number }[];
}

export const appointmentsService = {
  referent(): Promise<Referent> {
    return apiClient.get('/appointments/referent');
  },
  availability(month: string): Promise<Availability> {
    return apiClient.get(`/appointments/availability?month=${month}`);
  },
  request(body: { objective_id: string; day: string; hour: number; message: string | null }) {
    return apiClient.post<{ id: string }>('/appointments', body);
  },
  mine(): Promise<{ appointments: AppointmentView[] }> {
    return apiClient.get('/appointments/mine');
  },
  respond(id: string, accept: boolean) {
    return apiClient.post<{ ok: true }>(`/appointments/${id}/respond`, { accept });
  },
  cancelMine(id: string) {
    return apiClient.post<{ ok: true }>(`/appointments/${id}/cancel`);
  },
  agentCalendar(month: string): Promise<{ unavailable: string[]; slot_hours: number[] }> {
    return apiClient.get(`/agent/calendar?month=${month}`);
  },
  setAvailability(days: string[], available: boolean) {
    return apiClient.put<{ changed: string[]; confirmed_kept: string[] }>('/agent/availability', {
      days,
      available,
    });
  },
  agentAppointments(): Promise<{ appointments: AppointmentView[] }> {
    return apiClient.get('/agent/appointments');
  },
  accept(id: string) {
    return apiClient.post<{ ok: true }>(`/agent/appointments/${id}/accept`);
  },
  propose(id: string, day: string, hour: number) {
    return apiClient.post<{ ok: true }>(`/agent/appointments/${id}/propose`, { day, hour });
  },
  cancelAsAgent(id: string) {
    return apiClient.post<{ ok: true }>(`/agent/appointments/${id}/cancel`);
  },
};
