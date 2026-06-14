import type { ScreenhostWifi, WifiPatch } from '@/features/screenhost/services/screenhost.service';
import { apiClient } from '@/lib/api-client';

/**
 * Admin WiFi maintenance for ANY screenhost — goes through the toodooh API admin route
 * (adminGuard server-side), NOT the legacy Supabase `admin-screens.service`. Same write-only
 * password contract as the owner path; the server fire-and-forgets the wedooh re-push.
 */
export const adminScreenhostService = {
  /** PATCH /api/admin/screenhosts/:id/wifi — admin edit of any screenhost. */
  updateWifi(id: string, patch: WifiPatch): Promise<ScreenhostWifi> {
    return apiClient.patch<ScreenhostWifi>(`/admin/screenhosts/${id}/wifi`, patch);
  },
};
