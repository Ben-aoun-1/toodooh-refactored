import { apiClient } from '@/lib/api-client';

// AGT-3 / AGT-4 (agent specs v1.0 §4–§6, §10) — the agent's wallet, payouts, Dashboard, campaigns
// and affiliates (/api/agent/wallet, /api/agent/dashboard, /api/agent/campaigns,
// /api/agent/affiliates). apiClient prepends '/api'.

export type AgentCampaignStatus = 'a_venir' | 'active' | 'terminee';

export interface AgentCampaign {
  id: string;
  name: string;
  type: 'standard' | 'parc' | 'evenement';
  status: AgentCampaignStatus;
  start_date: string | null;
  end_date: string | null;
  affiliate_id: string;
  affiliate_name: string;
  impressions: number;
  revenue_tnd: number;
  forecast_tnd: number;
}

export interface AgentAffiliate {
  id: string;
  user_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: 'en_attente_activation' | 'en_cours' | 'terminee';
  attached_at: string;
  revenue_tnd: number;
  impressions: number;
}

export interface AgentWallet {
  cumulative_tnd: number;
  paid_tnd: number;
  balance_tnd: number;
  forecast_tnd: number;
  unprepared_tnd: number;
}

export interface AgentPayout {
  id: string;
  month: string;
  amount_tnd: number;
  status: 'en_preparation' | 'effectue';
  transfer_date: string | null;
  invoice_file_name: string | null;
  invoice_uploaded_at: string | null;
  prepared_at: string;
  paid_at: string | null;
}

/** AGT-7 — the Screenhost agent's campaign: accepted at ≥ 1 affiliated venue. */
export interface ShAgentCampaign {
  id: string;
  name: string;
  type: 'standard' | 'evenement';
  status: AgentCampaignStatus;
  start_date: string | null;
  end_date: string | null;
  advertiser_name: string;
  venues: { id: string; name: string; impressions: number }[];
  venues_touched: number;
  impressions: number;
  revenue_tnd: number;
  forecast_tnd: number;
}

export interface ShAffiliate {
  id: string;
  screenhost_id: string;
  name: string;
  category: string | null;
  address: string | null;
  status: 'en_attente_activation' | 'en_cours' | 'terminee';
  start_date: string | null;
  end_date: string | null;
  attached_at: string;
  exploited_by_agent: boolean;
  revenue_tnd: number;
  impressions: number;
  attention: string[];
}

export interface AttentionLabel {
  key: string;
  label: string;
}

export interface FollowupRow {
  screenhost_id: string;
  name: string;
  status: 'en_attente_activation' | 'en_cours';
  sps: number | null;
  trend: 'up' | 'down' | 'flat' | null;
  refused: number;
  no_answer: number;
  missed: number;
  attention: AttentionLabel[];
  computed_at: string | null;
}

export interface FollowupSheet {
  venue: ShAffiliate;
  engagement: {
    sps: number | null;
    curve: { day: string; sps: number | null }[];
    rates: {
      acceptation: number | null;
      respect_evenements: number | null;
      activite: number | null;
      remplissage: number | null;
    } | null;
    offers: { received: number; accepted: number; refused: number; no_answer: number };
    missed: { ecran: number; evenement: number };
    unavailable_days: number;
    last_diffusion_at: string | null;
    attention: AttentionLabel[];
    computed_at: string | null;
  } | null;
  history: {
    missed: { at: string; campaign: string; cause: 'ecran' | 'evenement' }[];
    unaccepted: {
      at: string;
      type: 'standard' | 'evenement';
      outcome: 'refusee' | 'sans_reponse';
    }[];
  } | null;
}

export interface AgentDashboard {
  code: string | null;
  wallet: AgentWallet;
  cumulative_variation_pct: number | null;
  affiliates_active: number;
  affiliates_variation_pct: number | null;
  impressions_total: number;
  impressions_variation_pct: number | null;
  rank: number | null;
  recent_affiliates: { id: string; name: string; attention: number }[];
  current_campaigns: (AgentCampaign | ShAgentCampaign)[];
}

export const agentPortfolioService = {
  dashboard(): Promise<AgentDashboard> {
    return apiClient.get('/agent/dashboard');
  },
  campaigns(): Promise<{ campaigns: AgentCampaign[] }> {
    return apiClient.get('/agent/campaigns');
  },
  affiliates(): Promise<{ affiliates: AgentAffiliate[] }> {
    return apiClient.get('/agent/affiliates');
  },
  shCampaigns(): Promise<{ campaigns: ShAgentCampaign[] }> {
    return apiClient.get('/agent/campaigns');
  },
  shAffiliates(): Promise<{ affiliates: ShAffiliate[] }> {
    return apiClient.get('/agent/affiliates');
  },
  followup(): Promise<{ rows: FollowupRow[] }> {
    return apiClient.get('/agent/followup');
  },
  followupSheet(screenhostId: string): Promise<FollowupSheet> {
    return apiClient.get(`/agent/followup/${screenhostId}`);
  },
  wallet(): Promise<AgentWallet & { invoice_required: boolean; payouts: AgentPayout[] }> {
    return apiClient.get('/agent/wallet');
  },
  uploadInvoice(payoutId: string, file: File): Promise<AgentPayout> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm(`/agent/payouts/${payoutId}/invoice`, form);
  },
};
