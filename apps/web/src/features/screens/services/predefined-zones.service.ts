import { apiClient } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';

// Z1 cutover: reads + the 4 scalar writes are on apps/api (`/predefined-zones`). The endpoint
// serializer returns this exact snake_case shape with latitude/longitude as numbers, so the
// interface and every consumer (wizard Haversine + Leaflet, /admin-zones) are untouched.
// uploadZoneImage stays on supabase.storage — the SOLE remaining Supabase call here, repointed in Z2
// (storage integration).
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
  // Every zone (active + inactive). The wizard filters is_active at render; the admin page needs
  // inactive too — no server-side active filter (Z1 ruling). (getAll/getById were dead code — 0
  // consumers — and deleted in Z1.)
  async getAllForAdmin(): Promise<PredefinedZone[]> {
    return apiClient.get<PredefinedZone[]>('/predefined-zones');
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
    return apiClient.post<PredefinedZone>('/predefined-zones', zone);
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
    return apiClient.patch<PredefinedZone>(`/predefined-zones/${id}`, updates);
  },

  async delete(id: string): Promise<void> {
    await apiClient.del(`/predefined-zones/${id}`);
  },

  async toggleActive(id: string, isActive: boolean): Promise<PredefinedZone> {
    return apiClient.patch<PredefinedZone>(`/predefined-zones/${id}/active`, {
      is_active: isActive,
    });
  },

  /**
   * Upload une image pour une zone (bucket zone-images). Retourne l'URL publique.
   * SOLE remaining Supabase call in this service — repointed in Z2 (storage integration).
   */
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
