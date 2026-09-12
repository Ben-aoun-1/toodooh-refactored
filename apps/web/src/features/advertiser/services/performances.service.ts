import { apiClient } from '@/lib/api-client';

/**
 * SC-P — the screencaster « Mes performances » reads (apps/api routes/advertiser-performances).
 * Session-scoped; wire shape is snake_case (the API contract). One figure home api-side: every
 * number here is settled data (impressions générées = the NET helper's delivered form), never a
 * front-side estimate.
 */

export type CampaignNature = 'normal' | 'event';

export interface ClosedCampaignWire {
  id: string;
  name: string;
  nature: CampaignNature;
  start_date: string | null;
  end_date: string | null;
  closed_at: string;
  /** Tunis calendar date of the clôture — RG-PERF-16 membership key. */
  closed_on: string;
  budget_ht: number;
  budget_ttc: number;
  impressions: number;
  hours: number;
  plays: number;
  venues: number;
}

export interface LiveCampaignWire {
  id: string;
  name: string;
  nature: CampaignNature;
  launched_on: string | null;
  /** null = no affluence source behind the credited hours (not a zero). */
  audience: number | null;
  plays: number;
  venues: number;
}

export interface ShareWire {
  key: string;
  label: string;
  value: number;
  pct: number;
}

export interface AnalysisWire {
  mode: 'campaign' | 'period';
  period: { from: string | null; to: string | null } | null;
  nature: 'all' | CampaignNature;
  campaigns: (ClosedCampaignWire & { categories: string[]; csp_shares: ShareWire[] })[];
  overview: {
    campaign_count: number;
    impressions: number;
    hours: number;
    plays: number;
    venues: number;
    budget_ht: number;
    budget_ttc: number;
  };
  categories: ShareWire[];
  csp: ShareWire[];
  audience: {
    profiled_impressions: number;
    unprofiled_impressions: number;
    unprofiled_venues: number;
    sex: ShareWire[];
    age: ShareWire[];
  } | null;
  zones: (ShareWire & { zone_id: string | null })[];
}

export interface FootprintWire {
  points: {
    closed_on: string;
    campaign_id: string;
    name: string;
    impressions: number;
    hours: number;
    impressions_cumulative: number;
    hours_cumulative: number;
  }[];
  totals: { impressions: number; hours: number };
}

export interface AnalysisQuery {
  campaignId?: string;
  from?: string | null;
  to?: string | null;
  nature?: 'all' | CampaignNature;
}

export const analysisPath = (q: AnalysisQuery): string => {
  const params = new URLSearchParams();
  if (q.campaignId) params.set('campaign_id', q.campaignId);
  else {
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    if (q.nature && q.nature !== 'all') params.set('nature', q.nature);
  }
  const qs = params.toString();
  return `/advertiser/performances/analysis${qs ? `?${qs}` : ''}`;
};

export const performancesService = {
  listClosed(): Promise<{ campaigns: ClosedCampaignWire[] }> {
    return apiClient.get<{ campaigns: ClosedCampaignWire[] }>('/advertiser/performances/campaigns');
  },
  listLive(): Promise<{ campaigns: LiveCampaignWire[] }> {
    return apiClient.get<{ campaigns: LiveCampaignWire[] }>('/advertiser/performances/live');
  },
  footprint(): Promise<FootprintWire> {
    return apiClient.get<FootprintWire>('/advertiser/performances/footprint');
  },
  analysis(q: AnalysisQuery): Promise<AnalysisWire> {
    return apiClient.get<AnalysisWire>(analysisPath(q));
  },
  /** The per-campaign rapport de clôture (PDF, sections 01–04). */
  downloadReport(campaignId: string): Promise<Blob> {
    return apiClient.getBlob(`/advertiser/performances/campaigns/${campaignId}/report.pdf`);
  },
};
