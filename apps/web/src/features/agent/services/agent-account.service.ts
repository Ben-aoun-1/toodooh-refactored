import { apiClient } from '@/lib/api-client';

import type { OnboardingStepView } from '../lib/agent-shell';

// AGT-1 — the agent's own account over REST (/api/agent/account, /api/agent/profile, CGE, RIB,
// photo, notification preferences). apiClient prepends '/api'.

export interface AgentAccount {
  role: 'screencast_agent' | 'screenhost_agent';
  code: string;
  first_name: string | null;
  last_name: string | null;
  account_status: 'en_attente' | 'actif' | 'suspendu' | 'cloture';
  cge: { id: string; version: string; accepted_at: string | null } | null;
  cge_required: boolean;
  onboarding: { steps: OnboardingStepView[]; done: number; complete: boolean };
  rib: {
    status: 'non_fourni' | 'en_attente' | 'valide' | 'refuse';
    validated: boolean;
    file_name: string | null;
    refusal_reason: string | null;
    submitted_at: string | null;
  };
}

export interface AgentProfile {
  email: string;
  code: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  postal_code: string | null;
  governorate_id: string | null;
  tax_number: string | null;
  covered_zone: string | null;
  photo_url: string | null;
  notify_news: boolean;
  notify_reminders: boolean;
  info_verified_at: string | null;
  accepted_cge: { id: string; version: string; accepted_at: string } | null;
}

export type AgentProfilePatch = Partial<{
  first_name: string;
  last_name: string;
  phone: string;
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
}>;

export const agentAccountService = {
  account(): Promise<AgentAccount> {
    return apiClient.get('/agent/account');
  },
  profile(): Promise<AgentProfile> {
    return apiClient.get('/agent/profile');
  },
  patchProfile(body: AgentProfilePatch): Promise<AgentProfile> {
    return apiClient.patch('/agent/profile', body);
  },
  uploadPhoto(file: File): Promise<AgentProfile> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm('/agent/photo', form);
  },
  deletePhoto(): Promise<AgentProfile> {
    return apiClient.del('/agent/photo');
  },
  setPrefs(news: boolean, reminders: boolean): Promise<unknown> {
    return apiClient.patch('/agent/notification-prefs', { news, reminders });
  },
  cgeUrl(): Promise<{ url: string; version: string }> {
    return apiClient.get('/agent/cge/url');
  },
  acceptedCgeUrl(id: string): Promise<{ url: string }> {
    return apiClient.get(`/agent/cge/${id}/url`);
  },
  acceptCge(cgeVersionId: string): Promise<void> {
    return apiClient.post('/agent/cge/accept', { cge_version_id: cgeVersionId });
  },
  uploadRib(file: File): Promise<unknown> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm('/agent/rib', form);
  },
};
