import { apiClient } from '@/lib/api-client';

// Agent specs VF « Logos » — the logos of the agent's affiliates (and of the advertisers of his
// campaigns), and the upload of a logo for an affiliate (pending until Toodooh validates it).

export interface AgentLogo {
  url: string;
  status: 'valide' | 'en_attente';
}

export interface AgentLogos {
  /** By venue id (Screenhost) or account id (Screencaster). */
  subjects: Record<string, AgentLogo>;
  /** The advertiser's logo of each of the agent's campaigns, by campaign id. */
  campaigns: Record<string, AgentLogo>;
}

export const agentLogosService = {
  all(): Promise<AgentLogos> {
    return apiClient.get('/agent/logos');
  },
  upload(subjectId: string, file: File): Promise<AgentLogo> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm(`/agent/logos/${subjectId}`, form);
  },
};
