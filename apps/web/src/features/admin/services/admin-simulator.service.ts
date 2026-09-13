import { ApiError, apiClient } from '@/lib/api-client';

// SIM-0 — the admin « Simulateur » registry client. apiClient prepends '/api'. Every route is
// [requireAuth, requireAdmin, requireSimulator]; a 503 SIMULATOR_DISABLED means the server has
// SIMULATOR_ENABLED off — the page shows one line and nothing else.

export type SimulationStatus = 'creating' | 'ready' | 'failed' | 'deleting';

export interface Simulation {
  id: string;
  name: string;
  status: SimulationStatus;
  virtual_now: string;
  error: string | null;
  created_at: string;
  last_used_at: string;
}

export interface SimulationList {
  simulations: Simulation[];
  max: number;
}

export interface SimulationProbe {
  screenhosts: number;
  campaigns: number;
  users: number;
  dispatch_config_present: boolean;
}

export interface CreateSimulationInput {
  name: string;
  virtual_start?: string;
}

// ── SIM-1 — the generated world ────────────────────────────────────────────────

export interface WorldParamsView {
  seed: string;
  venues: number;
  owners: number;
  advertisers: number;
  agents: number;
  historyDays: number;
  walletMinTnd: number;
  walletMaxTnd: number;
  virtualToday: string;
}

export interface World {
  seed: string;
  params: WorldParamsView;
  generated_at: string;
  counts: Record<string, number>;
  by_sector: Record<string, number>;
  by_class: Record<string, number>;
  wallet_total_tnd: number;
}

export interface WorldVenue {
  id: string;
  name: string;
  sector: string | null;
  class: 'populaire' | 'moyen' | 'premium' | null;
  opening_hour: number | null;
  closing_hour: number | null;
  screens: number;
  sps: number;
  lat: number | null;
  lng: number | null;
  owner: { id: string | null; name: string | null; role: string | null };
  acceptance_rate: number | null;
  response_delay_hours: number | null;
}

export interface GenerateWorldInput {
  seed?: string;
  venues?: number;
  owners?: number;
  advertisers?: number;
  agents?: number;
  history_days?: number;
  wallet_min_tnd?: number;
  wallet_max_tnd?: number;
}

export const isNoWorld = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 404 && err.code === 'NO_WORLD';

export const isSimulatorDisabled = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 503 && err.code === 'SIMULATOR_DISABLED';

export const adminSimulatorService = {
  list: () => apiClient.get<SimulationList>('/admin/simulations'),
  get: (id: string) => apiClient.get<Simulation>(`/admin/simulations/${id}`),
  create: (input: CreateSimulationInput) => apiClient.post<Simulation>('/admin/simulations', input),
  remove: (id: string) => apiClient.del<void>(`/admin/simulations/${id}`),
  probe: (id: string) => apiClient.get<SimulationProbe>(`/admin/simulations/${id}/probe`),
  world: (id: string) => apiClient.get<World>(`/admin/simulations/${id}/world`),
  venues: (id: string) =>
    apiClient.get<{ venues: WorldVenue[] }>(`/admin/simulations/${id}/world/venues`),
  generateWorld: (id: string, input: GenerateWorldInput) =>
    apiClient.post<World>(`/admin/simulations/${id}/world`, input),
};
