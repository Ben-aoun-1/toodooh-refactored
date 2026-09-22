import type { ScreenhostWifi } from '@/features/screenhost/services/screenhost.service';
import { apiClient } from '@/lib/api-client';

export type UserStatus = 'pending' | 'approved' | 'rejected' | 'banned';
export type AdminProfileType = 'individual_owner' | 'fleet_owner' | 'advertiser' | 'agency';

/** One of the owner's venues in GET /api/admin/users: its WiFi view + its declared screens. */
export type AdminUserScreenhost = ScreenhostWifi & { screen_count: number };

// The admin view of an end-user, repointed onto GET /api/admin/users (Phase-1g G2). Shape mirrors
// the backend `toAdminUserView` (the /api/me projection + created_at + the validation trio). The
// dual-identity collapse means there is one `id` (no separate user_id). Documents are NOT carried
// here — F-docs Commit 3 moved the review surface onto the per-category grouped endpoint
// (getUserDocuments), presigned by uuid on demand (getDocumentUrlById). Fields the backend does not
// model (formule, verification_status) are intentionally absent —
// the UI null-guards them ("Non fourni"), it does not invent data (audit §17.1 functional
// reductions; G2 D-G2-2).
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
  // F6 (Kais QA 2026-06-11): bank details for the admin user-info view. Kept null when absent —
  // the modal renders its own "Non fourni" fallback; no 'N/A' coalescing here.
  bank_account_holder: string | null;
  bank_rib: string | null;
  bank_iban: string | null;
  bank_details_updated_at: string | null;
  // The owner's screenhosts (WiFi-redacted) — drives the admin "WiFi du lieu" editor, and (SCR-DECL1)
  // the detail's declared-screens sum. [] for non-owners. The password is never carried.
  screenhosts: AdminUserScreenhost[];
  created_at: string;
  validated_by: string | null;
  validated_at: string | null;
  validation_notes: string | null;
  // Not modeled by the backend — always undefined; the UI degrades gracefully (G2 D-G2-2).
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
  bank_account_holder: string | null;
  bank_rib: string | null;
  bank_iban: string | null;
  bank_details_updated_at: string | null;
  screenhosts: AdminUserScreenhost[];
  created_at: string;
  validated_by: string | null;
  validated_at: string | null;
  validation_notes: string | null;
}

// One stored document in the multi-document model (F-docs Commit 3) — mirrors the server's
// `docView` projection (apps/api lib/user-documents.ts). `position` is just upload order. Storage
// keys are never exposed — the URL is presigned by id on demand.
export interface AdminDocumentView {
  id: string;
  category: DocumentCategory;
  position: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}

// CIN-HOST1 (2026-09-21) — no 'cin': the api never lists or presigns a CIN any more.
export type DocumentCategory = 'rne' | 'complementaire' | 'bank';

/** REV1 — one recorded change of an owner's payout coordinates (admin-only, never owner-facing). */
export interface AdminBankAuditSnapshot {
  bank_account_holder: string | null;
  bank_rib: string | null;
  bank_iban: string | null;
  bank_document_id: string | null;
}

export interface AdminBankAuditEntry {
  id: string;
  changed_by: string;
  before: AdminBankAuditSnapshot;
  after: AdminBankAuditSnapshot;
  created_at: string;
}

// The admin review surface's grouped read — mirrors the server `groupedDocuments` shape (every
// category present, possibly empty). Caps are server-enforced (rne 2, complémentaire 10, bank 1);
// the UI reads the arrays as-is.
export interface GroupedAdminDocuments {
  rne: AdminDocumentView[];
  complementaire: AdminDocumentView[];
  bank: AdminDocumentView[];
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
  bank_account_holder: w.bank_account_holder,
  bank_rib: w.bank_rib,
  bank_iban: w.bank_iban,
  bank_details_updated_at: w.bank_details_updated_at,
  screenhosts: w.screenhosts ?? [],
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

  // topics = deficient document areas ('legal' RNE, 'bank' RIB), ≥1 required (N3 Scenario 1).
  async rejectUser(id: string, notes: string, topics: string[]): Promise<void> {
    await apiClient.post(`/admin/users/${id}/reject`, { notes, topics });
  },

  // BANIR (N3 Scenario 2, fraud) — terminal: bans + retains evidence + revokes sessions. Reason required.
  async banUser(id: string, notes: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/ban`, { notes });
  },

  // All of a user's documents, grouped by category (the multi-doc review surface — F-docs Commit 3).
  // Throws ApiError with code USER_NOT_FOUND on a stale link.
  async getUserDocuments(id: string): Promise<GroupedAdminDocuments> {
    const { documents } = await apiClient.get<{ documents: GroupedAdminDocuments }>(
      `/admin/users/${id}/documents`,
    );
    return documents;
  },

  // REV1 — the INTERNAL trail of payout-coordinate changes, newest first. ADMIN-ONLY: there is no
  // owner-facing counterpart by design (the spec keeps no history on the owner's side, and the
  // trail exists to be read by someone other than whoever might have moved the money).
  // Throws ApiError with code USER_NOT_FOUND on a stale link.
  async getBankAudit(id: string): Promise<AdminBankAuditEntry[]> {
    return apiClient.get<AdminBankAuditEntry[]>(`/admin/users/${id}/bank-audit`);
  },

  // Presign ONE document by its uuid (the :id-scoped route). Deliberately NOT the legacy
  // /documents/:ref category shim, which collapses to the category's lowest position and would
  // always open the first of several documents. Throws ApiError (NOT_FOUND / STORAGE_ERROR).
  async getDocumentUrlById(userId: string, docId: string): Promise<string> {
    const { url } = await apiClient.get<{ url: string }>(
      `/admin/users/${userId}/documents/${docId}/url`,
    );
    return url;
  },
};
