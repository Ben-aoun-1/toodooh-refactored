import {
  AdminAccount,
  CreateInternalAccountInput,
  InternalAccount,
} from '@/features/admin/types/admin';
import { apiClient } from '@/lib/api-client';

// ADM-ADM1 — the staff-account surface is entirely on apps/api now. The legacy Supabase
// `admin_profiles` list/update/deactivate/reactivate (dead in prod — the client throws where
// VITE_SUPABASE_* is unset) is gone:
//   list       → GET  /api/admin/admins            (superadmin) — users where role ∈ admin/superadmin
//   deactivate → POST /api/admin/users/:id/ban     (the EXISTING route: status→banned, sessions revoked;
//                                                   a non-empty motif is required by the server)
//   reactivate → POST /api/admin/users/:id/unban   (superadmin; admin-role targets only)
//   create     → POST /api/admin/accounts          (unchanged)
// Errors propagate as ApiError → the pages surface the server message.
export const adminService = {
  async createAdmin(input: CreateInternalAccountInput): Promise<InternalAccount> {
    const { account } = await apiClient.post<{ account: InternalAccount }>(
      '/admin/accounts',
      input,
    );
    return account;
  },

  async getAdmins(): Promise<AdminAccount[]> {
    const { admins } = await apiClient.get<{ admins: AdminAccount[] }>('/admin/admins');
    return admins;
  },

  /** Deactivate = ban: the server requires a reason (kept as the validation note). */
  async deactivateAdmin(id: string, notes: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/ban`, { notes });
  },

  async reactivateAdmin(id: string): Promise<AdminAccount> {
    const { account } = await apiClient.post<{ account: AdminAccount }>(`/admin/users/${id}/unban`);
    return account;
  },
};
