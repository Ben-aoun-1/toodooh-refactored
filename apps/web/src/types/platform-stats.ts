// Types pour les statistiques consolidées de la plateforme (Super Admin Dashboard)

export interface PlatformGlobalStats {
  // Utilisateurs
  total_users: number;
  pending_users: number;
  approved_users: number;
  owners_count: number;
  advertisers_count: number;
  
  // Écrans
  total_screens: number;
  active_screens: number;
  inactive_screens: number;
  online_screens: number;
  
  // Campagnes
  total_campaigns: number;
  active_campaigns: number;
  pending_campaigns: number;
  
  // Vidéos
  total_videos: number;
  pending_videos: number;
  approved_videos: number;
  
  // Événements
  total_events: number;
  active_events: number;
  upcoming_events: number;
}

export interface PlatformRevenueStats {
  total_revenue: number;
  monthly_revenue: number;
  daily_revenue: number;
  average_revenue_per_screen: number;
  revenue_growth_rate: number;
  total_campaigns_budget: number;
}

export interface ScreensOccupancyStats {
  total_screens: number;
  screens_with_campaigns: number;
  occupancy_rate: number;
  available_screens: number;
  average_uptime: number;
}

export interface CampaignsPerformance {
  total_campaigns: number;
  active_campaigns: number;
  total_views: number;
  total_budget: number;
  average_budget: number;
  campaigns_by_status: {
    draft: number;
    pending: number;
    active: number;
    paused: number;
    completed: number;
    rejected: number;
  };
}

export interface TopPerformingScreen {
  screen_id: string;
  screen_name: string;
  location: string;
  total_revenue: number;
  monthly_revenue: number;
  owner_business_name: string;
}

export interface RecentActivity {
  activity_date: string;
  activity_type: string;
  description: string;
  user_name: string;
}












































