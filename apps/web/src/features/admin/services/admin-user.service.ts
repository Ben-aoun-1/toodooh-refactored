import { apiClient } from '@/lib/api-client';

export type UserStatus = 'pending' | 'approved' | 'rejected';
export type AdminProfileType = 'individual_owner' | 'fleet_owner' | 'advertiser' | 'agency';

// The admin view of an end-user, repointed onto GET /api/admin/users (Phase-1g G2). Shape mirrors
// the backend `toAdminUserView` (the /api/me projection + created_at + the validation trio +
// document presence). The dual-identity collapse means there is one `id` (no separate user_id).
// Document keys are not exposed — presence booleans drive the UI, and the URL is presigned on
// demand via getDocumentUrl. Fields the backend does not model (cin number, number_of_screens,
// formule, verification_status) are intentionally absent — the UI null-guards them ("Non fourni"),
// it does not invent data (audit §17.1 functional reductions; G2 D-G2-2).
export interface AdminUser {
  id: string;
  email: string;
  role: string;
  status: UserStatus;
  onboarding_completed: boolean;
  profile_type: AdminProfileType;
  contact_name: string;
  business_name: string;
  business_type?: string | null;
  tax_number?: string | null;
  contact_phone: string;
  fonction?: string | null;
  street_address: string;
  city: string;
  postal_code: string;
  zone?: string | null;
  agent_code?: string | null;
  documents: { registration: boolean; cin: boolean };
  created_at: string;
  validated_by: string | null;
  validated_at: string | null;
  validation_notes: string | null;
  // Not modeled by the backend — always undefined; the UI degrades gracefully (G2 D-G2-2).
  cin?: string;
  number_of_screens?: number;
  formule?: string;
  verification_status?: string;
}

// The wire shape from GET /api/admin/users (snake_case, nullable where the column is nullable).
interface AdminUserWire {
  id: string;
  email: string;
  role: string;
  status: UserStatus;
  onboarding_completed: boolean;
  profile_type: AdminProfileType | null;
  contact_name: string | null;
  business_name: string | null;
  business_type: string | null;
  tax_number: string | null;
  contact_phone: string | null;
  fonction: string | null;
  zone: string | null;
  street_address: string | null;
  city: string | null;
  postal_code: string | null;
  agent_code: string | null;
  documents: { registration: boolean; cin: boolean };
  created_at: string;
  validated_by: string | null;
  validated_at: string | null;
  validation_notes: string | null;
}

// Coalesce the nullable display fields so the page's filter (`.toLowerCase()`) + the table render
// keep their non-null assumptions; "N/A" matches the legacy display fallback.
const mapUser = (w: AdminUserWire): AdminUser => ({
  id: w.id,
  email: w.email,
  role: w.role,
  status: w.status,
  onboarding_completed: w.onboarding_completed,
  profile_type: w.profile_type ?? 'advertiser',
  contact_name: w.contact_name ?? 'N/A',
  business_name: w.business_name ?? 'N/A',
  business_type: w.business_type,
  tax_number: w.tax_number,
  contact_phone: w.contact_phone ?? 'N/A',
  fonction: w.fonction,
  zone: w.zone,
  street_address: w.street_address ?? 'N/A',
  city: w.city ?? 'N/A',
  postal_code: w.postal_code ?? 'N/A',
  agent_code: w.agent_code,
  documents: w.documents,
  created_at: w.created_at,
  validated_by: w.validated_by,
  validated_at: w.validated_at,
  validation_notes: w.validation_notes,
});

export const adminUserService = {
  // The end-user moderation queue, filtered by status (status is REQUIRED by the backend; the page
  // fetches all three statuses in parallel and merges — see useUsers). Sorted created_at DESC server-side.
  async getUsersByStatus(status: UserStatus): Promise<AdminUser[]> {
    const { users } = await apiClient.get<{ users: AdminUserWire[] }>(
      `/admin/users?status=${status}`,
    );
    return users.map(mapUser);
  },

  // Approve (notes optional) / reject (notes required, enforced by the reject modal + the backend).
  // Both throw ApiError on failure (the api-client contract) — the page branches on ApiError.status
  // to drive the 409 prior-state modal (G2 D-G2-4) and on .code for field errors. No boolean return.
  async approveUser(id: string, notes?: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/approve`, notes ? { notes } : {});
  },

  async rejectUser(id: string, notes: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/reject`, { notes });
  },

  // Presign-on-demand for an end-user's stored document (the admin doc-review the approval rests on).
  // Throws ApiError with code USER_NOT_FOUND or DOCUMENT_NOT_UPLOADED on the distinct 404s.
  async getDocumentUrl(id: string, type: 'rne' | 'cin'): Promise<string> {
    const { url } = await apiClient.get<{ url: string }>(`/admin/users/${id}/documents/${type}`);
    return url;
  },
};
