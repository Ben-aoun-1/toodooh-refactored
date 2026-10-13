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

export interface AgentDashboard {
  code: string | null;
  wallet: AgentWallet;
  cumulative_variation_pct: number | null;
  affiliates_active: number;
  affiliates_variation_pct: number | null;
  impressions_total: number;
  impressions_variation_pct: number | null;
  rank: number | null;
  recent_affiliates: { id: string; name: string }[];
  current_campaigns: AgentCampaign[];
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
  wallet(): Promise<AgentWallet & { invoice_required: boolean; payouts: AgentPayout[] }> {
    return apiClient.get('/agent/wallet');
  },
  uploadInvoice(payoutId: string, file: File): Promise<AgentPayout> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm(`/agent/payouts/${payoutId}/invoice`, form);
  },
};
