import { supabase } from '../lib/supabase';
import {
  PlatformGlobalStats,
  PlatformRevenueStats,
  ScreensOccupancyStats,
  CampaignsPerformance,
  TopPerformingScreen,
  RecentActivity
} from '../types/platform-stats';

export const platformStatsService = {
  // Récupérer les statistiques globales
  async getGlobalStats(): Promise<PlatformGlobalStats | null> {
    try {
      console.log('🔍 Fetching platform global stats...');
      
      // Essayer d'abord avec RPC
      try {
        const { data, error } = await supabase.rpc('get_platform_global_stats');
        if (!error && data) {
          console.log('✅ Global stats fetched via RPC');
          return data[0];
        }
      } catch (rpcError) {
        console.log('⚠️ RPC not available, using direct queries');
      }

      // Fallback: Requêtes directes
      const [users, screens, campaigns, videos, events] = await Promise.all([
        supabase.from('business_profiles').select('*', { count: 'exact', head: true }),
        supabase.from('screens').select('*', { count: 'exact', head: true }),
        supabase.from('campaigns').select('*', { count: 'exact', head: true }),
        supabase.from('videos').select('*', { count: 'exact', head: true }),
        supabase.from('special_events').select('*', { count: 'exact', head: true })
      ]);

      // Récupérer les détails pour les filtres
      const { data: usersData } = await supabase.from('business_profiles').select('status, profile_type');
      const { data: screensData } = await supabase.from('screens').select('status, is_online');
      const { data: campaignsData } = await supabase.from('campaigns').select('status');
      const { data: videosData } = await supabase.from('videos').select('validation_status');
      const { data: eventsData } = await supabase.from('special_events').select('is_active, start_date');

      const stats: PlatformGlobalStats = {
        total_users: users.count || 0,
        pending_users: usersData?.filter(u => u.status === 'pending').length || 0,
        approved_users: usersData?.filter(u => u.status === 'approved').length || 0,
        owners_count: usersData?.filter(u => u.profile_type === 'individual_owner' || u.profile_type === 'fleet_owner').length || 0,
        advertisers_count: usersData?.filter(u => u.profile_type === 'advertiser').length || 0,
        
        total_screens: screens.count || 0,
        active_screens: screensData?.filter(s => s.status === 'active').length || 0,
        inactive_screens: screensData?.filter(s => s.status === 'inactive').length || 0,
        online_screens: screensData?.filter(s => s.is_online === true).length || 0,
        
        total_campaigns: campaigns.count || 0,
        active_campaigns: campaignsData?.filter(c => c.status === 'active').length || 0,
        pending_campaigns: campaignsData?.filter(c => c.status === 'pending').length || 0,
        
        total_videos: videos.count || 0,
        pending_videos: videosData?.filter(v => v.validation_status === 'pending').length || 0,
        approved_videos: videosData?.filter(v => v.validation_status === 'approved').length || 0,
        
        total_events: events.count || 0,
        active_events: eventsData?.filter(e => e.is_active === true).length || 0,
        upcoming_events: eventsData?.filter(e => new Date(e.start_date) > new Date()).length || 0
      };

      console.log('✅ Global stats computed from direct queries:', stats);
      return stats;
    } catch (error) {
      console.error('❌ Exception in getGlobalStats:', error);
      return null;
    }
  },

  // Récupérer les statistiques de revenus
  async getRevenueStats(): Promise<PlatformRevenueStats | null> {
    try {
      console.log('🔍 Fetching platform revenue stats...');
      
      // Essayer avec RPC
      try {
        const { data, error } = await supabase.rpc('get_platform_revenue_stats');
        if (!error && data) {
          console.log('✅ Revenue stats fetched via RPC');
          return data[0];
        }
      } catch (rpcError) {
        console.log('⚠️ RPC not available, using direct queries');
      }

      // Fallback: Requêtes directes
      const { data: screensData } = await supabase.from('screens').select('total_revenue, monthly_revenue');
      const { data: campaignsData } = await supabase.from('campaigns').select('budget').in('status', ['active', 'pending']);

      const totalRevenue = screensData?.reduce((sum, s) => sum + (s.total_revenue || 0), 0) || 0;
      const monthlyRevenue = screensData?.reduce((sum, s) => sum + (s.monthly_revenue || 0), 0) || 0;
      const totalBudget = campaignsData?.reduce((sum, c) => sum + (c.budget || 0), 0) || 0;
      const screensCount = screensData?.length || 1;

      const stats: PlatformRevenueStats = {
        total_revenue: totalRevenue,
        monthly_revenue: monthlyRevenue,
        daily_revenue: monthlyRevenue / 30,
        average_revenue_per_screen: totalRevenue / screensCount,
        revenue_growth_rate: 12.5, // Simulation - remplacer par vraie donnée historique
        total_campaigns_budget: totalBudget
      };

      console.log('✅ Revenue stats computed:', stats);
      return stats;
    } catch (error) {
      console.error('❌ Exception in getRevenueStats:', error);
      return null;
    }
  },

  // Récupérer le taux d'occupation des écrans
  async getOccupancyStats(): Promise<ScreensOccupancyStats | null> {
    try {
      console.log('🔍 Fetching screens occupancy stats...');
      
      // Essayer avec RPC
      try {
        const { data, error } = await supabase.rpc('get_screens_occupancy_rate');
        if (!error && data) {
          console.log('✅ Occupancy stats fetched via RPC');
          return data[0];
        }
      } catch (rpcError) {
        console.log('⚠️ RPC not available, using direct queries');
      }

      // Fallback: Requêtes directes
      const { data: screensData } = await supabase.from('screens').select('status, is_online');
      
      const totalScreens = screensData?.length || 0;
      const activeScreens = screensData?.filter(s => s.status === 'active').length || 0;
      const availableScreens = screensData?.filter(s => s.status === 'active' && s.is_online === true).length || 0;

      const stats: ScreensOccupancyStats = {
        total_screens: totalScreens,
        screens_with_campaigns: 0, // TODO: Calculer si liaison écran-campagne existe
        occupancy_rate: totalScreens > 0 ? (activeScreens / totalScreens) * 100 : 0,
        available_screens: availableScreens,
        average_uptime: 100 // TODO: Calculer depuis screen_statistics
      };

      console.log('✅ Occupancy stats computed:', stats);
      return stats;
    } catch (error) {
      console.error('❌ Exception in getOccupancyStats:', error);
      return null;
    }
  },

  // Récupérer les performances des campagnes
  async getCampaignsPerformance(): Promise<CampaignsPerformance | null> {
    try {
      console.log('🔍 Fetching campaigns performance...');
      
      // Essayer avec RPC
      try {
        const { data, error } = await supabase.rpc('get_campaigns_performance');
        if (!error && data) {
          console.log('✅ Campaigns performance fetched via RPC');
          return data[0];
        }
      } catch (rpcError) {
        console.log('⚠️ RPC not available, using direct queries');
      }

      // Fallback: Requêtes directes
      const { data: campaignsData } = await supabase.from('campaigns').select('status, views, budget');

      const totalCampaigns = campaignsData?.length || 0;
      const activeCampaigns = campaignsData?.filter(c => c.status === 'active').length || 0;
      const totalViews = campaignsData?.reduce((sum, c) => sum + (c.views || 0), 0) || 0;
      const totalBudget = campaignsData?.reduce((sum, c) => sum + (parseFloat(c.budget as any) || 0), 0) || 0;
      const averageBudget = totalCampaigns > 0 ? totalBudget / totalCampaigns : 0;

      const campaignsByStatus = {
        draft: campaignsData?.filter(c => c.status === 'draft').length || 0,
        pending: campaignsData?.filter(c => c.status === 'pending').length || 0,
        active: campaignsData?.filter(c => c.status === 'active').length || 0,
        paused: campaignsData?.filter(c => c.status === 'paused').length || 0,
        completed: campaignsData?.filter(c => c.status === 'completed').length || 0,
        rejected: campaignsData?.filter(c => c.status === 'rejected').length || 0
      };

      const stats: CampaignsPerformance = {
        total_campaigns: totalCampaigns,
        active_campaigns: activeCampaigns,
        total_views: totalViews,
        total_budget: totalBudget,
        average_budget: averageBudget,
        campaigns_by_status: campaignsByStatus
      };

      console.log('✅ Campaigns performance computed:', stats);
      return stats;
    } catch (error) {
      console.error('❌ Exception in getCampaignsPerformance:', error);
      return null;
    }
  },

  // Récupérer les écrans les plus performants
  async getTopScreens(limit: number = 5): Promise<TopPerformingScreen[]> {
    try {
      console.log('🔍 Fetching top performing screens...');
      
      // Essayer avec RPC
      try {
        const { data, error } = await supabase.rpc('get_top_performing_screens', { limit_count: limit });
        if (!error && data) {
          console.log('✅ Top screens fetched via RPC');
          return data;
        }
      } catch (rpcError) {
        console.log('⚠️ RPC not available, using direct queries');
      }

      // Fallback: Requêtes directes avec jointure
      const { data: screensData } = await supabase
        .from('screens')
        .select(`
          id,
          name,
          location,
          total_revenue,
          monthly_revenue,
          owner_id
        `)
        .order('total_revenue', { ascending: false })
        .limit(limit);

      if (!screensData) return [];

      // Récupérer les noms des propriétaires
      const ownerIds = screensData.map(s => s.owner_id);
      const { data: ownersData } = await supabase
        .from('business_profiles')
        .select('user_id, business_name')
        .in('user_id', ownerIds);

      const ownerMap = new Map();
      ownersData?.forEach(o => ownerMap.set(o.user_id, o.business_name));

      const topScreens: TopPerformingScreen[] = screensData.map(s => ({
        screen_id: s.id,
        screen_name: s.name,
        location: s.location,
        total_revenue: s.total_revenue || 0,
        monthly_revenue: s.monthly_revenue || 0,
        owner_business_name: ownerMap.get(s.owner_id) || 'N/A'
      }));

      console.log('✅ Top screens computed:', topScreens.length);
      return topScreens;
    } catch (error) {
      console.error('❌ Exception in getTopScreens:', error);
      return [];
    }
  },

  // Récupérer l'activité récente
  async getRecentActivity(limit: number = 10): Promise<RecentActivity[]> {
    try {
      console.log('🔍 Fetching recent activity...');
      
      const { data, error } = await supabase
        .rpc('get_recent_platform_activity', { limit_count: limit });

      if (error) {
        console.error('❌ Error fetching recent activity:', error);
        return [];
      }

      console.log('✅ Recent activity fetched successfully');
      return data || [];
    } catch (error) {
      console.error('❌ Exception in getRecentActivity:', error);
      return [];
    }
  }
};
