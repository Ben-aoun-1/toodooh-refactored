import type { RedispatchedShare } from '@/features/screenhost/lib/diffusion-calendar';
import { apiClient } from '@/lib/api-client';

// HOST-EDIT1 — the admin « Fiche Host » wire (GET/PATCH /api/admin/screenhosts/:id and its
// sub-routes, apps/api/src/routes/admin-host.ts). The hours / sector / class / capacity, WiFi and
// declaration edits keep their own admin routes (admin-screenhost.service.ts).

/** The hub-locked eligibility fields — mirrors HOST_LOCK_KEYS (apps/api/src/lib/host-locks.ts). */
export type HostLockKey = 'business_sector' | 'class' | 'hours' | 'broadcast_capacity';

export interface HostVenue {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  governorate_id: string | null;
  zone: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  demo_only: boolean;
  screen_count: number;
  room_count: number | null;
  wifi_ssid: string | null;
  wifi_password_set: boolean;
  export_status: 'pending' | 'exported' | 'failed';
  exported_at: string | null;
  locked_fields: HostLockKey[];
  created_at: string;
  updated_at: string;
}

export interface HostOwner {
  id: string;
  email: string;
  role: string;
  status: string;
  business_name: string | null;
  tax_number: string | null;
  contact_name: string;
  contact_phone: string | null;
  fonction: string | null;
  street_address: string | null;
  city: string | null;
  postal_code: string | null;
  governorate_id: string | null;
  zone: string | null;
  venues_count: number;
}

export interface HostFiche {
  venue: HostVenue;
  owner: HostOwner | null;
}

/** PARTIAL: an omitted key is unchanged, null clears a nullable field. */
export type HostVenuePatch = Partial<
  Pick<
    HostVenue,
    | 'name'
    | 'address'
    | 'city'
    | 'postal_code'
    | 'governorate_id'
    | 'zone'
    | 'latitude'
    | 'longitude'
  >
>;

export interface HostOwnerPatch {
  business_name?: string;
  tax_number?: string | null;
  contact_name?: string;
  contact_phone?: string;
  fonction?: string | null;
  street_address?: string;
  city?: string;
  postal_code?: string;
  governorate_id?: string;
  zone?: string | null;
}

export interface HostHistoryEntry {
  id: string;
  section: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changed_by: { id: string; label: string } | null;
  created_at: string;
}

export interface HostUnavailability {
  days: string[];
  /** Days in range carrying a live campaign share → the campaigns' names. */
  diffusion_days: Record<string, string[]>;
}

export const adminHostService = {
  get(id: string): Promise<HostFiche> {
    return apiClient.get<HostFiche>(`/admin/screenhosts/${id}`);
  },
  updateVenue(id: string, patch: HostVenuePatch): Promise<{ venue: HostVenue }> {
    return apiClient.patch<{ venue: HostVenue }>(`/admin/screenhosts/${id}`, patch);
  },
  updateOwner(id: string, patch: HostOwnerPatch): Promise<unknown> {
    return apiClient.patch<unknown>(`/admin/screenhosts/${id}/owner`, patch);
  },
  unlock(id: string, field: HostLockKey): Promise<{ locked_fields: HostLockKey[] }> {
    return apiClient.del<{ locked_fields: HostLockKey[] }>(
      `/admin/screenhosts/${id}/locks/${field}`,
    );
  },
  history(id: string): Promise<{ entries: HostHistoryEntry[] }> {
    return apiClient.get<{ entries: HostHistoryEntry[] }>(`/admin/screenhosts/${id}/history`);
  },
  unavailability(id: string, from: string, to: string): Promise<HostUnavailability> {
    return apiClient.get<HostUnavailability>(
      `/admin/screenhosts/${id}/unavailability?from=${from}&to=${to}`,
    );
  },
  toggleDay(
    id: string,
    day: string,
    unavailable: boolean,
  ): Promise<{ day: string; unavailable: boolean; redispatched: RedispatchedShare[] }> {
    return apiClient.put(`/admin/screenhosts/${id}/unavailability`, { day, unavailable });
  },
};
