import { apiClient } from '@/lib/api-client';

/**
 * ADM-SCR1 — the admin « Localités et écrans » listing, read from the toodooh API
 * (GET /api/admin/screenhosts, adminGuard) — NOT the Supabase-era locations / screens /
 * business_profiles tables this service used to query (the client throws in prod, where
 * VITE_SUPABASE_* is unset, so the page never fetched). The venue status is DERIVED server-side
 * from screenhosts.is_active + the screens rows; liveness is the E6 heartbeat truth.
 */

/**
 * The venue vocabulary the new model can honestly say (no maintenance/unavailable source).
 * ADM-FIX1 — `never_installed`: the venue HAS screens rows but not one of them was ever a real
 * device (`paired_at`/`last_seen_at` both null everywhere). It used to read « Active », because
 * the derivation counted `screens.is_active` — a column no code writes, true on every row forever.
 */
export type AdminLocationStatus = 'active' | 'inactive' | 'never_installed' | 'no_screens';

export interface AdminScreenRow {
  id: string;
  name: string;
  /** Operator ruling: a real device once ran — `paired_at` or `last_seen_at` is set. */
  installed: boolean;
  connected: boolean;
  last_seen_at: string | null;
  paired_at: string | null;
}

export interface AdminLocation {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  status: AdminLocationStatus;
  owner_id: string | null;
  owner_business_name: string | null;
  /** DECLARED — the screens rows an admin created, installed or not. */
  screens_count: number;
  active_screens_count: number;
  /** INSTALLED — the subset that ever paired or ever reported. */
  installed_screens_count: number;
  online_screens_count: number;
  created_at: string;
  screens: AdminScreenRow[];
}

export interface AdminLocationsPage {
  locations: AdminLocation[];
  total: number;
  page: number;
  per_page: number;
}

export interface AdminLocationQuery {
  status?: AdminLocationStatus;
  owner_id?: string;
  search?: string;
  page: number;
  per_page: number;
}

/** One entry of the owner picker (GET /api/admin/screenhosts/owners). */
export interface ScreenOwnerOption {
  id: string;
  business_name: string;
}

/**
 * The query string for the listing — pagination always, a filter only when set (an empty search
 * is no search). Exported pure so the wire contract is pinned without a network.
 */
export function buildAdminScreenhostsQuery(query: AdminLocationQuery): string {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('per_page', String(query.per_page));
  if (query.status) params.set('status', query.status);
  if (query.owner_id) params.set('owner_id', query.owner_id);
  const search = query.search?.trim();
  if (search) params.set('search', search);
  return `?${params.toString()}`;
}

export const adminScreensService = {
  /** GET /api/admin/screenhosts — paginated, filtered venues with their screens folded in. */
  list(query: AdminLocationQuery): Promise<AdminLocationsPage> {
    return apiClient.get<AdminLocationsPage>(
      `/admin/screenhosts${buildAdminScreenhostsQuery(query)}`,
    );
  },

  /** GET /api/admin/screenhosts/owners — every venue-holding owner, once, sorted by name. */
  async owners(): Promise<ScreenOwnerOption[]> {
    const { owners } = await apiClient.get<{ owners: ScreenOwnerOption[] }>(
      '/admin/screenhosts/owners',
    );
    return owners;
  },
};
