import {
  AdminProfile,
  AdminDashboardStats,
  AdminActivity,
  CreateInternalAccountInput,
  InternalAccount,
} from '@/features/admin/types/admin';
import { apiClient } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = logger.child({ module: 'admin.service' });

export const adminService = {
  // Slice-2 A: internal-account creation is repointed onto apps/api — superadmin-only
  // POST /api/admin/accounts (no verification email; created email_verified + approved). The created
  // account lands in the `users` table, so it does NOT appear in the legacy admin_profiles-backed
  // list (getAdmins) until the 2.7 admin repoint — an intentional interim gap. Every method BELOW
  // stays on Supabase until 2.7. Errors propagate as ApiError → the page's getErrorMessage surfaces
  // the server message (e.g. the 409 EMAIL_TAKEN message).
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

  // Dashboard stats
  async getDashboardStats(): Promise<AdminDashboardStats> {
    try {
      // Récupérer les statistiques en parallèle
      const [
        usersResult,
        ownersResult,
        advertisersResult,
        screensResult,
        revenueResult,
        monthlyRevenueResult,
        verificationsResult,
        campaignsResult,
      ] = await Promise.all([
        supabase.from('business_profiles').select('id', { count: 'exact' }),
        supabase
          .from('business_profiles')
          .select('id', { count: 'exact' })
          .in('profile_type', ['individual_owner', 'fleet_owner']),
        supabase
          .from('business_profiles')
          .select('id', { count: 'exact' })
          .eq('profile_type', 'advertiser'),
        supabase.from('screens').select('id', { count: 'exact' }),
        supabase
          .from('revenue')
          .select('amount')
          .then((r) => ({ data: r.data?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0 })),
        supabase
          .from('revenue')
          .select('amount')
          .gte(
            'created_at',
            new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
          )
          .then((r) => ({ data: r.data?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0 })),
        supabase
          .from('business_profiles')
          .select('id', { count: 'exact' })
          .eq('verification_status', 'pending'),
        supabase.from('campaigns').select('id', { count: 'exact' }).eq('status', 'active'),
      ]);

      return {
        totalUsers: usersResult.count || 0,
        totalOwners: ownersResult.count || 0,
        totalAdvertisers: advertisersResult.count || 0,
        totalScreens: screensResult.count || 0,
        totalRevenue: revenueResult.data || 0,
        monthlyRevenue: monthlyRevenueResult.data || 0,
        pendingVerifications: verificationsResult.count || 0,
        activeCampaigns: campaignsResult.count || 0,
      };
    } catch (error) {
      log.error({ error }, 'Error getting dashboard stats');
      return {
        totalUsers: 0,
        totalOwners: 0,
        totalAdvertisers: 0,
        totalScreens: 0,
        totalRevenue: 0,
        monthlyRevenue: 0,
        pendingVerifications: 0,
        activeCampaigns: 0,
      };
    }
  },

  // Logs d'activité
  async logActivity(activity: Omit<AdminActivity, 'id' | 'created_at'>): Promise<void> {
    try {
      await supabase.from('admin_activities').insert(activity);
    } catch (error) {
      log.error({ error }, 'Error logging admin activity');
    }
  },

  async getActivities(limit: number = 50): Promise<AdminActivity[]> {
    try {
      const { data, error } = await supabase
        .from('admin_activities')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (_error) {
      throw new Error('Erreur lors de la récupération des activités');
    }
  },
};
