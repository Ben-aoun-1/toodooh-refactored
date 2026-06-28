import {
  AdminProfile,
  CreateInternalAccountInput,
  InternalAccount,
} from '@/features/admin/types/admin';
import { apiClient } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';

// Lane-4 de-Supabase: the dashboard-stats read (getDashboardStats), the admin-activity log
// (logActivity — its `admin_activities` insert tripped the legacy target_type CHECK and is now
// dropped, not repointed) and getActivities have been REMOVED — none had a new-engine source and
// the stats surface now reads GET /api/admin/platform-stats. createAdmin is on apps/api
// (POST /api/admin/accounts). The admin-account LIST + lifecycle (getAdmins/updateAdmin/
// deleteAdmin/reactivateAdmin) STILL read the legacy Supabase `admin_profiles` table: internal
// accounts now land in the `users` table, so this list is stale until the 2.7 admin repoint
// (FLAGGED — it needs new endpoints: list internal accounts + deactivate/reactivate, which carry a
// product decision on what "deactivate an admin" means in the users model). Left on Supabase here.
export const adminService = {
  // createAdmin → apps/api POST /api/admin/accounts (no verification email; email_verified +
  // approved). Errors propagate as ApiError → the page's getErrorMessage surfaces the server message.
  async createAdmin(input: CreateInternalAccountInput): Promise<InternalAccount> {
    const { account } = await apiClient.post<{ account: InternalAccount }>(
      '/admin/accounts',
      input,
    );
    return account;
  },

  async getAdmins(): Promise<AdminProfile[]> {
    try {
      const { data, error } = await supabase
        .from('admin_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (_error) {
      throw new Error('Erreur lors de la récupération des administrateurs');
    }
  },

  async updateAdmin(id: string, updates: Partial<AdminProfile>): Promise<AdminProfile> {
    try {
      const { data, error } = await supabase
        .from('admin_profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (_error) {
      throw new Error("Erreur lors de la mise à jour de l'administrateur");
    }
  },

  async deleteAdmin(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('admin_profiles')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;
    } catch (_error) {
      throw new Error("Erreur lors de la suppression de l'administrateur");
    }
  },

  async reactivateAdmin(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('admin_profiles')
        .update({ is_active: true })
        .eq('id', id);

      if (error) throw error;
    } catch (_error) {
      throw new Error("Erreur lors de la réactivation de l'administrateur");
    }
  },
};
