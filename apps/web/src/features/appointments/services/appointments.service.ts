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
  /** AGENT-VF — who asked, the quarter-hour, and the place of an agent's own request. */
  initiated_by: 'affilie' | 'agent';
  minute: number;
  proposed_minute: number | null;
  place: AppointmentPlace | null;
}

export type AppointmentPlace = 'sur_place' | 'telephone' | 'visio';

/** GET /api/agent/appointments/options — what « Prendre un rendez-vous » offers the agent. */
export interface AgentRdvOptions {
  targets: { id: string; name: string }[];
  places: { id: AppointmentPlace; label: string }[];
  subjects: string[];
  minutes: number[];
}

export interface AgentRdvRequest {
  target_id: string;
  day: string;
  hour: number;
  minute: number;
  place: AppointmentPlace;
  subject: string;
  message: string | null;
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

/** GET /api/agent/calendar — whole unavailable days, single blocked hours, the slot grid. */
export interface AgentCalendarView {
  unavailable: string[];
  unavailable_hours: { day: string; hour: number }[];
  slot_hours: number[];
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
  agentCalendar(month: string): Promise<AgentCalendarView> {
    return apiClient.get(`/agent/calendar?month=${month}`);
  },
  // AGT-HOUR1 — `hours` narrows the change to those slot hours (omitted = the whole days).
  setAvailability(days: string[], available: boolean, hours?: number[]) {
    return apiClient.put<{ changed: string[]; confirmed_kept: string[] }>('/agent/availability', {
      days,
      available,
      ...(hours === undefined ? {} : { hours }),
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
  // AGENT-VF (spec VF §13 / §9) — the agent's own request and its answers.
  agentOptions(): Promise<AgentRdvOptions> {
    return apiClient.get('/agent/appointments/options');
  },
  agentRequest(body: AgentRdvRequest) {
    return apiClient.post<{ id: string; target: string }>('/agent/appointments', body);
  },
  acceptSlot(id: string) {
    return apiClient.post<{ ok: true }>(`/agent/appointments/${id}/accept-slot`);
  },
  acceptRequest(id: string) {
    return apiClient.post<{ ok: true }>(`/appointments/${id}/accept`);
  },
  proposeBack(id: string, slot: { day: string; hour: number; minute: number }) {
    return apiClient.post<{ ok: true }>(`/appointments/${id}/propose`, slot);
  },
  cancelAsAgent(id: string) {
    return apiClient.post<{ ok: true }>(`/agent/appointments/${id}/cancel`);
  },
};
