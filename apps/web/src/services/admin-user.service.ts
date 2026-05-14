import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

const log = logger.child({ module: 'admin-user.service' });

export interface AdminUser {
  id: string;
  user_id: string;
  email: string;
  business_name: string;
  contact_name: string;
  contact_phone: string;
  street_address: string;
  city: string;
  postal_code: string;
  zone?: string;
  cin?: string;
  cin_doc_url?: string;
  formule?: string; // Formule choisie par le propriétaire
  agent_toodooh?: string; // Agent Toodooh pour les propriétaires
  number_of_screens?: number; // Nombre d'écrans pour les propriétaires
  profile_type: 'individual_owner' | 'fleet_owner' | 'advertiser' | 'agency';
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
  validation_notes?: string;
  validated_by?: string;
  validated_at?: string;
  verification_status?: string;
  business_type?: string;
  tax_number?: string;
  registration_doc_url?: string;
}

export const adminUserService = {
  // Récupérer tous les utilisateurs
  async getUsers(): Promise<AdminUser[]> {
    try {
      // Récupérer les données de business_profiles (en excluant les admins)
      const { data, error } = await supabase
        .from('business_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Erreur Supabase: ${error.message}`);
      }

      // Debug: Logger les données récupérées pour vérifier la colonne formule

      // Filtrer les utilisateurs qui sont aussi des admins
      const userIds = (data || []).map((u) => u.user_id);
      const { data: adminProfiles } = await supabase
        .from('admin_profiles')
        .select('user_id')
        .in('user_id', userIds);

      const adminUserIds = new Set((adminProfiles || []).map((a) => a.user_id));

      // Filtrer les admins de la liste
      const filteredData = (data || []).filter((u) => !adminUserIds.has(u.user_id));

      // Transformer les données pour correspondre à l'interface AdminUser
      const transformedUsers: AdminUser[] = filteredData.map((user) => ({
        id: user.id,
        user_id: user.user_id,
        email: user.email || 'N/A', // L'email est maintenant dans business_profiles
        business_name: user.business_name || user.company_name || 'N/A',
        contact_name: user.contact_name || user.first_name + ' ' + user.last_name || 'N/A',
        contact_phone: user.contact_phone || user.phone || 'N/A',
        street_address: user.street_address || user.address || 'N/A',
        city: user.city || 'N/A',
        postal_code: user.postal_code || user.zip_code || 'N/A',
        profile_type: user.profile_type || 'advertiser',
        status: user.status || ('pending' as const),
        created_at: user.created_at,
        updated_at: user.updated_at,
        validation_notes: user.validation_notes,
        validated_by: user.validated_by,
        validated_at: user.validated_at,
        verification_status: user.verification_status,
        business_type: user.business_type,
        tax_number: user.tax_number,
        registration_doc_url: user.registration_doc_url,
        zone: user.zone, // Zone géographique pour les propriétaires
        cin: user.cin, // Numéro CIN pour les propriétaires individuels
        cin_doc_url: user.cin_doc_url, // Document CIN pour les propriétaires individuels
        formule: user.formule, // Formule choisie par le propriétaire
        agent_toodooh: user.agent_toodooh, // Agent Toodooh pour les propriétaires
        number_of_screens: user.number_of_screens, // Nombre d'écrans pour les propriétaires
      }));

      return transformedUsers;
    } catch (error) {
      throw error;
    }
  },

  // Données de test en cas d'erreur
  getMockUsers(): AdminUser[] {
    return [
      {
        id: '1',
        user_id: 'user-1',
        email: 'jean.dupont@example.com',
        business_name: 'Dupont Digital',
        contact_name: 'Jean Dupont',
        contact_phone: '+33 6 12 34 56 78',
        street_address: '123 Rue de la Paix',
        city: 'Paris',
        postal_code: '75001',
        profile_type: 'individual_owner',
        status: 'pending',
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T10:30:00Z',
        verification_status: 'pending',
        business_type: 'local',
        tax_number: 'TEMP-123456',
      },
      {
        id: '2',
        user_id: 'user-2',
        email: 'marie.martin@example.com',
        business_name: 'Martin Advertising',
        contact_name: 'Marie Martin',
        contact_phone: '+33 6 87 65 43 21',
        street_address: '456 Avenue des Champs',
        city: 'Lyon',
        postal_code: '69001',
        profile_type: 'advertiser',
        status: 'approved',
        created_at: '2024-01-10T14:20:00Z',
        updated_at: '2024-01-20T09:15:00Z',
        verification_status: 'approved',
        business_type: 'local',
        tax_number: 'TEMP-789012',
      },
      {
        id: '3',
        user_id: 'user-3',
        business_name: 'Durand Fleet Management',
        contact_name: 'Pierre Durand',
        contact_phone: '+33 6 98 76 54 32',
        street_address: '789 Boulevard de la République',
        city: 'Marseille',
        postal_code: '13001',
        profile_type: 'fleet_owner',
        status: 'rejected',
        created_at: '2024-01-05T16:45:00Z',
        updated_at: '2024-01-05T16:45:00Z',
        verification_status: 'rejected',
        business_type: 'local',
        tax_number: 'TEMP-345678',
      },
    ];
  },

  // Approuver un utilisateur
  async approveUser(userId: string, adminId?: string, notes?: string): Promise<boolean> {
    try {
      // TODO(phase-1): typed source [supabase] — see #15
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        status: 'approved',
        verification_status: 'approved', // ✅ IMPORTANT : Mettre à jour verification_status aussi
        onboarding_completed: true, // ✅ Active la porte du cache côté client (évite les re-fetchs inutiles)
        updated_at: new Date().toISOString(),
      };

      if (adminId) {
        updateData.validated_by = adminId;
        updateData.validated_at = new Date().toISOString();
      }

      if (notes) {
        updateData.validation_notes = notes;
      }

      const { error } = await supabase
        .from('business_profiles')
        .update(updateData)
        .eq('id', userId);

      if (error) {
        log.error({ error }, '❌ Error approving user');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Error in approveUser');
      return false;
    }
  },

  // Rejeter un utilisateur
  async rejectUser(userId: string, adminId?: string, notes?: string): Promise<boolean> {
    try {
      // TODO(phase-1): typed source [supabase] — see #15
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        status: 'rejected',
        verification_status: 'rejected', // ✅ IMPORTANT : Mettre à jour verification_status aussi
        updated_at: new Date().toISOString(),
      };

      if (adminId) {
        updateData.validated_by = adminId;
        updateData.validated_at = new Date().toISOString();
      }

      if (notes) {
        updateData.validation_notes = notes;
      }

      const { error } = await supabase
        .from('business_profiles')
        .update(updateData)
        .eq('id', userId);

      if (error) {
        log.error({ error }, '❌ Error rejecting user');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Error in rejectUser');
      return false;
    }
  },

  // Récupérer les détails d'un utilisateur
  async getUserDetails(userId: string): Promise<AdminUser | null> {
    try {
      const { data, error } = await supabase
        .from('business_profiles')
        .select(
          `
          id,
          user_id,
          business_name,
          contact_name,
          contact_phone,
          street_address,
          city,
          postal_code,
          profile_type,
          created_at,
          updated_at
        `,
        )
        .eq('id', userId)
        .single();

      if (error) {
        log.error({ error }, 'Error fetching user details');
        return null;
      }

      if (!data) return null;

      // Transformer les données pour correspondre à l'interface AdminUser
      const transformedUser: AdminUser = {
        ...data,
        status: 'pending' as const,
        validation_notes: undefined,
        validated_by: undefined,
        validated_at: undefined,
        verification_status: undefined,
        business_type: undefined,
        tax_number: undefined,
      };

      return transformedUser;
    } catch (error) {
      log.error({ error }, 'Error in getUserDetails');
      return null;
    }
  },

  // Supprimer complètement un utilisateur
  async deleteUser(userId: string): Promise<boolean> {
    try {
      // 1. Récupérer le user_id depuis business_profiles
      const { data: businessProfile, error: profileError } = await supabase
        .from('business_profiles')
        .select('user_id')
        .eq('id', userId)
        .single();

      if (profileError || !businessProfile) {
        log.error({ profileError }, '❌ Error fetching business profile');
        return false;
      }

      const authUserId = businessProfile.user_id;

      // 2. Supprimer de toutes les tables liées (dans l'ordre pour respecter les contraintes de clés étrangères)

      // Supprimer les campagnes publicitaires
      const { error: campaignsError } = await supabase
        .from('advertising_campaigns')
        .delete()
        .eq('advertiser_id', authUserId);

      if (campaignsError) {
      }

      // Supprimer les écrans
      const { error: screensError } = await supabase
        .from('screens')
        .delete()
        .eq('owner_id', authUserId);

      if (screensError) {
      }

      // Supprimer les emplacements
      const { error: locationsError } = await supabase
        .from('locations')
        .delete()
        .eq('owner_id', authUserId);

      if (locationsError) {
      }

      // Supprimer les clients
      const { error: clientsError } = await supabase
        .from('clients')
        .delete()
        .eq('advertiser_id', authUserId);

      if (clientsError) {
      }

      // Supprimer les recharges (si la table existe)
      try {
        const { error: rechargesError } = await supabase
          .from('recharges')
          .delete()
          .eq('user_id', authUserId);

        if (rechargesError && !rechargesError.message.includes('Could not find')) {
        }
      } catch (e) {
        // Table n'existe pas, continuer
      }

      // Note: Table invoices n'existe pas encore, on skip
      // Supprimer les factures quand la table sera créée

      // Supprimer le profil business
      const { data: deletedProfile, error: businessError } = await supabase
        .from('business_profiles')
        .delete()
        .eq('id', userId)
        .select();

      if (businessError) {
        log.error({ businessError }, '❌ Error deleting business profile');
        log.error({ data: JSON.stringify(businessError, null, 2) }, '❌ Error details');
        return false;
      }

      // Vérifier que le profil a bien été supprimé
      const { data: checkProfile, error: checkError } = await supabase
        .from('business_profiles')
        .select('id')
        .eq('id', userId)
        .single();

      if (checkProfile) {
        log.error({ checkProfile }, '❌ ERREUR : Le profil existe toujours après suppression !');
        return false;
      }

      // 3. Note : L'utilisateur d'authentification n'est pas supprimé car cela nécessite
      // des permissions service_role qui ne sont pas disponibles côté client.
      // L'utilisateur auth restera mais n'aura plus de profil business associé.

      return true;
    } catch (error) {
      log.error({ error }, '❌ Error in deleteUser');
      return false;
    }
  },

  // Récupérer les statistiques des utilisateurs
  async getUserStats(): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    byType: {
      individual_owner: number;
      fleet_owner: number;
      advertiser: number;
      agency: number;
    };
  }> {
    try {
      const { data, error } = await supabase.from('business_profiles').select('profile_type');

      if (error) {
        log.error({ error }, 'Error fetching user stats');
        return {
          total: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          byType: {
            individual_owner: 0,
            fleet_owner: 0,
            advertiser: 0,
            agency: 0,
          },
        };
      }

      // Pour l'instant, tous les utilisateurs sont considérés comme "pending"
      // car la colonne status n'existe pas encore
      const stats = {
        total: data.length,
        pending: data.length, // Tous sont en attente pour l'instant
        approved: 0,
        rejected: 0,
        byType: {
          individual_owner: data.filter((u) => u.profile_type === 'individual_owner').length,
          fleet_owner: data.filter((u) => u.profile_type === 'fleet_owner').length,
          advertiser: data.filter((u) => u.profile_type === 'advertiser').length,
          agency: data.filter((u) => u.profile_type === 'agency').length,
        },
      };

      return stats;
    } catch (error) {
      log.error({ error }, 'Error in getUserStats');
      return {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        byType: {
          individual_owner: 0,
          fleet_owner: 0,
          advertiser: 0,
          agency: 0,
        },
      };
    }
  },
};
