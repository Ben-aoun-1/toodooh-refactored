import type { CreateEstablishmentInput, Establishment } from '@/features/agent/types/establishment';
import { apiClient } from '@/lib/api-client';

// Slice-2 E — the screenhost-agent establishment surface, on apps/api ONLY (no Supabase).
// GET /api/establishments -> { establishments } (the acting agent's own rows);
// POST /api/establishments -> { establishment }. Errors propagate as ApiError so the page surfaces
// the server message (e.g. an out-of-range coordinate or unknown governorate 400).
export const establishmentService = {
  async list(): Promise<Establishment[]> {
    const { establishments } = await apiClient.get<{ establishments: Establishment[] }>(
      '/establishments',
    );
    return establishments;
  },

  async create(input: CreateEstablishmentInput): Promise<Establishment> {
    const { establishment } = await apiClient.post<{ establishment: Establishment }>(
      '/establishments',
      input,
    );
    return establishment;
  },
};
