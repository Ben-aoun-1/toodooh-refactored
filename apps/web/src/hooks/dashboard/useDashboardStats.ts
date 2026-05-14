import { useEffect, useState } from 'react';

import { logger } from '../../lib/logger';
import { supabase } from '../../lib/supabase';
import { balanceService } from '../../services/balance.service';

const log = logger.child({ module: 'useDashboardStats' });

export interface DashboardStats {
  activeCampaigns: number;
  campaignsDiffused: number;
  totalViews: number;
  conversionRate: number;
  balance: string;
  totalBudget: number;
  totalDurationSeconds: number;
  prevYearCampaigns: number;
  prevYearViews: number;
  prevYearDurationSeconds: number;
  prevYearBudget: number;
}

const INITIAL_STATS: DashboardStats = {
  activeCampaigns: 0,
  campaignsDiffused: 0,
  totalViews: 0,
  conversionRate: 0,
  balance: '0 TND',
  totalBudget: 0,
  totalDurationSeconds: 0,
  prevYearCampaigns: 0,
  prevYearViews: 0,
  prevYearDurationSeconds: 0,
  prevYearBudget: 0,
};

const formatAmountFr = (amount: number) =>
  `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    amount,
  )} TND`;

interface UseDashboardStatsResult {
  stats: DashboardStats;
  availableBalanceTnd: number;
  totalCreatedCampaignsCount: number;
  loading: boolean;
  error: Error | null;
}

export function useDashboardStats(userId: string | undefined): UseDashboardStatsResult {
  const [stats, setStats] = useState<DashboardStats>(INITIAL_STATS);
  const [availableBalanceTnd, setAvailableBalanceTnd] = useState(0);
  const [totalCreatedCampaignsCount, setTotalCreatedCampaignsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: campaigns, error: campaignsError } = await supabase
          .from('campaigns')
          .select('status, views, budget, created_at')
          .eq('user_id', userId);

        if (campaignsError) {
          log.error({ campaignsError }, 'Error fetching campaigns');
        }

        const now = new Date();
        const currentYearStart = new Date(now.getFullYear(), 0, 1);
        const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);
        const prevYearEnd = new Date(now.getFullYear(), 0, 1);

        const isCurrentYear = (c: { created_at?: string }) => {
          if (!c.created_at) return true;
          return new Date(c.created_at) >= currentYearStart;
        };
        const isPrevYear = (c: { created_at?: string }) => {
          if (!c.created_at) return false;
          const d = new Date(c.created_at);
          return d >= prevYearStart && d < prevYearEnd;
        };

        const allCampaigns = campaigns || [];
        const currentCampaigns = allCampaigns.filter(isCurrentYear);
        const prevYearCampaignsList = allCampaigns.filter(isPrevYear);

        const campaignsDiffused = currentCampaigns.length;
        const activeCampaigns = currentCampaigns.filter((c) => c.status === 'active').length;
        const totalViews = currentCampaigns.reduce((sum, c) => sum + (c.views || 0), 0);
        const totalBudget = currentCampaigns.reduce(
          (sum, c) => sum + (parseFloat(String(c.budget)) || 0),
          0,
        );
        const totalDurationSeconds = totalViews * 30;

        const prevYearCampaigns = prevYearCampaignsList.length;
        const prevYearViews = prevYearCampaignsList.reduce((sum, c) => sum + (c.views || 0), 0);
        const prevYearBudget = prevYearCampaignsList.reduce(
          (sum, c) => sum + (parseFloat(String(c.budget)) || 0),
          0,
        );
        const prevYearDurationSeconds = prevYearViews * 30;

        let balance = 0;
        try {
          const balanceInfo = await balanceService.getBalanceInfo(userId);
          balance = balanceInfo ? balanceInfo.available_balance : await balanceService.getUserBalance(userId);
        } catch (e) {
          log.error({ error: e }, 'Erreur récupération solde');
          balance = 0;
        }

        if (cancelled) return;

        const conversionRate = totalViews > 0 ? (activeCampaigns / totalViews) * 100 : 0;

        setStats({
          activeCampaigns,
          campaignsDiffused,
          totalViews,
          conversionRate: Math.round(conversionRate * 10) / 10,
          balance: formatAmountFr(balance),
          totalBudget,
          totalDurationSeconds,
          prevYearCampaigns,
          prevYearViews,
          prevYearDurationSeconds,
          prevYearBudget,
        });
        setAvailableBalanceTnd(balance);
        setTotalCreatedCampaignsCount(allCampaigns.length);
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof Error ? e : new Error(String(e));
        log.error({ error: err }, 'Error loading dashboard stats');
        setError(err);
        setAvailableBalanceTnd(0);
        setTotalCreatedCampaignsCount(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { stats, availableBalanceTnd, totalCreatedCampaignsCount, loading, error };
}
