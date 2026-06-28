import type { PlatformStats } from '@/features/admin/types/platform-stats';
import { apiClient } from '@/lib/api-client';

// Admin dashboard stats over REST — the de-Supabase target for the dead platform-stats RPCs +
// business_profiles reads. One admin-guarded aggregation endpoint (GET /api/admin/platform-stats,
// new-engine Postgres) replaces the old five-RPC composite. apiClient prepends BASE='/api', so the
// path is WITHOUT the /api prefix; the route is [requireAuth, requireAdmin] server-side. Throws
// ApiError on failure (apiClient contract).
export const platformStatsService = {
  async getPlatformStats(): Promise<PlatformStats> {
    return apiClient.get<PlatformStats>('/admin/platform-stats');
  },
};
