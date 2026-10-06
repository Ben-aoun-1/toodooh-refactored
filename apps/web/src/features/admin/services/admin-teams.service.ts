import type { TeamView } from '@/features/events/services/events.api';
import { apiClient } from '@/lib/api-client';

// EVT-CAT2 — the admin TEAMS over /api/admin/teams: name, national team or club, three #RRGGBB
// colours, and an OPTIONAL logo/flag image (multipart, JPEG/PNG/WebP ≤ 2 MB).

export interface TeamInput {
  name?: string;
  is_national?: boolean;
  color_main?: string;
  color_second?: string;
  color_crowd?: string | null;
  /** PATCH-only: null removes the logo. */
  logo?: null;
}

export const adminTeamsService = {
  list(): Promise<{ teams: TeamView[] }> {
    return apiClient.get('/admin/teams');
  },
  create(input: TeamInput): Promise<TeamView> {
    return apiClient.post('/admin/teams', input);
  },
  update(id: string, input: TeamInput): Promise<TeamView> {
    return apiClient.patch(`/admin/teams/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return apiClient.del(`/admin/teams/${id}`);
  },
  uploadLogo(id: string, file: File): Promise<TeamView> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm(`/admin/teams/${id}/logo`, form);
  },
};
