import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'balance.service' });


export interface BalanceInfo {
  available_balance: number;
  total_recharged: number;
  total_spent: number;
  draft_campaigns_count: number;
  active_campaigns_count: number;
}

export interface CampaignBalanceCheck {
  success: boolean;
  has_sufficient_balance: boolean;
  available_balance: number;
  campaign_cost: number;
  balance_after: number;
  message: string;
}

class BalanceService {
  /**
   * Récupérer le solde disponible d'un utilisateur
   */
  async getUserBalance(userId: string): Promise<number> {
    try {

      const { data, error } = await supabase.rpc('get_user_balance', {
        p_user_id: userId,
      });

      if (error) {
        log.error({ error }, 'Erreur RPC get_user_balance');
        // Fallback: calculer manuellement
        return await this.calculateBalanceManually(userId);
      }

      return data || 0;
    } catch (error) {
      log.error({ error }, 'Erreur lors de la récupération du solde');
      return 0;
    }
  }

  /**
   * Calculer le solde manuellement (fallback)
   */
  private async calculateBalanceManually(userId: string): Promise<number> {
    try {
      // Récupérer les recharges complétées
      const { data: recharges } = await supabase
        .from('recharges')
        .select('amount')
        .eq('user_id', userId)
        .eq('status', 'completed');

      const totalRecharged =
        recharges?.reduce((sum, r) => sum + parseFloat(r.amount.toString()), 0) || 0;

      // Récupérer les campagnes actives/complétées
      // Le budget est stocké en HT, on doit ajouter 19% de TVA pour le montant réel dépensé
      const TVA_RATE = 0.19;
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('budget')
        .eq('user_id', userId)
        .in('status', ['active', 'completed']);

      // Calculer le total dépensé avec TVA (budget HT * 1.19)
      const totalSpent =
        campaigns?.reduce((sum, c) => {
          const budgetHT = parseFloat(c.budget.toString()) || 0;
          const budgetTTC = budgetHT * (1 + TVA_RATE);
          return sum + budgetTTC;
        }, 0) || 0;

      return totalRecharged - totalSpent;
    } catch (error) {
      log.error({ error }, 'Erreur calcul manuel du solde');
      return 0;
    }
  }

  /**
   * Récupérer les informations détaillées de balance
   */
  async getBalanceInfo(userId: string): Promise<BalanceInfo | null> {
    try {
      const { data, error } = await supabase
        .from('user_balance_info')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      return {
        available_balance: parseFloat(data.available_balance || '0'),
        total_recharged: parseFloat(data.total_recharged || '0'),
        total_spent: parseFloat(data.total_spent || '0'),
        draft_campaigns_count: data.draft_campaigns_count || 0,
        active_campaigns_count: data.active_campaigns_count || 0,
      };
    } catch (error) {
      log.error({ error }, 'Erreur récupération balance info');
      return null;
    }
  }

  /**
   * Vérifier si l'utilisateur a un solde suffisant pour une campagne
   * Le budget est en HT, on ajoute 19% de TVA pour le coût réel
   */
  async checkCampaignBalance(campaignId: string): Promise<CampaignBalanceCheck | null> {
    try {

      const { data, error } = await supabase.rpc('check_campaign_balance', {
        p_campaign_id: campaignId,
      });

      if (error) {
        log.error({ error }, 'Erreur RPC check_campaign_balance');
        return null;
      }

      // Le budget est en HT, ajouter 19% de TVA pour le coût réel à soustraire
      const TVA_RATE = 0.19;
      const budgetHT = data?.campaign_cost || 0;
      const budgetTTC = budgetHT * (1 + TVA_RATE);

      // Ajuster les valeurs avec TVA
      const adjustedData = {
        ...data,
        campaign_cost: budgetTTC,
        balance_after: data?.available_balance ? data.available_balance - budgetTTC : 0,
        has_sufficient_balance: data?.available_balance
          ? data.available_balance >= budgetTTC
          : false,
        message: data?.message || '',
      };

      return adjustedData;
    } catch (error) {
      log.error({ error }, 'Erreur lors de la vérification du solde');
      return null;
    }
  }

  /**
   * Calculer le coût estimé d'une campagne
   */
  async calculateCampaignCost(campaignId: string): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('calculate_campaign_cost', {
        p_campaign_id: campaignId,
      });

      if (error) throw error;

      return data || 0;
    } catch (error) {
      log.error({ error }, 'Erreur calcul coût campagne');
      return 0;
    }
  }

  /**
   * Formater un montant en TND : 0,000.00 TND (virgule milliers, point décimal)
   */
  formatAmount(amount: number): string {
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    return `${formatted} TND`;
  }
}

export const balanceService = new BalanceService();
