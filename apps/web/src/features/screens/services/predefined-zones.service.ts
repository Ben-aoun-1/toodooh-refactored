import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = logger.child({ module: 'predefined-zones.service' });

export interface PredefinedZone {
  id: string;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  radius: number;
  is_active: boolean;
  image_url?: string | null;
  is_hot?: boolean;
  country?: string | null;
  region?: string | null;
  created_at: string;
  updated_at: string;
}

export const predefinedZonesService = {
  async getAll(): Promise<PredefinedZone[]> {
    const { data, error } = await supabase
      .from('predefined_zones')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      log.error({ error }, '❌ Erreur lors de la récupération des zones prédéfinies');
      log.error(
        { message: error.message, details: error.details, hint: error.hint, code: error.code },
        'Détails',
      );
      throw error;
    }

    return data || [];
  },

  async getById(id: string): Promise<PredefinedZone | null> {
    const { data, error } = await supabase
      .from('predefined_zones')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      log.error({ error }, 'Erreur lors de la récupération de la zone prédéfinie');
      return null;
    }

    return data;
  },

  // Méthodes admin pour gérer les zones
  async getAllForAdmin(): Promise<PredefinedZone[]> {
    const { data, error } = await supabase
      .from('predefined_zones')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async create(zone: {
    name: string;
    description?: string | null;
    latitude: number;
    longitude: number;
    radius: number;
    is_active?: boolean;
    image_url?: string | null;
    is_hot?: boolean;
    country?: string | null;
    region?: string | null;
  }): Promise<PredefinedZone> {
    const { data, error } = await supabase
      .from('predefined_zones')
      .insert([
        {
          ...zone,
          is_active: zone.is_active !== undefined ? zone.is_active : true,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(
    id: string,
    updates: {
      name?: string;
      description?: string | null;
      latitude?: number;
      longitude?: number;
      radius?: number;
      is_active?: boolean;
      image_url?: string | null;
      is_hot?: boolean;
      country?: string | null;
      region?: string | null;
    },
  ): Promise<PredefinedZone> {
    const { data, error } = await supabase
      .from('predefined_zones')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('predefined_zones').delete().eq('id', id);

    if (error) throw error;
  },

  async toggleActive(id: string, isActive: boolean): Promise<PredefinedZone> {
    const { data, error } = await supabase
      .from('predefined_zones')
      .update({ is_active: isActive })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /** Upload une image pour une zone (bucket zone-images). Retourne l'URL publique. */
  async uploadZoneImage(zoneId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${zoneId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('zone-images')
      .upload(path, file, { contentType: file.type, upsert: true });
    if (error) throw error;
    const {
      data: { publicUrl },
    } = supabase.storage.from('zone-images').getPublicUrl(path);
    return publicUrl;
  },
};
