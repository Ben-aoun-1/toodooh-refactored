import { supabase } from '../lib/supabase';

export interface AdminScreen {
  id: string;
  name: string;
  location: string;
  address?: string;
  coordinates: {
    lat: number;
    lng: number;
  };
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
  owner_id: string;
  owner_name?: string;
  owner_business_name?: string;
  affluence_stats?: {
    total_measurements: number;
    avg_passby: number;
    avg_turnback: number;
    avg_stay_time: number;
    last_measurement?: string;
    last_heartbeat?: string;
  };
}

export type AdminLocationStatus =
  | 'active'
  | 'inactive'
  | 'maintenance'
  | 'unavailable'
  | 'no_screens';

export interface AdminLocation {
  id: string;
  name: string;
  address?: string;
  owner_id: string;
  owner_business_name?: string;
  status: AdminLocationStatus;
  screens_count: number;
  online_screens_count: number;
  monthly_revenue: number;
  created_at: string;
  updated_at: string;
  screens: AdminScreen[];
}

export interface ScreenAffluenceData {
  id: string;
  screen_id: string;
  sn: string;
  timestamp: string;
  hw_platform?: string;
  sw_release?: string;
  ip_address?: string;
  mac_address?: string;
  connection_type?: string;
  wifi_ssid?: string;
  ip_address_method?: string;
  host_name?: string;
  time_zone?: string;
  upload_interval?: number;
  data_mode?: string;
  last_heartbeat_time?: string;
  start_time: string;
  end_time: string;
  time: string;
  in_count: number;
  out_count: number;
  passby_count: number;
  turnback_count: number;
  avg_stay_time: number;
  attributes?: any;
  global_id?: string;
  dwell_time?: number;
  enter_camera_sn?: string;
  leave_camera_sn?: string;
  enter_timestamp?: string;
  leave_timestamp?: string;
  enter_image_path?: string;
  leave_image_path?: string;
  deduped_count: number;
  duplicate_total: number;
  original_enter_count: number;
  records?: any;
  created_at: string;
  updated_at: string;
}

export interface CreateScreenData {
  owner_id: string;
  name: string;
  location: string;
  address?: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  screen_type: 'led' | 'lcd' | 'projector' | 'other';
  resolution_width?: number;
  resolution_height?: number;
  screen_size_inches?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
  status?: 'active' | 'inactive' | 'maintenance' | 'unavailable';
  is_online?: boolean;
  installation_date?: string;
  warranty_expiry_date?: string;
  monthly_revenue?: number;
}

export interface UpdateScreenData {
  name?: string;
  location?: string;
  address?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
  screen_type?: 'led' | 'lcd' | 'projector' | 'other';
  resolution_width?: number;
  resolution_height?: number;
  screen_size_inches?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
  status?: 'active' | 'inactive' | 'maintenance' | 'unavailable';
  is_online?: boolean;
  installation_date?: string;
  warranty_expiry_date?: string;
  monthly_revenue?: number;
}

export interface CreateAffluenceData {
  screen_id: string;
  sn: string;
  start_time: string;
  end_time: string;
  in_count: number;
  out_count: number;
  passby_count: number;
  turnback_count: number;
  avg_stay_time: number;
  hw_platform?: string;
  sw_release?: string;
  ip_address?: string;
  connection_type?: string;
  wifi_ssid?: string;
  attributes?: any;
  global_id?: string;
  dwell_time?: number;
}

export interface UpdateAffluenceData {
  sn?: string;
  start_time?: string;
  end_time?: string;
  in_count?: number;
  out_count?: number;
  passby_count?: number;
  turnback_count?: number;
  avg_stay_time?: number;
  hw_platform?: string;
  sw_release?: string;
  ip_address?: string;
  connection_type?: string;
  wifi_ssid?: string;
  attributes?: any;
  global_id?: string;
  dwell_time?: number;
}

export interface ScreenStats {
  total_screens: number;
  active_screens: number;
  online_screens: number;
  maintenance_screens: number;
  total_revenue: number;
  avg_monthly_revenue: number;
  screens_by_type: {
    led: number;
    lcd: number;
    projector: number;
    other: number;
  };
  screens_by_status: {
    active: number;
    inactive: number;
    maintenance: number;
    unavailable: number;
  };
}

function computeLocationStatus(screens: AdminScreen[]): AdminLocationStatus {
  if (!screens.length) return 'no_screens';
  if (screens.some((s) => s.status === 'active' && s.is_online)) return 'active';
  if (screens.some((s) => s.status === 'active')) return 'active';
  if (screens.some((s) => s.status === 'maintenance')) return 'maintenance';
  if (screens.some((s) => s.status === 'inactive')) return 'inactive';
  return 'unavailable';
}

export const adminScreensService = {
  async getLocationsWithScreens(
    page: number = 1,
    limit: number = 20,
    filters: {
      status?: AdminLocationStatus;
      owner_id?: string;
      search?: string;
    } = {},
  ): Promise<{ locations: AdminLocation[]; total: number; totalPages: number }> {
    try {
      let query = supabase
        .from('locations')
        .select('id, name, address, owner_id, created_at, updated_at', { count: 'exact' });

      if (filters.owner_id) {
        query = query.eq('owner_id', filters.owner_id);
      }
      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,address.ilike.%${filters.search}%`);
      }

      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to).order('created_at', { ascending: false });

      const { data: locationsData, error: locationsError, count } = await query;
      if (locationsError) throw locationsError;

      const locations = locationsData || [];
      const locationIds = locations.map((l) => l.id);
      const ownerIds = [...new Set(locations.map((l) => l.owner_id))];

      const [{ data: ownersData, error: ownersError }, { data: screensData, error: screensError }] =
        await Promise.all([
          ownerIds.length
            ? supabase
                .from('business_profiles')
                .select('user_id, business_name')
                .in('user_id', ownerIds)
            : Promise.resolve({ data: [], error: null }),
          locationIds.length
            ? supabase
                .from('screens')
                .select(
                  'id, name, location_id, owner_id, location, screen_type, status, is_online, monthly_revenue, total_revenue, created_at, updated_at',
                )
                .in('location_id', locationIds)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (ownersError) throw ownersError;
      if (screensError) throw screensError;

      const ownerMap = new Map((ownersData || []).map((o) => [o.user_id, o.business_name]));
      const screensByLocation = new Map<string, AdminScreen[]>();

      (screensData || []).forEach((screen: any) => {
        const locationId = screen.location_id as string | null;
        if (!locationId) return;
        const existing = screensByLocation.get(locationId) || [];
        existing.push({
          ...screen,
          location: screen.location || '',
          coordinates: { lat: 0, lng: 0 },
          owner_name: ownerMap.get(screen.owner_id) || 'N/A',
          owner_business_name: ownerMap.get(screen.owner_id) || 'N/A',
          monthly_revenue: Number(screen.monthly_revenue) || 0,
          total_revenue: Number(screen.total_revenue) || 0,
          loyalty_points: 0,
        });
        screensByLocation.set(locationId, existing);
      });

      let mappedLocations: AdminLocation[] = locations.map((location: any) => {
        const locationScreens = screensByLocation.get(location.id) || [];
        return {
          id: location.id,
          name: location.name || 'Localité sans nom',
          address: location.address || '',
          owner_id: location.owner_id,
          owner_business_name: ownerMap.get(location.owner_id) || 'N/A',
          status: computeLocationStatus(locationScreens),
          screens_count: locationScreens.length,
          online_screens_count: locationScreens.filter((s) => s.is_online).length,
          monthly_revenue: locationScreens.reduce(
            (sum, s) => sum + (Number(s.monthly_revenue) || 0),
            0,
          ),
          created_at: location.created_at,
          updated_at: location.updated_at,
          screens: locationScreens,
        };
      });

      if (filters.status) {
        mappedLocations = mappedLocations.filter((l) => l.status === filters.status);
      }

      return {
        locations: mappedLocations,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      };
    } catch (error) {
      throw error;
    }
  },

  // Récupérer tous les écrans avec pagination et filtres
  async getScreens(
    page: number = 1,
    limit: number = 20,
    filters: {
      status?: string;
      screen_type?: string;
      is_online?: boolean;
      search?: string;
      owner_id?: string;
    } = {},
  ): Promise<{ screens: AdminScreen[]; total: number; totalPages: number }> {
    try {

      let query = supabase.from('screens').select('*', { count: 'exact' });


      // Appliquer les filtres
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.screen_type) {
        query = query.eq('screen_type', filters.screen_type);
      }
      if (filters.is_online !== undefined) {
        query = query.eq('is_online', filters.is_online);
      }
      if (filters.owner_id) {
        query = query.eq('owner_id', filters.owner_id);
      }
      if (filters.search) {
        query = query.or(`name.ilike.%${filters.search}%,location.ilike.%${filters.search}%`);
      }

      // Pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      // Tri par date de création
      query = query.order('created_at', { ascending: false });

      const { data, error, count } = await query;

      if (error) {
        throw error;
      }


      // Récupérer les noms des propriétaires
      const ownerIds = [...new Set((data || []).map((s) => s.owner_id))];
      const { data: owners } = await supabase
        .from('business_profiles')
        .select('user_id, business_name')
        .in('user_id', ownerIds);

      const ownerMap = new Map(owners?.map((o) => [o.user_id, o.business_name]) || []);

      // Transformer les données
      const screens: AdminScreen[] = (data || []).map((screen) => ({
        ...screen,
        coordinates: screen.coordinates
          ? {
              lat: screen.coordinates.x,
              lng: screen.coordinates.y,
            }
          : { lat: 0, lng: 0 },
        owner_name: ownerMap.get(screen.owner_id) || 'N/A',
        owner_business_name: ownerMap.get(screen.owner_id) || 'N/A',
      }));

      const totalPages = Math.ceil((count || 0) / limit);

      return {
        screens,
        total: count || 0,
        totalPages,
      };
    } catch (error) {
      throw error;
    }
  },

  // Récupérer un écran par ID
  async getScreenById(screenId: string): Promise<AdminScreen | null> {
    try {
      const { data, error } = await supabase
        .from('screens')
        .select('*')
        .eq('id', screenId)
        .single();

      if (error) {
        console.error("Erreur lors de la récupération de l'écran:", error);
        return null;
      }

      // Récupérer le nom du propriétaire
      const { data: owner } = await supabase
        .from('business_profiles')
        .select('business_name')
        .eq('user_id', data.owner_id)
        .single();

      return {
        ...data,
        coordinates: data.coordinates
          ? {
              lat: data.coordinates.x,
              lng: data.coordinates.y,
            }
          : { lat: 0, lng: 0 },
        owner_name: owner?.business_name || 'N/A',
        owner_business_name: owner?.business_name || 'N/A',
      };
    } catch (error) {
      console.error("Erreur lors de la récupération de l'écran:", error);
      return null;
    }
  },

  // Créer un nouvel écran (la localité liée est garantie côté DB)
  async createScreen(screenData: CreateScreenData): Promise<AdminScreen | null> {
    try {
      const coordinatesPoint =
        screenData.coordinates &&
        screenData.coordinates.lng != null &&
        screenData.coordinates.lat != null
          ? `POINT(${screenData.coordinates.lng} ${screenData.coordinates.lat})`
          : null;

      const { data, error } = await supabase
        .from('screens')
        .insert({
          owner_id: screenData.owner_id,
          name: screenData.name,
          location: screenData.location,
          address: screenData.address,
          coordinates: coordinatesPoint,
          screen_type: screenData.screen_type,
          resolution_width: screenData.resolution_width,
          resolution_height: screenData.resolution_height,
          screen_size_inches: screenData.screen_size_inches,
          orientation: screenData.orientation || 'landscape',
          status: screenData.status || 'active',
          is_online: screenData.is_online !== undefined ? screenData.is_online : true,
          installation_date: screenData.installation_date,
          warranty_expiry_date: screenData.warranty_expiry_date,
          monthly_revenue: screenData.monthly_revenue || 0,
        })
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      if (!data.location_id) {
        throw new Error(
          'Écran créé sans location_id. Vérifiez la migration SQL de liaison auto location_id.',
        );
      }

      // Récupérer le nom du propriétaire
      const { data: owner } = await supabase
        .from('business_profiles')
        .select('business_name')
        .eq('user_id', data.owner_id)
        .single();

      return {
        ...data,
        coordinates: data.coordinates
          ? {
              lat: data.coordinates.x,
              lng: data.coordinates.y,
            }
          : { lat: 0, lng: 0 },
        owner_name: owner?.business_name || 'N/A',
        owner_business_name: owner?.business_name || 'N/A',
      };
    } catch (error) {
      throw error;
    }
  },

  // Mettre à jour un écran
  async updateScreen(screenId: string, updateData: UpdateScreenData): Promise<AdminScreen | null> {
    try {
      const updateFields: any = { ...updateData };

      if (updateData.coordinates) {
        updateFields.coordinates = `POINT(${updateData.coordinates.lng} ${updateData.coordinates.lat})`;
      }

      const { data, error } = await supabase
        .from('screens')
        .update(updateFields)
        .eq('id', screenId)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      // Récupérer le nom du propriétaire
      const { data: owner } = await supabase
        .from('business_profiles')
        .select('business_name')
        .eq('user_id', data.owner_id)
        .single();

      return {
        ...data,
        coordinates: data.coordinates
          ? {
              lat: data.coordinates.x,
              lng: data.coordinates.y,
            }
          : { lat: 0, lng: 0 },
        owner_name: owner?.business_name || 'N/A',
        owner_business_name: owner?.business_name || 'N/A',
      };
    } catch (error) {
      throw error;
    }
  },

  // Supprimer un écran
  async deleteScreen(screenId: string): Promise<boolean> {
    try {
      const { error } = await supabase.from('screens').delete().eq('id', screenId);

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      throw error;
    }
  },

  // Récupérer les données d'affluence d'un écran
  async getScreenAffluenceData(
    screenId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: ScreenAffluenceData[]; total: number; totalPages: number }> {
    try {
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const { data, error, count } = await supabase
        .from('screen_affluence_data')
        .select('*', { count: 'exact' })
        .eq('screen_id', screenId)
        .order('timestamp', { ascending: false })
        .range(from, to);

      if (error) {
        throw error;
      }

      const totalPages = Math.ceil((count || 0) / limit);

      return {
        data: data || [],
        total: count || 0,
        totalPages,
      };
    } catch (error) {
      throw error;
    }
  },

  // Créer des données d'affluence
  async createAffluenceData(
    affluenceData: CreateAffluenceData,
  ): Promise<ScreenAffluenceData | null> {
    try {
      const { data, error } = await supabase
        .from('screen_affluence_data')
        .insert({
          screen_id: affluenceData.screen_id,
          sn: affluenceData.sn,
          start_time: affluenceData.start_time,
          end_time: affluenceData.end_time,
          time: new Date().toISOString(),
          in_count: affluenceData.in_count,
          out_count: affluenceData.out_count,
          passby_count: affluenceData.passby_count,
          turnback_count: affluenceData.turnback_count,
          avg_stay_time: affluenceData.avg_stay_time,
          hw_platform: affluenceData.hw_platform,
          sw_release: affluenceData.sw_release,
          ip_address: affluenceData.ip_address,
          connection_type: affluenceData.connection_type,
          wifi_ssid: affluenceData.wifi_ssid,
          attributes: affluenceData.attributes,
          global_id: affluenceData.global_id,
          dwell_time: affluenceData.dwell_time,
          timestamp: new Date().toISOString(),
          last_heartbeat_time: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  // Mettre à jour des données d'affluence
  async updateAffluenceData(
    affluenceId: string,
    updateData: UpdateAffluenceData,
  ): Promise<ScreenAffluenceData | null> {
    try {
      const { data, error } = await supabase
        .from('screen_affluence_data')
        .update(updateData)
        .eq('id', affluenceId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  // Supprimer des données d'affluence
  async deleteAffluenceData(affluenceId: string): Promise<boolean> {
    try {
      const { error } = await supabase.from('screen_affluence_data').delete().eq('id', affluenceId);

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      throw error;
    }
  },

  // Récupérer les statistiques des écrans
  async getScreenStats(): Promise<ScreenStats> {
    try {
      const { data: screens, error } = await supabase
        .from('screens')
        .select('status, screen_type, is_online, monthly_revenue, total_revenue');

      if (error) {
        throw error;
      }

      const stats: ScreenStats = {
        total_screens: screens?.length || 0,
        active_screens: screens?.filter((s) => s.status === 'active').length || 0,
        online_screens: screens?.filter((s) => s.is_online).length || 0,
        maintenance_screens: screens?.filter((s) => s.status === 'maintenance').length || 0,
        total_revenue: screens?.reduce((sum, s) => sum + (s.total_revenue || 0), 0) || 0,
        avg_monthly_revenue: screens?.length
          ? screens.reduce((sum, s) => sum + (s.monthly_revenue || 0), 0) / screens.length
          : 0,
        screens_by_type: {
          led: screens?.filter((s) => s.screen_type === 'led').length || 0,
          lcd: screens?.filter((s) => s.screen_type === 'lcd').length || 0,
          projector: screens?.filter((s) => s.screen_type === 'projector').length || 0,
          other: screens?.filter((s) => s.screen_type === 'other').length || 0,
        },
        screens_by_status: {
          active: screens?.filter((s) => s.status === 'active').length || 0,
          inactive: screens?.filter((s) => s.status === 'inactive').length || 0,
          maintenance: screens?.filter((s) => s.status === 'maintenance').length || 0,
          unavailable: screens?.filter((s) => s.status === 'unavailable').length || 0,
        },
      };

      return stats;
    } catch (error) {
      throw error;
    }
  },

  // Récupérer les propriétaires pour le formulaire (tous ceux qui ont au moins un écran)
  async getOwners(): Promise<{ id: string; business_name: string; user_id: string }[]> {
    try {
      // Récupérer les IDs uniques des propriétaires de localités
      const { data: locations, error: locationsError } = await supabase
        .from('locations')
        .select('owner_id');

      if (locationsError) {
        throw locationsError;
      }

      if (!locations || locations.length === 0) {
        return [];
      }

      // Extraire les IDs uniques
      const ownerIds = [...new Set(locations.map((l) => l.owner_id))];

      // Récupérer les informations des propriétaires
      const { data, error } = await supabase
        .from('business_profiles')
        .select('id, business_name, user_id')
        .in('user_id', ownerIds)
        .order('business_name');

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      throw error;
    }
  },
};
