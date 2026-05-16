import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = logger.child({ module: 'admin-recharges.service' });

export interface AdminRecharge {
  id: string;
  user_id: string;
  amount: number;
  payment_method: 'card' | 'bank' | 'cash';
  status: 'completed' | 'pending' | 'failed' | 'cancelled';
  reference: string;
  description?: string;
  transaction_id?: string;
  validated_by?: string;
  validated_at?: string;
  validation_notes?: string;
  created_at: string;
  updated_at: string;
  // Jointures
  user_name?: string;
  user_email?: string;
  business_name?: string;
  validator_name?: string;
}

export interface RechargeStats {
  total_recharges: number;
  pending_count: number;
  completed_count: number;
  failed_count: number;
  total_amount: number;
  pending_amount: number;
  completed_amount: number;
}

class AdminRechargesService {
  /**
   * Récupérer toutes les recharges avec filtres et pagination
   */
  async getRecharges(
    filters?: {
      status?: string;
      userId?: string;
      search?: string;
    },
    page: number = 1,
    perPage: number = 20,
  ): Promise<{ data: AdminRecharge[]; total: number }> {
    try {
      let query = supabase
        .from('recharges')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Filtrer par statut
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      // Filtrer par utilisateur
      if (filters?.userId) {
        query = query.eq('user_id', filters.userId);
      }

      // Recherche par référence
      if (filters?.search) {
        query = query.ilike('reference', `%${filters.search}%`);
      }

      // Pagination
      const start = (page - 1) * perPage;
      const end = start + perPage - 1;
      query = query.range(start, end);

      const { data: recharges, error, count } = await query;

      if (error) throw error;

      // Enrichir avec les données utilisateur
      const enrichedRecharges = await Promise.all(
        (recharges || []).map(async (recharge) => {
          // Récupérer les infos utilisateur
          const { data: profile } = await supabase
            .from('business_profiles')
            .select('business_name, contact_name, email')
            .eq('user_id', recharge.user_id)
            .single();

          // Récupérer le validateur si existant
          let validatorName = null;
          if (recharge.validated_by) {
            const { data: validator } = await supabase
              .from('admin_profiles')
              .select('full_name')
              .eq('id', recharge.validated_by)
              .single();
            validatorName = validator?.full_name;
          }

          return {
            ...recharge,
            business_name: profile?.business_name || 'N/A',
            user_name: profile?.contact_name || 'N/A',
            user_email: profile?.email || 'N/A',
            validator_name: validatorName,
          } as AdminRecharge;
        }),
      );

      return {
        data: enrichedRecharges,
        total: count || 0,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupérer les statistiques des recharges
   */
  async getRechargeStats(): Promise<RechargeStats> {
    try {
      const { data, error } = await supabase.from('recharges').select('status, amount');

      if (error) throw error;

      const stats: RechargeStats = {
        total_recharges: data?.length || 0,
        pending_count: data?.filter((r) => r.status === 'pending').length || 0,
        completed_count: data?.filter((r) => r.status === 'completed').length || 0,
        failed_count: data?.filter((r) => r.status === 'failed').length || 0,
        total_amount: data?.reduce((sum, r) => sum + parseFloat(r.amount.toString()), 0) || 0,
        pending_amount:
          data
            ?.filter((r) => r.status === 'pending')
            .reduce((sum, r) => sum + parseFloat(r.amount.toString()), 0) || 0,
        completed_amount:
          data
            ?.filter((r) => r.status === 'completed')
            .reduce((sum, r) => sum + parseFloat(r.amount.toString()), 0) || 0,
      };

      return stats;
    } catch (error) {
      log.error({ error }, '❌ Erreur récupération stats recharges');
      return {
        total_recharges: 0,
        pending_count: 0,
        completed_count: 0,
        failed_count: 0,
        total_amount: 0,
        pending_amount: 0,
        completed_amount: 0,
      };
    }
  }

  /**
   * Valider une recharge (approuver)
   */
  async approveRecharge(rechargeId: string, adminId: string, notes?: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('recharges')
        .update({
          status: 'completed',
          validated_by: adminId,
          validated_at: new Date().toISOString(),
          validation_notes: notes || "Recharge validée par l'administrateur",
          updated_at: new Date().toISOString(),
        })
        .eq('id', rechargeId);

      if (error) throw error;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Rejeter une recharge
   */
  async rejectRecharge(rechargeId: string, adminId: string, reason: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('recharges')
        .update({
          status: 'failed',
          validated_by: adminId,
          validated_at: new Date().toISOString(),
          validation_notes: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rechargeId);

      if (error) throw error;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Annuler une recharge
   */
  async cancelRecharge(rechargeId: string, adminId: string, reason: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('recharges')
        .update({
          status: 'cancelled',
          validated_by: adminId,
          validated_at: new Date().toISOString(),
          validation_notes: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rechargeId);

      if (error) throw error;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupérer le solde d'un utilisateur
   */
  async getUserBalance(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('get_user_balance', {
        p_user_id: userId,
      });

      if (error) throw error;

      return data || 0;
    } catch (error) {
      log.error({ error }, '❌ Erreur récupération solde');
      return 0;
    }
  }

  /**
   * Formater un montant en TND
   */
  formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-TN', {
      style: 'currency',
      currency: 'TND',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
}

export const adminRechargesService = new AdminRechargesService();
