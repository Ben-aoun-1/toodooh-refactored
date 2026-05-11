import { supabase } from '../lib/supabase';
import type { Location, LocationAffluenceSlot, LocationAffluenceGrid } from '../types/location';

export const locationsService = {
  async getByOwner(ownerId: string): Promise<Location[]> {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('owner_id', ownerId)
      .order('name');
    if (error) throw new Error(error.message);
    return (data || []).map(row => ({
      ...row,
      coordinates: row.coordinates ? { x: row.coordinates.x ?? row.coordinates[0], y: row.coordinates.y ?? row.coordinates[1] } : undefined,
    }));
  },

  async getById(id: string): Promise<Location | null> {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    if (!data) return null;
    return {
      ...data,
      coordinates: data.coordinates ? { x: data.coordinates.x ?? data.coordinates[0], y: data.coordinates.y ?? data.coordinates[1] } : undefined,
    };
  },

  async create(ownerId: string, params: { name: string; address?: string; coordinates?: { lat: number; lng: number } }): Promise<Location> {
    const point = params.coordinates
      ? `(${params.coordinates.lng},${params.coordinates.lat})`
      : null;
    const { data, error } = await supabase
      .from('locations')
      .insert({
        owner_id: ownerId,
        name: params.name,
        address: params.address,
        coordinates: point,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      ...data,
      coordinates: data.coordinates ? { x: data.coordinates.x ?? data.coordinates[0], y: data.coordinates.y ?? data.coordinates[1] } : undefined,
    };
  },

  async update(id: string, params: { name?: string; address?: string; coordinates?: { lat: number; lng: number } }): Promise<Location> {
    const updates: Record<string, unknown> = {};
    if (params.name != null) updates.name = params.name;
    if (params.address != null) updates.address = params.address;
    if (params.coordinates != null) {
      updates.coordinates = `(${params.coordinates.lng},${params.coordinates.lat})`;
    }
    const { data, error } = await supabase
      .from('locations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      ...data,
      coordinates: data.coordinates ? { x: data.coordinates.x ?? data.coordinates[0], y: data.coordinates.y ?? data.coordinates[1] } : undefined,
    };
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('locations').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  /** Récupérer la grille d'affluence (jour × heure) pour une localité */
  async getAffluenceSchedule(locationId: string): Promise<LocationAffluenceSlot[]> {
    const { data, error } = await supabase
      .from('location_affluence_schedule')
      .select('location_id, day_of_week, hour, estimated_impressions')
      .eq('location_id', locationId)
      .order('day_of_week')
      .order('hour');
    if (error) throw new Error(error.message);
    return data || [];
  },

  /** Enregistrer la grille d'affluence (upsert des 168 créneaux 7×24) */
  async saveAffluenceSchedule(locationId: string, grid: LocationAffluenceGrid): Promise<void> {
    const rows: { location_id: string; day_of_week: number; hour: number; estimated_impressions: number }[] = [];
    for (let dow = 1; dow <= 7; dow++) {
      const dayRow = grid[dow];
      if (!dayRow) continue;
      for (let h = 0; h <= 23; h++) {
        const val = dayRow[h];
        rows.push({
          location_id: locationId,
          day_of_week: dow,
          hour: h,
          estimated_impressions: typeof val === 'number' ? val : 0,
        });
      }
    }
    const { error: delErr } = await supabase
      .from('location_affluence_schedule')
      .delete()
      .eq('location_id', locationId);
    if (delErr) throw new Error(delErr.message);
    if (rows.length > 0) {
      const { error: insErr } = await supabase
        .from('location_affluence_schedule')
        .insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
  },

  /** Convertir une liste de slots en grille jour × heure */
  slotsToGrid(slots: LocationAffluenceSlot[]): LocationAffluenceGrid {
    const grid: LocationAffluenceGrid = {};
    for (const s of slots) {
      if (!grid[s.day_of_week]) grid[s.day_of_week] = {};
      grid[s.day_of_week][s.hour] = s.estimated_impressions;
    }
    return grid;
  },
};
