import { apiClient } from '@/lib/api-client';

/**
 * P2 — read model for GET /api/agent/clients (the caller agent's referred clients).
 * Mirrors the API's `toAgentClientView` projection exactly: the non-document fields of the
 * admin user view + `agent_code_used` (the raw code the client typed at signup) + the client's
 * owned screenhost locations (screenhost owners only; `[]` otherwise). `documents` is absent BY
 * API DESIGN — never add it here. Latitude/longitude are Postgres `numeric` → serialized as
 * strings; timestamps are ISO strings.
 */
export interface AgentClientScreenhost {
  id: string;
  name: string;
  latitude: string | null;
  longitude: string | null;
  screen_count: number;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  governorate_id: string | null;
  zone: string | null;
  wifi_ssid: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AgentClient {
  id: string;
  email: string;
  email_verified: boolean;
  role: string;
  status: string;
  onboarding_completed: boolean;
  profile_type: string | null;
  contact_name: string | null;
  business_name: string | null;
  business_type: string | null;
  tax_number: string | null;
  contact_phone: string | null;
  fonction: string | null;
  business_sector_id: string | null;
  street_address: string | null;
  city: string | null;
  postal_code: string | null;
  governorate_id: string | null;
  zone: string | null;
  agent_code_used: string;
  created_at: string;
  screenhosts: AgentClientScreenhost[];
}

interface AgentClientsResponse {
  clients: AgentClient[];
}

export const agentClientsService = {
  /** The caller agent's referred clients (read-only; role-guarded server-side). */
  async getClients(): Promise<AgentClient[]> {
    const res = await apiClient.get<AgentClientsResponse>('/agent/clients');
    return res.clients;
  },
};
