// Types pour le monitoring des campagnes par le super admin

export interface CampaignScreen {
  location_id: string;
  screen_id: string;
  screen_name: string;
  screen_address: string;
  screen_city: string;
  screen_status: string;
  owner_name: string;
}

export interface CampaignLocation {
  location_id: string;
  location_name: string;
  location_address: string;
  owner_name: string;
  screens_count: number;
  online_screens_count: number;
  location_status: 'active' | 'maintenance' | 'inactive' | 'unavailable' | 'no_screens';
}

export interface CampaignImpressionProgress {
  planned_impressions: number;
  realized_impressions: number;
  completion_rate: number;
}

export interface CampaignMonitoringData {
  campaign_id: string;
  campaign_name: string;
  advertiser_id: string;
  advertiser_name: string;
  advertiser_email: string;
  client_id: string;
  client_name: string;
  category: string;
  status: 'active' | 'pending' | 'completed' | 'paused';
  budget: number;
  views: number;
  start_date: string;
  end_date: string;
  content_validation_status: 'pending' | 'approved' | 'rejected';
  video_url?: string;
  video_filename?: string;
  screens_count: number;
  screens_list: CampaignScreen[];
  created_at: string;
}

export interface CampaignGlobalStats {
  total_campaigns: number;
  active_campaigns: number;
  pending_campaigns: number;
  completed_campaigns: number;
  paused_campaigns: number;
  total_budget: number;
  active_budget: number;
  total_views: number;
  avg_budget: number;
}

export interface CampaignByCategory {
  category: string;
  count: number;
  total_budget: number;
  total_views: number;
}

export interface TopAdvertiser {
  advertiser_id: string;
  advertiser_name: string;
  campaigns_count: number;
  total_budget: number;
  total_views: number;
  active_campaigns: number;
}

export interface MostUsedScreen {
  screen_id: string;
  screen_name: string;
  screen_address: string;
  screen_city: string;
  campaigns_count: number;
  owner_name: string;
}

export interface CampaignFilters {
  status?: 'all' | 'active' | 'pending' | 'completed' | 'paused';
  category?: string;
  advertiser?: string;
  searchTerm?: string;
}

