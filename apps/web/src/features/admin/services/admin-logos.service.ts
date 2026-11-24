import { apiClient } from '@/lib/api-client';

// Agent specs VF « Logos » — the admin side: the pending queue (validate / refuse) and the
// add / replace of a Screenhost's or a Screencaster's logo.

export interface PendingLogo {
  id: string;
  subject_kind: 'screenhost' | 'advertiser';
  subject_id: string;
  subject_name: string;
  agent_name: string;
  url: string | null;
  current_url: string | null;
  created_at: string;
}

export type LogoSubjectKind = 'screenhost' | 'advertiser';

export const adminLogosService = {
  async pending(): Promise<PendingLogo[]> {
    return (await apiClient.get<{ pending: PendingLogo[] }>('/admin/logos')).pending;
  },
  validate(id: string) {
    return apiClient.post<{ ok: true }>(`/admin/logos/${id}/validate`, {});
  },
  refuse(id: string, reason: string | null) {
    return apiClient.post<{ ok: true }>(`/admin/logos/${id}/refuse`, { reason });
  },
  async current(kind: LogoSubjectKind, id: string): Promise<string | null> {
    const r = await apiClient.get<{ logo: { url: string } | null }>(`/admin/logos/${kind}/${id}`);
    return r.logo?.url ?? null;
  },
  upload(kind: LogoSubjectKind, id: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm<{ url: string }>(`/admin/logos/${kind}/${id}`, form);
  },
};
