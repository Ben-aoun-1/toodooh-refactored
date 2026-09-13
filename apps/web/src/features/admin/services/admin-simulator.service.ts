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

export const isSimulatorDisabled = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 503 && err.code === 'SIMULATOR_DISABLED';

export const adminSimulatorService = {
  list: () => apiClient.get<SimulationList>('/admin/simulations'),
  get: (id: string) => apiClient.get<Simulation>(`/admin/simulations/${id}`),
  create: (input: CreateSimulationInput) => apiClient.post<Simulation>('/admin/simulations', input),
  remove: (id: string) => apiClient.del<void>(`/admin/simulations/${id}`),
  probe: (id: string) => apiClient.get<SimulationProbe>(`/admin/simulations/${id}/probe`),
};
