import { supabase } from '../lib/supabase';

export interface Screen {
  id: string;
  owner_id: string;
  name: string;
  location: string;
  location_id?: string;
  address?: string;
  coordinates?: { x: number; y: number };
  screen_type: 'led' | 'lcd' | 'projector' | 'other';
  resolution_width?: number;
  resolution_height?: number;
  screen_size_inches?: number;
  orientation: 'landscape' | 'portrait' | 'square';
  status: 'active' | 'inactive' | 'maintenance' | 'unavailable';
  is_online: boolean;
  last_heartbeat?: string;
  installation_date?: string;
  warranty_expiry_date?: string;
  monthly_revenue: number;
  total_revenue: number;
  loyalty_points: number;
  created_at: string;
  updated_at: string;
}

export interface ScreenConfiguration {
  id: string;
  screen_id: string;
  brightness_level: number;
  volume_level: number;
  auto_brightness: boolean;
  auto_volume: boolean;
  timezone: string;
  language: string;
  refresh_rate: number;
  power_schedule?: any;
  maintenance_mode: boolean;
  created_at: string;
  updated_at: string;
}

export interface UnavailabilityPeriod {
  id: string;
  screen_id: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ScreenStatistics {
  id: string;
  screen_id: string;
  date: string;
  total_playtime_minutes: number;
  total_campaigns_played: number;
  total_revenue: number;
  uptime_percentage: number;
  error_count: number;
  maintenance_duration_minutes: number;
  created_at: string;
}

export interface ScreenAlert {
  id: string;
  screen_id: string;
  alert_type:
    | 'offline'
    | 'maintenance'
    | 'error'
    | 'low_brightness'
    | 'high_temperature'
    | 'network_issue';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  is_resolved: boolean;
  resolved_at?: string;
  resolved_by?: string;
  created_at: string;
}

export interface ScreenActivityLog {
  id: string;
  screen_id: string;
  action: string;
  details?: any;
  performed_by?: string;
  created_at: string;
}

export interface CreateScreenData {
  name: string;
  location: string;
  address?: string;
  coordinates?: { x: number; y: number };
  screen_type?: 'led' | 'lcd' | 'projector' | 'other';
  resolution_width?: number;
  resolution_height?: number;
  screen_size_inches?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
}

export interface CreateUnavailabilityData {
  screen_id: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  reason: string;
}

export interface UpdateScreenData {
  name?: string;
  location?: string;
  address?: string;
  coordinates?: { x: number; y: number };
  screen_type?: 'led' | 'lcd' | 'projector' | 'other';
  resolution_width?: number;
  resolution_height?: number;
  screen_size_inches?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
  status?: 'active' | 'inactive' | 'maintenance' | 'unavailable';
}

export interface UpdateConfigurationData {
  brightness_level?: number;
  volume_level?: number;
  auto_brightness?: boolean;
  auto_volume?: boolean;
  timezone?: string;
  language?: string;
  refresh_rate?: number;
  power_schedule?: any;
  maintenance_mode?: boolean;
}

class ScreensService {
  // Récupérer tous les écrans de l'utilisateur connecté
  async getScreens(): Promise<Screen[]> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return [];
      }


      // Récupérer UNIQUEMENT les écrans du propriétaire connecté
      const { data, error } = await supabase
        .from('screens')
        .select('*')
        .eq('owner_id', user.id) // Filtrer par propriétaire
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Erreur Supabase:', error);
        console.error("Détails de l'erreur:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }


      if (data && data.length > 0) {
        data.forEach((screen, index) => {
        });
      } else {
      }

      return data || [];
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des écrans:', error);
      throw error;
    }
  }

  // Récupérer un écran par ID
  async getScreenById(id: string): Promise<Screen | null> {
    try {
      const { data, error } = await supabase.from('screens').select('*').eq('id', id).single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Erreur lors de la récupération de l'écran:", error);
      throw error;
    }
  }

  // Créer un nouvel écran (la localité liée est garantie côté DB)
  async createScreen(screenData: CreateScreenData): Promise<Screen> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Utilisateur non connecté');


      let coordinatesPoint: string | null = null;
      if (screenData.coordinates) {
        const lng = (screenData.coordinates as any).x ?? (screenData.coordinates as any).lng;
        const lat = (screenData.coordinates as any).y ?? (screenData.coordinates as any).lat;
        if (lng != null && lat != null) {
          coordinatesPoint = `(${lng},${lat})`;
        }
      }

      const insertData: any = {
        owner_id: user.id,
        name: screenData.name,
        location: screenData.location,
        address: screenData.address,
        screen_type: screenData.screen_type || 'led',
        resolution_width: screenData.resolution_width || 1920,
        resolution_height: screenData.resolution_height || 1080,
        screen_size_inches: screenData.screen_size_inches || 55.0,
        orientation: screenData.orientation || 'landscape',
        status: 'active',
        is_online: false,
        monthly_revenue: 0,
        total_revenue: 0,
        loyalty_points: 0,
        installation_date: new Date().toISOString().split('T')[0],
      };

      if (coordinatesPoint) {
        insertData.coordinates = coordinatesPoint;
      }


      const { data, error } = await supabase.from('screens').insert(insertData).select().single();

      if (error) {
        console.error('❌ Erreur Supabase lors de la création:', error);
        console.error("Détails de l'erreur:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      if (!data.location_id) {
        throw new Error(
          'Écran créé sans location_id. Vérifiez la migration SQL de liaison auto location_id.',
        );
      }

      return data;
    } catch (error) {
      console.error("❌ Erreur lors de la création de l'écran:", error);
      throw error;
    }
  }

  // Mettre à jour un écran
  async updateScreen(id: string, updateData: UpdateScreenData): Promise<Screen> {
    try {
      const { data, error } = await supabase
        .from('screens')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Erreur lors de la mise à jour de l'écran:", error);
      throw error;
    }
  }

  // Supprimer un écran
  async deleteScreen(id: string): Promise<void> {
    try {
      const { error } = await supabase.from('screens').delete().eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error("Erreur lors de la suppression de l'écran:", error);
      throw error;
    }
  }

  // Récupérer la configuration d'un écran
  async getScreenConfiguration(screenId: string): Promise<ScreenConfiguration | null> {
    try {
      const { data, error } = await supabase
        .from('screen_configurations')
        .select('*')
        .eq('screen_id', screenId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Erreur lors de la récupération de la configuration:', error);
      throw error;
    }
  }

  // Mettre à jour la configuration d'un écran
  async updateScreenConfiguration(
    screenId: string,
    configData: UpdateConfigurationData,
  ): Promise<ScreenConfiguration> {
    try {
      const { data, error } = await supabase
        .from('screen_configurations')
        .update(configData)
        .eq('screen_id', screenId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la configuration:', error);
      throw error;
    }
  }

  // Récupérer les périodes d'indisponibilité d'un écran
  async getUnavailabilityPeriods(screenId?: string): Promise<UnavailabilityPeriod[]> {
    try {
      let query = supabase
        .from('screen_unavailability_periods')
        .select('*')
        .order('start_date', { ascending: true });

      if (screenId) {
        query = query.eq('screen_id', screenId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Erreur lors de la récupération des périodes d'indisponibilité:", error);
      throw error;
    }
  }

  // Créer une période d'indisponibilité
  async createUnavailabilityPeriod(
    unavailabilityData: CreateUnavailabilityData,
  ): Promise<UnavailabilityPeriod> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Utilisateur non connecté');

      const { data, error } = await supabase
        .from('screen_unavailability_periods')
        .insert({
          ...unavailabilityData,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Erreur lors de la création de la période d'indisponibilité:", error);
      throw error;
    }
  }

  // Supprimer une période d'indisponibilité
  async deleteUnavailabilityPeriod(id: string): Promise<void> {
    try {
      const { error } = await supabase.from('screen_unavailability_periods').delete().eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error("Erreur lors de la suppression de la période d'indisponibilité:", error);
      throw error;
    }
  }

  // Récupérer les statistiques d'un écran
  async getScreenStatistics(screenId: string, days: number = 30): Promise<ScreenStatistics[]> {
    try {
      const { data, error } = await supabase
        .from('screen_statistics')
        .select('*')
        .eq('screen_id', screenId)
        .gte('date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('date', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      throw error;
    }
  }

  // Récupérer les alertes d'un écran
  async getScreenAlerts(screenId?: string, resolved?: boolean): Promise<ScreenAlert[]> {
    try {
      let query = supabase
        .from('screen_alerts')
        .select('*')
        .order('created_at', { ascending: false });

      if (screenId) {
        query = query.eq('screen_id', screenId);
      }

      if (resolved !== undefined) {
        query = query.eq('is_resolved', resolved);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Erreur lors de la récupération des alertes:', error);
      throw error;
    }
  }

  // Marquer une alerte comme résolue
  async resolveAlert(id: string): Promise<ScreenAlert> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Utilisateur non connecté');

      const { data, error } = await supabase
        .from('screen_alerts')
        .update({
          is_resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: user.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Erreur lors de la résolution de l'alerte:", error);
      throw error;
    }
  }

  // Récupérer les logs d'activité d'un écran
  async getScreenActivityLogs(screenId: string, limit: number = 50): Promise<ScreenActivityLog[]> {
    try {
      const { data, error } = await supabase
        .from('screen_activity_logs')
        .select('*')
        .eq('screen_id', screenId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Erreur lors de la récupération des logs d'activité:", error);
      throw error;
    }
  }

  // Créer un log d'activité
  async createActivityLog(screenId: string, action: string, details?: any): Promise<void> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from('screen_activity_logs').insert({
        screen_id: screenId,
        action,
        details,
        performed_by: user?.id,
      });

      if (error) throw error;
    } catch (error) {
      console.error("Erreur lors de la création du log d'activité:", error);
      throw error;
    }
  }

  // Vérifier et mettre à jour les statuts d'indisponibilité
  async checkUnavailabilityStatus(): Promise<void> {
    try {
      const { error } = await supabase.rpc('check_unavailability_status');

      if (error) throw error;
    } catch (error) {
      console.error("Erreur lors de la vérification des statuts d'indisponibilité:", error);
      throw error;
    }
  }

  // Récupérer les statistiques globales
  async getGlobalStatistics(): Promise<{
    totalScreens: number;
    activeScreens: number;
    totalRevenue: number;
    monthlyRevenue: number;
    totalLoyaltyPoints: number;
    alertsCount: number;
  }> {
    try {
      const { data: screens } = await supabase
        .from('screens')
        .select('status, total_revenue, monthly_revenue, loyalty_points');

      const { data: alerts } = await supabase
        .from('screen_alerts')
        .select('id')
        .eq('is_resolved', false);

      const totalScreens = screens?.length || 0;
      const activeScreens = screens?.filter((s) => s.status === 'active').length || 0;
      const totalRevenue = screens?.reduce((sum, s) => sum + (s.total_revenue || 0), 0) || 0;
      const monthlyRevenue = screens?.reduce((sum, s) => sum + (s.monthly_revenue || 0), 0) || 0;
      const totalLoyaltyPoints = screens?.reduce((sum, s) => sum + (s.loyalty_points || 0), 0) || 0;
      const alertsCount = alerts?.length || 0;

      return {
        totalScreens,
        activeScreens,
        totalRevenue,
        monthlyRevenue,
        totalLoyaltyPoints,
        alertsCount,
      };
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques globales:', error);
      throw error;
    }
  }
}

export const screensService = new ScreensService();
