import { apiClient } from '@/lib/api-client';

// Agent Screenhost spec VF §10 — the campaign offers of the agent's affiliated Screenhosts
// (/api/agent/offers): what the Host sees, and the agent's answer for the Host.

export type OfferState = 'attente' | 'acceptee' | 'refusee';
export type OfferAnsweredBy = 'vous' | 'screenhost' | 'toodooh';

export interface AgentOffer {
  id: string;
  /** A classic campaign, or a match-night share (Mariem 15/11). */
  kind: 'campaign' | 'event';
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  start_date: string | null;
  end_date: string | null;
  /** A match's kick-off (ISO); null for a classic campaign. */
  kickoff_at: string | null;
  screenhost_id: string;
  screenhost_name: string;
  /** Zone names; [] = the whole network. */
  zones: string[];
  /** What the Screenhost earns. */
  gain_tnd: number;
  /** Spots the answer covers (a grouped match: all its waiting spots). */
  spots: number;
  state: OfferState;
  answered_by: OfferAnsweredBy | null;
  /** Accepter / Refuser are offered. */
  decidable: boolean;
  creative: { kind: 'video' | 'photo'; duration_seconds: number | null } | null;
}

export interface AgentOfferAnswer {
  id: string;
  state: OfferState;
  answered_by: OfferAnsweredBy | null;
  changed: boolean;
}

export const agentOffersService = {
  get(id: string): Promise<AgentOffer> {
    return apiClient.get(`/agent/offers/${id}`);
  },
  creativeUrl(id: string): Promise<{ url: string }> {
    return apiClient.get(`/agent/offers/${id}/creative-url`);
  },
  accept(id: string): Promise<AgentOfferAnswer> {
    return apiClient.post(`/agent/offers/${id}/accept`);
  },
  refuse(id: string): Promise<AgentOfferAnswer> {
    return apiClient.post(`/agent/offers/${id}/refuse`);
  },
};
