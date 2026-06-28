import type { AdminCreativeView, CreativeStatusFilter } from '@/features/admin/types/creative';
import { apiClient } from '@/lib/api-client';

// Admin creative moderation (L-spot CONTENT gate) over REST — the surface the new advertiser upload
// pipeline (creatives.api -> POST /api/creatives, Postgres `creatives` table) actually lands in,
// distinct from the LEGACY Supabase `videos`/admin-video.service used by VideoManagement. Mirrors
// adminUserService: apiClient prepends BASE='/api', so paths are WITHOUT the /api prefix. Every route
// is [requireAuth, requireAdmin] server-side; the presign here is ADMIN-scoped — it reads ANY
// advertiser's object, unlike the owner-scoped /creatives/:id/url which 404s cross-advertiser.
// Approve notes are OPTIONAL; reject notes are REQUIRED (server rejectBodySchema demands min 1), so
// the page MUST collect a reason before calling reject. All methods throw ApiError on failure (the
// apiClient contract).
export const adminCreativesService = {
  // The moderation queue (newest first, server-ordered); optional status filter. The backend sends
  // the array directly (not wrapped in an envelope), so the typed return is AdminCreativeView[].
  async list(status?: CreativeStatusFilter): Promise<AdminCreativeView[]> {
    const qs = status ? `?status=${status}` : '';
    return apiClient.get<AdminCreativeView[]>(`/admin/creatives${qs}`);
  },

  // Presign the object on demand (ADMIN-scoped). Throws ApiError (NOT_FOUND / STORAGE_ERROR) on failure.
  async presignedUrl(id: string): Promise<string> {
    const { url } = await apiClient.get<{ url: string }>(`/admin/creatives/${id}/url`);
    return url;
  },

  // Approve — flip validation_status to 'approved' + stamp the audit trio. Notes optional.
  async approve(id: string, notes?: string): Promise<AdminCreativeView> {
    return apiClient.post<AdminCreativeView>(
      `/admin/creatives/${id}/approve`,
      notes ? { notes } : {},
    );
  },

  // Reject — flip to 'rejected'; a reason is REQUIRED (surfaced to the advertiser as validation_notes).
  async reject(id: string, notes: string): Promise<AdminCreativeView> {
    return apiClient.post<AdminCreativeView>(`/admin/creatives/${id}/reject`, { notes });
  },
};
