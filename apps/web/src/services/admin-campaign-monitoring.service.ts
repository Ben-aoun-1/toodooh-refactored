import { supabase } from '../lib/supabase';
import {
  CampaignMonitoringData,
  CampaignGlobalStats,
  CampaignByCategory,
  TopAdvertiser,
  MostUsedScreen,
  CampaignLocation,
  CampaignImpressionProgress
} from '../types/campaign-monitoring';

class AdminCampaignMonitoringService {
  /**
   * Récupérer les statistiques globales des campagnes
   */
  async getGlobalStats(): Promise<CampaignGlobalStats> {
    try {
      console.log('📊 Fetching campaign global stats...');
      
      // Essayer avec RPC d'abord
      const { data, error } = await supabase.rpc('get_campaigns_global_stats');

      if (error) {
        console.warn('⚠️ RPC get_campaigns_global_stats failed, using fallback:', error.message);
        
        // Fallback: requête directe
        const { data: campaigns, error: fallbackError } = await supabase
          .from('campaigns')
          .select('status, budget, views');

        if (fallbackError) throw fallbackError;

        const stats: CampaignGlobalStats = {
          total_campaigns: campaigns?.length || 0,
          active_campaigns: campaigns?.filter(c => c.status === 'active').length || 0,
          pending_campaigns: campaigns?.filter(c => c.status === 'pending').length || 0,
          completed_campaigns: campaigns?.filter(c => c.status === 'completed').length || 0,
          paused_campaigns: campaigns?.filter(c => c.status === 'paused').length || 0,
          total_budget: campaigns?.reduce((sum, c) => sum + (parseFloat(c.budget) || 0), 0) || 0,
          active_budget: campaigns?.filter(c => c.status === 'active').reduce((sum, c) => sum + (parseFloat(c.budget) || 0), 0) || 0,
          total_views: campaigns?.reduce((sum, c) => sum + (c.views || 0), 0) || 0,
          avg_budget: campaigns?.length ? (campaigns.reduce((sum, c) => sum + (parseFloat(c.budget) || 0), 0) / campaigns.length) : 0
        };

        return stats;
      }

      console.log('✅ Campaign global stats fetched:', data);
      return data as CampaignGlobalStats;
    } catch (error) {
      console.error('❌ Error fetching campaign global stats:', error);
      throw error;
    }
  }

  /**
   * Récupérer toutes les campagnes avec leurs écrans
   */
  async getCampaignsWithScreens(): Promise<CampaignMonitoringData[]> {
    try {
      console.log('📋 Fetching campaigns (light) for monitoring...');

      // Priorité à la vue (plus légère que la RPC complète)
      const { data: viewData, error: viewError } = await supabase
        .from('admin_campaigns_monitoring')
        .select('*')
        .order('created_at', { ascending: false });

      if (!viewError && viewData) {
        return viewData.map((row: any) => ({
          ...row,
          screens_list: []
        })) as CampaignMonitoringData[];
      }

      console.warn('⚠️ View admin_campaigns_monitoring failed, trying RPC/direct fallback');

      // Fallback 1: RPC (on retire la liste lourde des écrans)
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_campaigns_with_screens');
      if (!rpcError && rpcData) {
        return (rpcData as any[]).map((row) => ({
          ...row,
          screens_list: []
        })) as CampaignMonitoringData[];
      }

      // Fallback 2: requête directe consolidée (sans N+1)
      const { data: campaigns, error: directError } = await supabase
        .from('campaigns')
        .select(`
          id,
          name,
          user_id,
          client_id,
          category,
          status,
          budget,
          views,
          start_date,
          end_date,
          content_validation_status,
          video_id,
          created_at
        `)
        .order('created_at', { ascending: false });

      if (directError) throw directError;

      const campaignRows = campaigns || [];
      const advertiserIds = [...new Set(campaignRows.map((c: any) => c.user_id).filter(Boolean))];
      const clientIds = [...new Set(campaignRows.map((c: any) => c.client_id).filter(Boolean))];
      const videoIds = [...new Set(campaignRows.map((c: any) => c.video_id).filter(Boolean))];
      const campaignIds = campaignRows.map((c: any) => c.id);

      const [
        { data: profilesData },
        { data: clientsData },
        { data: videosData },
        { data: campaignScreensData }
      ] = await Promise.all([
        advertiserIds.length
          ? supabase.from('business_profiles').select('user_id, business_name, contact_name, email').in('user_id', advertiserIds)
          : Promise.resolve({ data: [] as any[] }),
        clientIds.length
          ? supabase.from('clients').select('id, name').in('id', clientIds)
          : Promise.resolve({ data: [] as any[] }),
        videoIds.length
          ? supabase.from('videos').select('id, url, filename').in('id', videoIds)
          : Promise.resolve({ data: [] as any[] }),
        campaignIds.length
          ? supabase.from('campaign_screens').select('campaign_id').in('campaign_id', campaignIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const profileMap = new Map((profilesData || []).map((p: any) => [p.user_id, p]));
      const clientMap = new Map((clientsData || []).map((c: any) => [c.id, c]));
      const videoMap = new Map((videosData || []).map((v: any) => [v.id, v]));
      const screensCountMap = new Map<string, number>();
      (campaignScreensData || []).forEach((r: any) => {
        const id = String(r.campaign_id);
        screensCountMap.set(id, (screensCountMap.get(id) || 0) + 1);
      });

      return campaignRows.map((campaign: any) => {
        const profile = profileMap.get(campaign.user_id);
        const client = campaign.client_id ? clientMap.get(campaign.client_id) : null;
        const video = campaign.video_id ? videoMap.get(campaign.video_id) : null;

        return {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          advertiser_id: campaign.user_id,
          advertiser_name: profile?.business_name || profile?.contact_name || 'N/A',
          advertiser_email: profile?.email || 'N/A',
          client_id: campaign.client_id,
          client_name: client?.name || 'N/A',
          category: campaign.category,
          status: campaign.status,
          budget: parseFloat(campaign.budget) || 0,
          views: campaign.views || 0,
          start_date: campaign.start_date,
          end_date: campaign.end_date,
          content_validation_status: campaign.content_validation_status || 'pending',
          video_url: video?.url,
          video_filename: video?.filename,
          screens_count: screensCountMap.get(String(campaign.id)) || 0,
          screens_list: [],
          created_at: campaign.created_at
        } as CampaignMonitoringData;
      });
    } catch (error) {
      console.error('❌ Error fetching campaigns with screens:', error);
      throw error;
    }
  }

  /**
   * Récupérer les campagnes par statut
   */
  async getCampaignsByStatus(status: string): Promise<CampaignMonitoringData[]> {
    try {
      console.log(`📋 Fetching campaigns with status: ${status}`);

      const { data, error } = await supabase.rpc('get_campaigns_by_status', { p_status: status });

      if (error) {
        console.warn('⚠️ RPC failed, using direct query:', error.message);

        const { data: campaigns, error: fallbackError } = await supabase
          .from('campaigns')
          .select('*')
          .eq('status', status)
          .order('created_at', { ascending: false });

        if (fallbackError) throw fallbackError;

        return campaigns as any;
      }

      return data as CampaignMonitoringData[];
    } catch (error) {
      console.error('❌ Error fetching campaigns by status:', error);
      throw error;
    }
  }

  /**
   * Récupérer les campagnes par catégorie
   */
  async getCampaignsByCategory(): Promise<CampaignByCategory[]> {
    try {
      console.log('📊 Fetching campaigns by category...');

      const { data, error } = await supabase.rpc('get_campaigns_by_category');

      if (error) {
        console.warn('⚠️ RPC failed, using fallback:', error.message);

        const { data: campaigns, error: fallbackError } = await supabase
          .from('campaigns')
          .select('category, budget, views');

        if (fallbackError) throw fallbackError;

        // Grouper par catégorie
        const grouped = campaigns?.reduce((acc, c) => {
          const cat = c.category || 'other';
          if (!acc[cat]) {
            acc[cat] = { category: cat, count: 0, total_budget: 0, total_views: 0 };
          }
          acc[cat].count++;
          acc[cat].total_budget += parseFloat(c.budget) || 0;
          acc[cat].total_views += c.views || 0;
          return acc;
        }, {} as Record<string, CampaignByCategory>);

        return Object.values(grouped || {});
      }

      return data as CampaignByCategory[];
    } catch (error) {
      console.error('❌ Error fetching campaigns by category:', error);
      throw error;
    }
  }

  /**
   * Récupérer les top annonceurs
   */
  async getTopAdvertisers(limit: number = 10): Promise<TopAdvertiser[]> {
    try {
      console.log('👑 Fetching top advertisers...');

      const { data, error } = await supabase.rpc('get_top_advertisers', { limit_count: limit });

      if (error) {
        console.warn('⚠️ RPC failed, using fallback:', error.message);
        return [];
      }

      return data as TopAdvertiser[];
    } catch (error) {
      console.error('❌ Error fetching top advertisers:', error);
      throw error;
    }
  }

  /**
   * Récupérer les écrans les plus utilisés
   */
  async getMostUsedScreens(limit: number = 10): Promise<MostUsedScreen[]> {
    try {
      console.log('📺 Fetching most used screens...');

      const { data, error } = await supabase.rpc('get_most_used_screens', { limit_count: limit });

      if (error) {
        console.warn('⚠️ RPC failed, using fallback:', error.message);
        return [];
      }

      return data as MostUsedScreen[];
    } catch (error) {
      console.error('❌ Error fetching most used screens:', error);
      throw error;
    }
  }

  /**
   * Récupérer les détails d'une campagne spécifique avec tous ses écrans
   */
  async getCampaignDetails(campaignId: string): Promise<CampaignMonitoringData | null> {
    try {
      console.log(`🔍 Fetching campaign details for: ${campaignId}`);

      const campaigns = await this.getCampaignsWithScreens();
      const campaign = campaigns.find(c => c.campaign_id === campaignId);

      return campaign || null;
    } catch (error) {
      console.error('❌ Error fetching campaign details:', error);
      throw error;
    }
  }

  /**
   * Récupérer les écrans associés à une campagne
   */
  async getCampaignLocations(campaignId: string): Promise<CampaignLocation[]> {
    try {
      console.log(`📍 Fetching locations for campaign: ${campaignId}`);

      // Source principale: campagne -> localités
      const { data: campaignLocations, error: campaignLocationsError } = await supabase
        .from('campaign_locations')
        .select('location_id')
        .eq('campaign_id', campaignId);

      let locationIds = (campaignLocations || []).map((r: any) => r.location_id).filter(Boolean);

      // Fallback legacy si campaign_locations est vide
      if (locationIds.length === 0) {
        const { data: campaignScreens } = await supabase
          .from('campaign_screens')
          .select('screens(location_id)')
          .eq('campaign_id', campaignId);
        locationIds = Array.from(
          new Set(
            (campaignScreens || [])
              .map((r: any) => r.screens?.location_id)
              .filter(Boolean)
          )
        ) as string[];
      }

      if (campaignLocationsError && locationIds.length === 0) throw campaignLocationsError;
      if (locationIds.length === 0) return [];

      const [{ data: locationsData, error: locationsError }, { data: screensData, error: screensError }] =
        await Promise.all([
          supabase.from('locations').select('id, name, address, owner_id').in('id', locationIds),
          supabase
            .from('screens')
            .select('id, location_id, status, is_online')
            .in('location_id', locationIds),
        ]);

      if (locationsError) throw locationsError;
      if (screensError) throw screensError;

      const ownerIds = [...new Set((locationsData || []).map((l: any) => l.owner_id).filter(Boolean))];
      const { data: ownersData } = ownerIds.length
        ? await supabase
            .from('business_profiles')
            .select('user_id, business_name, contact_name')
            .in('user_id', ownerIds)
        : { data: [] as any[] };

      const ownerMap = new Map(
        (ownersData || []).map((o: any) => [o.user_id, o.business_name || o.contact_name || 'N/A'])
      );

      const screensByLocation = new Map<string, any[]>();
      (screensData || []).forEach((s: any) => {
        const list = screensByLocation.get(s.location_id) || [];
        list.push(s);
        screensByLocation.set(s.location_id, list);
      });

      const getLocationStatus = (locationScreens: any[]): CampaignLocation['location_status'] => {
        if (!locationScreens.length) return 'no_screens';
        if (locationScreens.some((s) => s.status === 'active' && s.is_online)) return 'active';
        if (locationScreens.some((s) => s.status === 'active')) return 'active';
        if (locationScreens.some((s) => s.status === 'maintenance')) return 'maintenance';
        if (locationScreens.some((s) => s.status === 'inactive')) return 'inactive';
        return 'unavailable';
      };

      const locations: CampaignLocation[] = (locationsData || []).map((location: any) => {
        const locationScreens = screensByLocation.get(location.id) || [];
        return {
          location_id: location.id,
          location_name: location.name || 'Localité sans nom',
          location_address: location.address || 'Adresse non renseignée',
          owner_name: ownerMap.get(location.owner_id) || 'N/A',
          screens_count: locationScreens.length,
          online_screens_count: locationScreens.filter((s) => !!s.is_online).length,
          location_status: getLocationStatus(locationScreens),
        };
      });

      console.log(`✅ Found ${locations.length} locations for campaign`);
      return locations;
    } catch (error) {
      console.error('❌ Error fetching campaign locations:', error);
      return [];
    }
  }

  async getCampaignImpressionProgress(campaignId: string): Promise<CampaignImpressionProgress> {
    try {
      const [{ data: planRows, error: planError }, { data: campaignRow, error: campaignError }] = await Promise.all([
        supabase
          .from('campaign_hourly_location_plan')
          .select('planned_impressions')
          .eq('campaign_id', campaignId),
        supabase
          .from('campaigns')
          .select('views')
          .eq('id', campaignId)
          .maybeSingle(),
      ]);

      if (planError) throw planError;
      if (campaignError) throw campaignError;

      const planned = (planRows || []).reduce((sum: number, row: any) => sum + (Number(row.planned_impressions) || 0), 0);
      const realized = Math.max(0, Number(campaignRow?.views) || 0);
      const completionRate = planned > 0 ? (realized / planned) * 100 : 0;

      return {
        planned_impressions: planned,
        realized_impressions: realized,
        completion_rate: Math.max(0, completionRate),
      };
    } catch (error) {
      console.error('❌ Error fetching campaign impression progress:', error);
      return {
        planned_impressions: 0,
        realized_impressions: 0,
        completion_rate: 0,
      };
    }
  }
}

export const adminCampaignMonitoringService = new AdminCampaignMonitoringService();

