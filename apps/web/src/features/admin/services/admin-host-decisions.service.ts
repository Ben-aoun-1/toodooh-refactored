import { apiClient } from '@/lib/api-client';

// Mariem 13/11/2026 — the Admin answers for a Host (api routes/admin-host-decisions.ts).

export type HostDecisionKind = 'campaign' | 'event';
export type HostDecisionStatut = 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE' | 'RESERVE';

export interface HostDecisionRow {
  kind: HostDecisionKind;
  allocation_id: string;
  screenhost_id: string;
  screenhost_name: string;
  owner_label: string | null;
  statut: HostDecisionStatut;
  decided_at: string | null;
  /** What the Host earns on this share (TND, the owner's part). */
  owner_share_tnd: number;
}

export interface HostDecisions {
  campaign_id: string;
  campaign_status: string;
  kind: HostDecisionKind;
  hosts: HostDecisionRow[];
}

export const adminHostDecisionsService = {
  list(campaignId: string): Promise<HostDecisions> {
    return apiClient.get<HostDecisions>(`/admin/campaigns/${campaignId}/host-decisions`);
  },
  decide(
    kind: HostDecisionKind,
    allocationId: string,
    answer: 'accept' | 'refuse',
  ): Promise<{ statut: 'ACCEPTE' | 'REFUSE'; changed: boolean }> {
    return apiClient.post(`/admin/host-decisions/${kind}/${allocationId}/${answer}`, {});
  },
};
