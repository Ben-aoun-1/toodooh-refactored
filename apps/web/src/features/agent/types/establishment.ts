// Slice-2 E — the establishment wire shapes (snake_case, matching apps/api routes/establishments.ts).
// The advertiser-facing privacy concern (dots-only) belongs to the R read repoint, not this
// agent-facing inventory creation surface.
export interface Establishment {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  screen_count: number;
  address: string | null;
  city: string | null;
  governorate_id: string | null;
  zone: string | null;
  is_active: boolean;
  created_by: string;
  screenhost_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEstablishmentInput {
  name: string;
  latitude: number;
  longitude: number;
  screen_count: number;
  address?: string;
  city?: string;
  zone?: string;
  governorate_id?: string;
}
