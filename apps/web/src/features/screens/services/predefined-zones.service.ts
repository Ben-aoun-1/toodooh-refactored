import { apiClient } from '@/lib/api-client';

// Zones cutover COMPLETE (Z1 reads + scalar writes; Z2 image upload). The whole service is on
// apps/api (`/predefined-zones`); no Supabase. The GET serializer returns this exact snake_case
// shape with latitude/longitude as numbers and image_url as /storage/<key>, so the interface and
// every consumer (wizard Haversine + Leaflet, /admin-zones) are untouched.
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
   * Upload une image pour une zone → POST /predefined-zones/:id/image (admin, multipart). The route
   * stores at the stable key zones/<id>, persists image_url server-side, and returns the bare key.
   * Compose the relative /storage/<key> the consumers render directly (the C2→C4 contract's second
   * composition site; the GET serializer is the first — accepted duplication, not hoisted this slice).
   */
  async uploadZoneImage(zoneId: string, file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const { key } = await apiClient.postForm<{ id: string; key: string }>(
      `/predefined-zones/${zoneId}/image`,
      form,
    );
    return `/storage/${key}`;
  },
};
