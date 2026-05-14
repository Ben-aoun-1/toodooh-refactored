import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { AdminProfile, AdminSignUpData, AdminDashboardStats, AdminActivity } from '../types/admin';
import { isErrorWithCode } from '../lib/errors';

const log = logger.child({ module: 'admin.service' });

// Fonction pour mapper les erreurs admin
const mapAdminError = (error: any): string => {
  const errorMessage =
    error?.message || error?.error_description || "Une erreur inattendue s'est produite";

  if (errorMessage.includes('Invalid login credentials')) {
    return 'Email ou mot de passe incorrect.';
  }

  if (errorMessage.includes('User already registered')) {
    return 'Un compte admin existe déjà avec cette adresse email.';
  }

  if (errorMessage.includes('Email not confirmed')) {
    return "Votre compte admin n'est pas encore activé.";
  }

  return errorMessage;
};

export const adminService = {
  // Authentification
  async login(email: string, password: string): Promise<AdminProfile> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw new Error(`Erreur de connexion: ${error.message}`);
      }

      if (!data.user) {
        throw new Error('Aucun utilisateur trouvé');
      }

      // Vérifier si l'utilisateur est un admin
      const { data: adminProfile, error: profileError } = await supabase
        .from('admin_profiles')
        .select('*')
        .eq('user_id', data.user.id)
        .eq('is_active', true)
        .single();

      if (profileError) {
        throw new Error("Accès refusé. Ce compte n'est pas autorisé.");
      }

      if (!adminProfile) {
        throw new Error("Accès refusé. Ce compte n'est pas autorisé.");
      }

      // Mettre à jour la dernière connexion
      await supabase
        .from('admin_profiles')
        .update({ last_login: new Date().toISOString() })
        .eq('id', adminProfile.id);

      return adminProfile;
    } catch (error) {
      const _err = isErrorWithCode(error) ? error : null;
      throw new Error(_err?.message || 'Erreur de connexion');
    }
  },

  async logout(): Promise<void> {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      throw new Error('Erreur lors de la déconnexion');
    }
  },

  async getCurrentAdmin(): Promise<AdminProfile | null> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return null;
      }

      const { data: adminProfile, error } = await supabase
        .from('admin_profiles')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();

      if (error) {
        log.error({ error }, 'Error getting current admin');
        return null;
      }

      if (!adminProfile) {
        return null;
      }

      return adminProfile;
    } catch (error) {
      log.error({ error }, 'Error getting current admin');
      return null;
    }
  },

  // Gestion des admins
  async createAdmin(adminData: AdminSignUpData, createdBy: string): Promise<AdminProfile> {
    try {
      // Créer l'utilisateur auth avec signUp
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: adminData.email,
        password: adminData.password,
        options: {
          data: {
            first_name: adminData.first_name,
            last_name: adminData.last_name,
            role: adminData.role,
          },
        },
      });

      if (authError) {
        throw authError;
      }

      if (!authData.user) {
        throw new Error('Failed to create user');
      }

      // Créer le profil admin
      const { data: adminProfile, error: profileError } = await supabase
        .from('admin_profiles')
        .insert({
          user_id: authData.user.id,
          email: adminData.email,
          first_name: adminData.first_name,
          last_name: adminData.last_name,
          role: adminData.role,
          permissions: adminData.permissions || [],
          is_active: true,
          created_by: createdBy,
        })
        .select()
        .single();

      if (profileError) {
        throw profileError;
      }

      return adminProfile;
    } catch (error) {
      throw new Error(mapAdminError(error));
    }
  },

  async getAdmins(): Promise<AdminProfile[]> {
    try {
      const { data, error } = await supabase
        .from('admin_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      throw new Error('Erreur lors de la récupération des activités');
    }
  },
};
