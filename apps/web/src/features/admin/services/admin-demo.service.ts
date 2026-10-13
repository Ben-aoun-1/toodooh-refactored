import { apiClient } from '@/lib/api-client';

// DEMO-1 (operator 2026-10-12) — the admin « Démo » page over REST (/api/admin/demo*, all
// [requireAuth, requireAdmin]). apiClient prepends '/api'.

export interface DemoVenue {
  id: string;
  name: string;
  owner_name: string | null;
  is_demo_venue: boolean;
}

export interface DemoCampaign {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  airs_at: string | null;
  on_air_pushed_at: string | null;
}

export interface DemoAccount {
  id: string;
  email: string;
  business_name: string | null;
  contact_name: string;
  created_at: string;
  balance_tnd: number;
  spendable_tnd: number;
  campaigns: DemoCampaign[];
}

/** DEMO-2 — a demo screenhost: a map point with a random audience, for demo accounts only. */
export interface DemoScreenhost {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  sector_name: string | null;
  class: string | null;
  opening_hour: number | null;
  closing_hour: number | null;
  created_at: string;
}

export interface DemoSector {
  id: string;
  name: string;
}

export interface DemoPage {
  delay_minutes: number;
  venues: DemoVenue[];
  demo_screenhosts: DemoScreenhost[];
  sectors: DemoSector[];
  accounts: DemoAccount[];
}

export interface CreateDemoScreenhostBody {
  name: string;
  latitude: number;
  longitude: number;
  city?: string;
  business_sector_id?: string;
  opening_hour: number;
  closing_hour: number;
  audience_min: number;
  audience_max: number;
}

export interface CreateDemoAccountBody {
  email: string;
  password: string;
  business_name: string;
  contact_name?: string;
  balance_tnd: number;
}

export const adminDemoService = {
  get(): Promise<DemoPage> {
    return apiClient.get<DemoPage>('/admin/demo');
  },
  setDelay(delayMinutes: number): Promise<{ delay_minutes: number }> {
    return apiClient.patch<{ delay_minutes: number }>('/admin/demo/config', {
      delay_minutes: delayMinutes,
    });
  },
  setVenues(screenhostIds: string[]): Promise<{ venues: DemoVenue[] }> {
    return apiClient.put<{ venues: DemoVenue[] }>('/admin/demo/venues', {
      screenhost_ids: screenhostIds,
    });
  },
  createScreenhost(body: CreateDemoScreenhostBody): Promise<DemoScreenhost> {
    return apiClient.post<DemoScreenhost>('/admin/demo/screenhosts', body);
  },
  deleteScreenhost(id: string): Promise<{ deleted: string }> {
    return apiClient.del<{ deleted: string }>(`/admin/demo/screenhosts/${id}`);
  },
  createAccount(body: CreateDemoAccountBody): Promise<DemoAccount> {
    return apiClient.post<DemoAccount>('/admin/demo/accounts', body);
  },
  credit(id: string, amountTnd: number): Promise<DemoAccount> {
    return apiClient.post<DemoAccount>(`/admin/demo/accounts/${id}/credit`, {
      amount_tnd: amountTnd,
    });
  },
  deleteAccount(id: string): Promise<{ deleted: string; campaigns_stopped: number }> {
    return apiClient.del<{ deleted: string; campaigns_stopped: number }>(
      `/admin/demo/accounts/${id}`,
    );
  },
};
