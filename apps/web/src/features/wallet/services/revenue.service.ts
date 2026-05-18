import { supabase } from '@/lib/supabase';

export interface RevenueData {
  id: string;
  screen_id: string;
  screen_name: string;
  location: string;
  amount: number;
  period: string; // 'monthly', 'quarterly', 'yearly'
  date: string;
  created_at: string;
  updated_at: string;
}

export interface RevenueStats {
  totalRevenue: number;
  monthlyRevenue: number;
  quarterlyRevenue: number;
  yearlyRevenue: number;
  averagePerScreen: number;
  topPerformingScreen: string;
  growthRate: number;
  activeScreens: number;
  totalScreens: number;
  loyaltyPoints: number;
}

export interface MonthlyComparison {
  month: string;
  revenue: number;
  screens: number;
  growth: number;
}

export interface ScreenRevenue {
  screen_id: string;
  screen_name: string;
  location: string;
  total_revenue: number;
  monthly_revenue: number;
  average_revenue: number;
  revenue_history: RevenueData[];
}

class RevenueService {
  // Récupérer les revenus par écran
  async getRevenueByScreen(
    _period: 'monthly' | 'quarterly' | 'yearly' = 'monthly',
  ): Promise<ScreenRevenue[]> {
    // Récupérer l'utilisateur connecté
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return [];
    }

    // Récupérer UNIQUEMENT les écrans du propriétaire connecté
    const { data: screens, error: screensError } = await supabase
      .from('screens')
      .select('*')
      .eq('owner_id', user.id) // Filtrer par propriétaire
      .order('name');

    if (screensError) throw screensError;

    // Simuler des données de revenus détaillées
    const screenRevenues: ScreenRevenue[] = screens.map((screen) => {
      const baseRevenue = screen.monthly_revenue;
      const totalRevenue = screen.total_revenue;

      // Générer un historique de revenus pour les 12 derniers mois
      const revenueHistory: RevenueData[] = [];
      const now = new Date();

      for (let i = 11; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthRevenue = baseRevenue * (0.8 + Math.random() * 0.4); // Variation ±20%

        revenueHistory.push({
          id: `rev_${screen.id}_${i}`,
          screen_id: screen.id,
          screen_name: screen.name,
          location: screen.location,
          amount: Math.round(monthRevenue),
          period: 'monthly',
          date: date.toISOString().split('T')[0],
          created_at: date.toISOString(),
          updated_at: date.toISOString(),
        });
      }

      return {
        screen_id: screen.id,
        screen_name: screen.name,
        location: screen.location,
        total_revenue: totalRevenue,
        monthly_revenue: baseRevenue,
        average_revenue: Math.round(totalRevenue / 12),
        revenue_history: revenueHistory,
      };
    });

    return screenRevenues;
  }

  // Récupérer les revenus par période
  async getRevenueByPeriod(period: 'monthly' | 'quarterly' | 'yearly'): Promise<RevenueData[]> {
    // Récupérer l'utilisateur connecté
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return [];
    }

    // Récupérer UNIQUEMENT les écrans du propriétaire connecté
    const { data: screens, error: screensError } = await supabase
      .from('screens')
      .select('*')
      .eq('owner_id', user.id); // Filtrer par propriétaire

    if (screensError) throw screensError;

    const revenueData: RevenueData[] = [];
    const now = new Date();

    if (period === 'monthly') {
      // Données mensuelles pour les 12 derniers mois
      for (let i = 11; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthTotal = screens.reduce((sum, screen) => {
          const monthRevenue = screen.monthly_revenue * (0.8 + Math.random() * 0.4);
          return sum + monthRevenue;
        }, 0);

        revenueData.push({
          id: `month_${i}`,
          screen_id: 'all',
          screen_name: 'Tous les écrans',
          location: 'Toutes les locations',
          amount: Math.round(monthTotal),
          period: 'monthly',
          date: date.toISOString().split('T')[0],
          created_at: date.toISOString(),
          updated_at: date.toISOString(),
        });
      }
    } else if (period === 'quarterly') {
      // Données trimestrielles pour les 4 derniers trimestres
      for (let i = 3; i >= 0; i--) {
        const quarterStart = new Date(
          now.getFullYear(),
          Math.floor(now.getMonth() / 3) * 3 - i * 3,
          1,
        );
        const quarterTotal = screens.reduce((sum, screen) => {
          const quarterRevenue = screen.monthly_revenue * 3 * (0.8 + Math.random() * 0.4);
          return sum + quarterRevenue;
        }, 0);

        revenueData.push({
          id: `quarter_${i}`,
          screen_id: 'all',
          screen_name: 'Tous les écrans',
          location: 'Toutes les locations',
          amount: Math.round(quarterTotal),
          period: 'quarterly',
          date: quarterStart.toISOString().split('T')[0],
          created_at: quarterStart.toISOString(),
          updated_at: quarterStart.toISOString(),
        });
      }
    } else {
      // Données annuelles pour les 3 dernières années
      for (let i = 2; i >= 0; i--) {
        const yearStart = new Date(now.getFullYear() - i, 0, 1);
        const yearTotal = screens.reduce((sum, screen) => {
          const yearRevenue = screen.monthly_revenue * 12 * (0.8 + Math.random() * 0.4);
          return sum + yearRevenue;
        }, 0);

        revenueData.push({
          id: `year_${i}`,
          screen_id: 'all',
          screen_name: 'Tous les écrans',
          location: 'Toutes les locations',
          amount: Math.round(yearTotal),
          period: 'yearly',
          date: yearStart.toISOString().split('T')[0],
          created_at: yearStart.toISOString(),
          updated_at: yearStart.toISOString(),
        });
      }
    }

    return revenueData;
  }

  // Récupérer les statistiques globales
  async getRevenueStats(): Promise<RevenueStats> {
    // Récupérer l'utilisateur connecté
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        totalRevenue: 0,
        monthlyRevenue: 0,
        quarterlyRevenue: 0,
        yearlyRevenue: 0,
        averagePerScreen: 0,
        topPerformingScreen: 'Aucun',
        growthRate: 0,
        activeScreens: 0,
        totalScreens: 0,
        loyaltyPoints: 0,
      };
    }

    // Récupérer UNIQUEMENT les écrans du propriétaire connecté
    const { data: screens, error: screensError } = await supabase
      .from('screens')
      .select('*')
      .eq('owner_id', user.id); // Filtrer par propriétaire

    if (screensError) throw screensError;

    // Gérer le cas où il n'y a pas d'écrans
    if (screens.length === 0) {
      return {
        totalRevenue: 0,
        monthlyRevenue: 0,
        quarterlyRevenue: 0,
        yearlyRevenue: 0,
        averagePerScreen: 0,
        topPerformingScreen: 'Aucun écran',
        growthRate: 0,
        activeScreens: 0,
        totalScreens: 0,
        loyaltyPoints: 0,
      };
    }

    const totalRevenue = screens.reduce((sum, screen) => sum + screen.total_revenue, 0);
    const monthlyRevenue = screens.reduce((sum, screen) => sum + screen.monthly_revenue, 0);
    const quarterlyRevenue = monthlyRevenue * 3;
    const yearlyRevenue = monthlyRevenue * 12;
    const averagePerScreen = totalRevenue / screens.length;

    // Trouver l'écran le plus performant
    const topScreen = screens.reduce((max, screen) =>
      screen.total_revenue > max.total_revenue ? screen : max,
    );

    // Calculer le taux de croissance (simulation)
    const growthRate = 12.5; // +12.5% par rapport au mois précédent

    const activeScreens = screens.filter((screen) => screen.status === 'active').length;
    const totalScreens = screens.length;
    const loyaltyPoints = screens.reduce((sum, screen) => sum + screen.loyalty_points, 0);

    const stats: RevenueStats = {
      totalRevenue,
      monthlyRevenue,
      quarterlyRevenue,
      yearlyRevenue,
      averagePerScreen: Math.round(averagePerScreen),
      topPerformingScreen: topScreen.name,
      growthRate,
      activeScreens,
      totalScreens,
      loyaltyPoints,
    };

    return stats;
  }

  // Récupérer les comparaisons mensuelles pour les graphiques
  async getMonthlyComparison(): Promise<MonthlyComparison[]> {
    // Récupérer l'utilisateur connecté
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return [];
    }

    // Récupérer UNIQUEMENT les écrans du propriétaire connecté
    const { data: screens, error: screensError } = await supabase
      .from('screens')
      .select('*')
      .eq('owner_id', user.id); // Filtrer par propriétaire

    if (screensError) throw screensError;

    const months = [
      'Janvier',
      'Février',
      'Mars',
      'Avril',
      'Mai',
      'Juin',
      'Juillet',
      'Août',
      'Septembre',
      'Octobre',
      'Novembre',
      'Décembre',
    ];

    const now = new Date();
    const comparisons: MonthlyComparison[] = [];

    for (let i = 11; i >= 0; i--) {
      const monthIndex = (now.getMonth() - i + 12) % 12;
      const monthRevenue = screens.reduce((sum, screen) => {
        const baseRevenue = screen.monthly_revenue;
        const variation = 0.8 + Math.random() * 0.4; // Variation ±20%
        return sum + baseRevenue * variation;
      }, 0);

      const previousMonthRevenue =
        i < 11 ? comparisons[comparisons.length - 1]?.revenue || monthRevenue : monthRevenue;
      const growth =
        previousMonthRevenue > 0
          ? ((monthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
          : 0;

      comparisons.push({
        month: months[monthIndex],
        revenue: Math.round(monthRevenue),
        screens: screens.length,
        growth: Math.round(growth * 100) / 100,
      });
    }

    return comparisons;
  }
}

export const revenueService = new RevenueService();
