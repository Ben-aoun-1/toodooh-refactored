import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import type { LocationAffluenceSlot } from '../types/location';

const log = logger.child({ module: 'campaign-screens.service' });

/** Localité pour la carte et le ciblage campagne (une entrée par localité, pas par écran) */
export interface CampaignLocation {
  id: string;
  name: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  owner_id: string;
  owner_category?: string | null;
  owner_name?: string;
  screen_count: number;
  /** Grille affluence (créneaux jour × heure) pour calcul CPM */
  affluence_schedule?: LocationAffluenceSlot[];
  /** Somme des impressions sur la grille (7j × 24h) pour affichage */
  total_impressions_per_week?: number;
}

export interface CampaignScreen {
  id: string;
  name: string;
  location: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  screen_type: 'led' | 'lcd' | 'projector' | 'other';
  status: 'active' | 'inactive' | 'maintenance' | 'unavailable';
  is_online: boolean;
  monthly_revenue: number;
  owner_name?: string;
  affluence_data?: {
    avg_passby: number;
    avg_turnback: number;
    avg_stay_time: number;
    estimated_impressions_per_hour: number;
    peak_hour: number;
    peak_count: number;
    total_measurements: number;
    last_heartbeat: string;
    unique_sensors: number;
    sensor_info?: {
      sn: string;
      hw_platform: string;
      sw_release: string;
      ip_address: string;
      connection_type: string;
      last_heartbeat: string;
    };
  };
}

export const campaignScreensService = {
  // Récupérer tous les écrans actifs pour les campagnes
  async getAllScreens(): Promise<CampaignScreen[]> {
    try {
      const { data, error } = await supabase
        .from('screens')
        .select(
          'id, name, location, address, coordinates, screen_type, status, is_online, monthly_revenue, owner_id',
        )
        .eq('status', 'active');
      // Enlever le filtre is_online pour afficher tous les écrans actifs

      if (error) {
        log.error({ error }, 'Erreur lors de la récupération des écrans');
        return [];
      }

      // Récupérer les noms des propriétaires
      const ownerIds = [...new Set((data || []).map((s) => s.owner_id))];
      const { data: owners } = await supabase
        .from('business_profiles')
        .select('user_id, business_name')
        .in('user_id', ownerIds);

      const ownerMap = new Map(owners?.map((o) => [o.user_id, o.business_name]) || []);

      // Récupérer les données d'affluence pour chaque écran
      const screensWithAffluence = await Promise.all(
        (data || []).map(async (screen, _index) => {
          const affluenceData = await this.getScreenAffluenceData(screen.id);

          // Extraire les coordonnées (format POINT PostgreSQL)
          let coordinates = undefined;
          if (screen.coordinates) {
            try {
              if (typeof screen.coordinates === 'string') {
                // Format PostgreSQL POINT: "(lng,lat)"
                const match = screen.coordinates.match(/\(([^,]+),([^)]+)\)/);
                if (match) {
                  coordinates = {
                    lng: parseFloat(match[1]),
                    lat: parseFloat(match[2]),
                  };
                }
              } else if (screen.coordinates.x !== undefined && screen.coordinates.y !== undefined) {
                coordinates = {
                  lng: screen.coordinates.x,
                  lat: screen.coordinates.y,
                };
              }
            } catch (e) {
              log.error({ e, coordinates: screen.coordinates }, '❌ Erreur parsing coordinates');
            }
          }

          if (!coordinates) {
            log.warn(
              { name: screen.name, coordinates: screen.coordinates },
              '⚠️ Écran sans coordonnées',
            );
          }

          return {
            id: screen.id,
            name: screen.name,
            location: screen.location,
            address: screen.address,
            coordinates,
            screen_type: screen.screen_type,
            status: screen.status,
            is_online: screen.is_online,
            monthly_revenue: screen.monthly_revenue,
            owner_name: ownerMap.get(screen.owner_id) || 'N/A',
            affluence_data: affluenceData,
          };
        }),
      );

      return screensWithAffluence;
    } catch (error) {
      log.error({ error }, 'Erreur lors de la récupération des écrans');
      return [];
    }
  },

  // Récupérer les données d'affluence d'un écran depuis la configuration
  async getScreenAffluenceData(screenId: string) {
    try {
      // Récupérer la configuration d'affluence
      const { data: configData, error: configError } = await supabase
        .from('screen_affluence_config')
        .select('*')
        .eq('screen_id', screenId)
        .single();

      if (configError) {
        log.error({ screenId, message: configError.message }, '⚠️ Pas de config pour écran');
        // Fallback : retourner des valeurs par défaut
        return {
          avg_passby: 0,
          avg_turnback: 0,
          avg_stay_time: 0,
          estimated_impressions_per_hour: 0,
          peak_hour: 12,
          peak_count: 0,
          total_measurements: 0,
          last_heartbeat: new Date().toISOString(),
          unique_sensors: 0,
        };
      }

      // Pour les annonceurs, on utilise uniquement la config (pas besoin de screen_affluence_data)
      return {
        avg_passby: configData.avg_passby_per_hour || 0,
        avg_turnback: configData.avg_turnback_per_hour || 0,
        avg_stay_time: configData.avg_stay_time_ms || 0,
        estimated_impressions_per_hour: configData.estimated_impressions_per_hour || 0,
        peak_hour: configData.peak_hour_start || 12,
        peak_count: Math.round(
          (configData.avg_passby_per_hour + configData.avg_turnback_per_hour) *
            (configData.peak_multiplier || 1.5),
        ),
        total_measurements: 0,
        last_heartbeat: new Date().toISOString(),
        unique_sensors: 1,
      };
    } catch (error) {
      log.error({ error }, "Erreur lors de la récupération des données d'affluence");
      return undefined;
    }
  },

  // Récupérer les écrans dans une zone géographique
  async getScreensInArea(lat: number, lng: number, radiusKm: number): Promise<CampaignScreen[]> {
    try {
      // Récupérer tous les écrans actifs
      const { data, error } = await supabase
        .from('screens')
        .select(
          'id, name, location, address, coordinates, screen_type, status, is_online, monthly_revenue, owner_id',
        )
        .eq('status', 'active');
      // Enlever le filtre is_online pour afficher tous les écrans actifs

      if (error) {
        log.error({ error }, 'Erreur lors de la récupération des écrans dans la zone');
        return [];
      }

      // Récupérer les noms des propriétaires
      const ownerIds = [...new Set((data || []).map((s) => s.owner_id))];
      const { data: owners } = await supabase
        .from('business_profiles')
        .select('user_id, business_name')
        .in('user_id', ownerIds);

      const ownerMap = new Map(owners?.map((o) => [o.user_id, o.business_name]) || []);

      // Filtrer par distance et transformer
      const screensInZone: CampaignScreen[] = [];

      for (const screen of data || []) {
        // Extraire les coordonnées (POINT PostGIS: x=lng, y=lat)
        let coordinates = undefined;
        if (screen.coordinates) {
          try {
            if (typeof screen.coordinates === 'string') {
              const match = screen.coordinates.match(/\(([^,]+),([^)]+)\)/);
              if (match) {
                coordinates = {
                  lng: parseFloat(match[1]),
                  lat: parseFloat(match[2]),
                };
              }
            } else if (screen.coordinates.x !== undefined && screen.coordinates.y !== undefined) {
              coordinates = {
                lng: screen.coordinates.x,
                lat: screen.coordinates.y,
              };
            }
          } catch (e) {
            log.error({ e }, 'Erreur parsing coordinates');
          }
        }

        if (coordinates) {
          const distance = this.calculateDistance(lat, lng, coordinates.lat, coordinates.lng);

          if (distance <= radiusKm) {
            const affluenceData = await this.getScreenAffluenceData(screen.id);

            screensInZone.push({
              id: screen.id,
              name: screen.name,
              location: screen.location,
              address: screen.address,
              coordinates,
              screen_type: screen.screen_type,
              status: screen.status,
              is_online: screen.is_online,
              monthly_revenue: screen.monthly_revenue,
              owner_name: ownerMap.get(screen.owner_id) || 'N/A',
              affluence_data: affluenceData,
            });
          }
        }
      }

      return screensInZone;
    } catch (error) {
      log.error({ error }, 'Erreur lors de la récupération des écrans');
      return [];
    }
  },

  // Calculer la distance entre deux points (formule de Haversine)
  calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Rayon de la Terre en km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /** Récupérer les localités dans un rayon (carte : un marqueur par localité, pas par écran) */
  async getLocationsInArea(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<CampaignLocation[]> {
    const [locsRes, screenCountsRes] = await Promise.all([
      supabase.from('locations').select('id, name, address, coordinates, owner_id, owner_category'),
      supabase
        .from('screens')
        .select('location_id')
        .eq('status', 'active')
        .not('location_id', 'is', null),
    ]);
    const { data: locs, error } = locsRes;
    if (error) {
      log.error({ error }, 'Erreur getLocationsInArea');
      return [];
    }
    const ownerIds = [...new Set((locs || []).map((l) => l.owner_id))];
    const countByLoc = new Map<string, number>();
    for (const row of screenCountsRes.data || []) {
      if (row.location_id) {
        countByLoc.set(row.location_id, (countByLoc.get(row.location_id) || 0) + 1);
      }
    }

    const locIdsWithCoords: string[] = [];
    const coordMap = new Map<string, { lat: number; lng: number }>();
    for (const loc of locs || []) {
      if ((countByLoc.get(loc.id) || 0) === 0)
        continue; /* Règle : n'afficher que les localités avec au moins un écran */
      let coords: { lat: number; lng: number } | undefined;
      if (loc.coordinates) {
        const c = loc.coordinates as { x?: number; y?: number } | string;
        if (typeof c === 'string') {
          const m = c.match(/\(([^,]+),([^)]+)\)/);
          if (m) coords = { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
        } else if (c.x != null && c.y != null) {
          coords = { lng: c.x, lat: c.y };
        }
      }
      if (!coords) continue;
      const distance = this.calculateDistance(lat, lng, coords.lat, coords.lng);
      if (distance > radiusKm) continue;
      locIdsWithCoords.push(loc.id);
      coordMap.set(loc.id, coords);
    }

    const [ownersRes, scheduleRes] = await Promise.all([
      ownerIds.length
        ? supabase
            .from('business_profiles')
            .select('user_id, business_name')
            .in('user_id', ownerIds)
        : { data: [] },
      locIdsWithCoords.length
        ? supabase
            .from('location_affluence_schedule')
            .select('location_id, day_of_week, hour, estimated_impressions')
            .in('location_id', locIdsWithCoords)
        : { data: [] },
    ]);
    const ownerMap = new Map(
      (ownersRes.data || []).map((o: { user_id: string; business_name: string }) => [
        o.user_id,
        o.business_name,
      ]),
    );
    const scheduleByLoc = new Map<
      string,
      { day_of_week: number; hour: number; estimated_impressions: number }[]
    >();
    for (const row of scheduleRes.data || []) {
      const list = scheduleByLoc.get(row.location_id) || [];
      list.push({
        day_of_week: row.day_of_week,
        hour: row.hour,
        estimated_impressions: row.estimated_impressions || 0,
      });
      scheduleByLoc.set(row.location_id, list);
    }

    const result: CampaignLocation[] = [];
    for (const loc of locs || []) {
      if (!locIdsWithCoords.includes(loc.id)) continue;
      const coords = coordMap.get(loc.id)!;
      const schedule = scheduleByLoc.get(loc.id) || [];
      const totalPerWeek = schedule.reduce((s, r) => s + r.estimated_impressions, 0);
      result.push({
        id: loc.id,
        name: loc.name,
        address: loc.address,
        coordinates: coords,
        owner_id: loc.owner_id,
        owner_category: loc.owner_category ?? null,
        owner_name: ownerMap.get(loc.owner_id) || undefined,
        screen_count: countByLoc.get(loc.id) || 0,
        affluence_schedule: schedule.map((r) => ({
          location_id: loc.id,
          day_of_week: r.day_of_week,
          hour: r.hour,
          estimated_impressions: r.estimated_impressions,
        })),
        total_impressions_per_week: totalPerWeek,
      });
    }
    return result;
  },

  /** Récupérer toutes les localités pour la carte. Règle : n'afficher que les localités ayant au moins un écran (actif) lié. */
  async getAllLocationsForMap(): Promise<CampaignLocation[]> {
    const [locsRes, screenCountsRes] = await Promise.all([
      supabase.from('locations').select('id, name, address, coordinates, owner_id, owner_category'),
      supabase
        .from('screens')
        .select('location_id')
        .eq('status', 'active')
        .not('location_id', 'is', null),
    ]);
    const { data: locs, error } = locsRes;
    if (error) {
      log.error({ error }, 'Erreur getAllLocationsForMap');
      return [];
    }
    const countByLoc = new Map<string, number>();
    for (const row of screenCountsRes.data || []) {
      if (row.location_id) {
        countByLoc.set(row.location_id, (countByLoc.get(row.location_id) || 0) + 1);
      }
    }
    const locIdsWithCoords: string[] = [];
    const coordMap = new Map<string, { lat: number; lng: number }>();
    for (const loc of locs || []) {
      if ((countByLoc.get(loc.id) || 0) === 0)
        continue; /* Règle 1 : pas d'affichage si aucun écran dans la localité */
      let coords: { lat: number; lng: number } | undefined;
      if (loc.coordinates) {
        const c = loc.coordinates as { x?: number; y?: number } | string;
        if (typeof c === 'string') {
          const m = c.match(/\(([^,]+),([^)]+)\)/);
          if (m) coords = { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
        } else if (c.x != null && c.y != null) {
          coords = { lng: c.x, lat: c.y };
        }
      }
      if (!coords) continue;
      locIdsWithCoords.push(loc.id);
      coordMap.set(loc.id, coords);
    }
    const ownerIds = [...new Set((locs || []).map((l) => l.owner_id))];
    const [ownersRes, scheduleRes] = await Promise.all([
      ownerIds.length
        ? supabase
            .from('business_profiles')
            .select('user_id, business_name')
            .in('user_id', ownerIds)
        : { data: [] },
      locIdsWithCoords.length
        ? supabase
            .from('location_affluence_schedule')
            .select('location_id, day_of_week, hour, estimated_impressions')
            .in('location_id', locIdsWithCoords)
        : { data: [] },
    ]);
    const ownerMap = new Map(
      (ownersRes.data || []).map((o: { user_id: string; business_name: string }) => [
        o.user_id,
        o.business_name,
      ]),
    );
    const scheduleByLoc = new Map<
      string,
      { day_of_week: number; hour: number; estimated_impressions: number }[]
    >();
    for (const row of scheduleRes.data || []) {
      const list = scheduleByLoc.get(row.location_id) || [];
      list.push({
        day_of_week: row.day_of_week,
        hour: row.hour,
        estimated_impressions: row.estimated_impressions || 0,
      });
      scheduleByLoc.set(row.location_id, list);
    }
    const result: CampaignLocation[] = [];
    for (const loc of locs || []) {
      if (!locIdsWithCoords.includes(loc.id)) continue;
      const coords = coordMap.get(loc.id)!;
      const schedule = scheduleByLoc.get(loc.id) || [];
      const totalPerWeek = schedule.reduce((s, r) => s + r.estimated_impressions, 0);
      result.push({
        id: loc.id,
        name: loc.name,
        address: loc.address,
        coordinates: coords,
        owner_id: loc.owner_id,
        owner_category: loc.owner_category ?? null,
        owner_name: ownerMap.get(loc.owner_id) || undefined,
        screen_count: countByLoc.get(loc.id) || 0,
        affluence_schedule: schedule.map((r) => ({
          location_id: loc.id,
          day_of_week: r.day_of_week,
          hour: r.hour,
          estimated_impressions: r.estimated_impressions,
        })),
        total_impressions_per_week: totalPerWeek,
      });
    }
    return result;
  },

  /** Récupérer les localités avec affluence (pour liste / parcs). Optionnel : filtrer par owner_ids. */
  async getLocationsWithAffluence(ownerIds?: string[]): Promise<CampaignLocation[]> {
    let q = supabase
      .from('locations')
      .select('id, name, address, coordinates, owner_id, owner_category');
    if (ownerIds?.length) {
      q = q.in('owner_id', ownerIds);
    }
    const { data: locs, error } = await q.order('name');
    if (error) {
      log.error({ error }, 'Erreur getLocationsWithAffluence');
      return [];
    }
    const ownerIdList = [...new Set((locs || []).map((l) => l.owner_id))];
    const { data: owners } = await supabase
      .from('business_profiles')
      .select('user_id, business_name')
      .in('user_id', ownerIdList);
    const ownerMap = new Map(owners?.map((o) => [o.user_id, o.business_name]) || []);

    const { data: screens } = await supabase
      .from('screens')
      .select('location_id')
      .eq('status', 'active')
      .not('location_id', 'is', null);
    const countByLoc = new Map<string, number>();
    for (const row of screens || []) {
      if (row.location_id) {
        countByLoc.set(row.location_id, (countByLoc.get(row.location_id) || 0) + 1);
      }
    }

    const result: CampaignLocation[] = [];
    for (const loc of locs || []) {
      const screenCount = countByLoc.get(loc.id) || 0;
      let coords: { lat: number; lng: number } | undefined;
      if (loc.coordinates) {
        const c = loc.coordinates as { x?: number; y?: number } | string;
        if (typeof c === 'string') {
          const m = c.match(/\(([^,]+),([^)]+)\)/);
          if (m) coords = { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
        } else if (c.x != null && c.y != null) {
          coords = { lng: c.x, lat: c.y };
        }
      }
      const { data: schedule } = await supabase
        .from('location_affluence_schedule')
        .select('day_of_week, hour, estimated_impressions')
        .eq('location_id', loc.id);
      const totalPerWeek = (schedule || []).reduce((s, r) => s + (r.estimated_impressions || 0), 0);

      result.push({
        id: loc.id,
        name: loc.name,
        address: loc.address,
        coordinates: coords,
        owner_id: loc.owner_id,
        owner_category: loc.owner_category ?? null,
        owner_name: ownerMap.get(loc.owner_id) || undefined,
        screen_count: screenCount,
        affluence_schedule: (schedule || []).map((r) => ({
          location_id: loc.id,
          day_of_week: r.day_of_week,
          hour: r.hour,
          estimated_impressions: r.estimated_impressions || 0,
        })),
        total_impressions_per_week: totalPerWeek,
      });
    }
    return result;
  },

  /** Récupérer les localités par IDs (pour restauration en mode édition). */
  async getLocationsByIds(locationIds: string[]): Promise<CampaignLocation[]> {
    if (!locationIds.length) return [];
    const { data: locs, error } = await supabase
      .from('locations')
      .select('id, name, address, coordinates, owner_id, owner_category')
      .in('id', locationIds);
    if (error) {
      log.error({ error }, 'Erreur getLocationsByIds');
      return [];
    }
    if (!locs?.length) return [];
    const ownerIds = [...new Set(locs.map((l: { owner_id: string }) => l.owner_id))];
    const { data: owners } = await supabase
      .from('business_profiles')
      .select('user_id, business_name')
      .in('user_id', ownerIds);
    const ownerMap = new Map(
      (owners || []).map((o: { user_id: string; business_name: string }) => [
        o.user_id,
        o.business_name,
      ]),
    );
    const { data: screens } = await supabase
      .from('screens')
      .select('location_id')
      .eq('status', 'active')
      .not('location_id', 'is', null);
    const countByLoc = new Map<string, number>();
    for (const row of screens || []) {
      if (row.location_id) {
        countByLoc.set(row.location_id, (countByLoc.get(row.location_id) || 0) + 1);
      }
    }
    const { data: scheduleRows } = await supabase
      .from('location_affluence_schedule')
      .select('location_id, day_of_week, hour, estimated_impressions')
      .in('location_id', locationIds);
    const scheduleByLoc = new Map<
      string,
      { day_of_week: number; hour: number; estimated_impressions: number }[]
    >();
    for (const row of scheduleRows || []) {
      const list = scheduleByLoc.get(row.location_id) || [];
      list.push({
        day_of_week: row.day_of_week,
        hour: row.hour,
        estimated_impressions: row.estimated_impressions || 0,
      });
      scheduleByLoc.set(row.location_id, list);
    }
    const result: CampaignLocation[] = [];
    for (const loc of locs) {
      let coords: { lat: number; lng: number } | undefined;
      if (loc.coordinates) {
        const c = loc.coordinates as { x?: number; y?: number } | string;
        if (typeof c === 'string') {
          const m = c.match(/\(([^,]+),([^)]+)\)/);
          if (m) coords = { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
        } else if (c.x != null && c.y != null) {
          coords = { lng: c.x, lat: c.y };
        }
      }
      const schedule = scheduleByLoc.get(loc.id) || [];
      const totalPerWeek = schedule.reduce(
        (s: number, r: { estimated_impressions?: number }) => s + (r.estimated_impressions || 0),
        0,
      );
      result.push({
        id: loc.id,
        name: loc.name,
        address: loc.address,
        coordinates: coords,
        owner_id: loc.owner_id,
        owner_category: loc.owner_category ?? null,
        owner_name: ownerMap.get(loc.owner_id) || undefined,
        screen_count: countByLoc.get(loc.id) || 0,
        affluence_schedule: schedule.map(
          (r: {
            location_id: string;
            day_of_week: number;
            hour: number;
            estimated_impressions: number;
          }) => ({
            location_id: loc.id,
            day_of_week: r.day_of_week,
            hour: r.hour,
            estimated_impressions: r.estimated_impressions,
          }),
        ),
        total_impressions_per_week: totalPerWeek,
      });
    }
    return result;
  },

  /** Retourne les IDs d'écrans des localités données (pour indisponibilités, etc.) */
  async getScreenIdsByLocationIds(locationIds: string[]): Promise<string[]> {
    if (!locationIds.length) return [];
    const { data, error } = await supabase
      .from('screens')
      .select('id')
      .in('location_id', locationIds)
      .eq('status', 'active');
    if (error) {
      log.error({ error }, 'Erreur getScreenIdsByLocationIds');
      return [];
    }
    return (data || []).map((r) => r.id);
  },
};
