import { apiClient } from '@/lib/api-client';

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

/**
 * Wire shape of `GET /api/screenhosts/earnings` (owner-scoped). One `line` per
 * reconciled (campaign × screenhost) payout — the diffused-impressions earnings
 * the engine recorded at admin reconciliation (L-redisp). `total_tnd` is the
 * owner's grand total; numerics are already coerced server-side.
 */
interface EarningsLine {
  campaign_id: string;
  campaign_name: string;
  screenhost_id: string;
  screenhost_name: string;
  expected_imp: number;
  delivered_imp: number;
  earnings_tnd: number;
  reconciled_at: string;
}

interface EarningsView {
  total_tnd: number;
  lines: EarningsLine[];
}

const isInCurrentMonth = (iso: string): boolean => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

/**
 * Owner earnings, served by the engine (`GET /api/screenhosts/earnings`, cookie-auth, owner-scoped
 * server-side). De-Supabased: the former service queried `screens` and FABRICATED revenue with
 * `Math.random()`; every figure below is now derived from REAL reconciled payouts (or an honest
 * zero where the legacy mock had no real source). The endpoint is session-scoped, so no userId is
 * passed here — the hook keeps it only for cache-keying.
 */
class RevenueService {
  private fetchEarnings(): Promise<EarningsView> {
    return apiClient.get<EarningsView>('/screenhosts/earnings');
  }

  // Revenus repliés par écran (établissement). Pas de consommateur live aujourd'hui — on replie
  // fidèlement les lignes par screenhost (le type de retour est conservé pour export.service).
  async getRevenueByScreen(
    _period: 'monthly' | 'quarterly' | 'yearly' = 'monthly',
  ): Promise<ScreenRevenue[]> {
    const { lines } = await this.fetchEarnings();
    const byScreen = new Map<string, ScreenRevenue>();
    for (const line of lines) {
      let entry = byScreen.get(line.screenhost_id);
      if (!entry) {
        entry = {
          screen_id: line.screenhost_id,
          screen_name: line.screenhost_name,
          location: line.screenhost_name,
          total_revenue: 0,
          monthly_revenue: 0,
          average_revenue: 0,
          revenue_history: [],
        };
        byScreen.set(line.screenhost_id, entry);
      }
      entry.total_revenue += line.earnings_tnd;
      if (isInCurrentMonth(line.reconciled_at)) entry.monthly_revenue += line.earnings_tnd;
      entry.revenue_history.push({
        id: `${line.campaign_id}-${line.screenhost_id}`,
        screen_id: line.screenhost_id,
        screen_name: line.campaign_name || line.screenhost_name,
        location: line.screenhost_name,
        amount: line.earnings_tnd,
        period: 'monthly',
        date: line.reconciled_at,
        created_at: line.reconciled_at,
        updated_at: line.reconciled_at,
      });
    }
    for (const entry of byScreen.values()) {
      entry.average_revenue =
        entry.revenue_history.length > 0
          ? Math.round(entry.total_revenue / entry.revenue_history.length)
          : 0;
    }
    return [...byScreen.values()];
  }

  // Une RevenueData par ligne de paie (campagne × écran). Alimente le tableau des transactions de
  // OwnerRevenue (qui lit id, amount, date). Ce sont des crédits POSITIFs — le filtre 'Dépenses'
  // (montant < 0) reste donc vide (à confirmer côté produit, cf. risque #6 du plan).
  async getRevenueByPeriod(_period: 'monthly' | 'quarterly' | 'yearly'): Promise<RevenueData[]> {
    const { lines } = await this.fetchEarnings();
    return lines.map((line) => ({
      id: `${line.campaign_id}-${line.screenhost_id}`,
      screen_id: line.screenhost_id,
      screen_name: line.campaign_name || line.screenhost_name,
      location: line.screenhost_name,
      amount: line.earnings_tnd,
      period: 'monthly',
      date: line.reconciled_at,
      created_at: line.reconciled_at,
      updated_at: line.reconciled_at,
    }));
  }

  // Statistiques globales. Seuls les champs reconstructibles depuis les paies réelles sont calculés
  // (total, revenu du mois courant, nombre d'écrans distincts, meilleur écran) ; les champs qui
  // n'existaient qu'en mock (trimestriel/annuel/croissance/points de fidélité) tombent à 0 — on ne
  // fabrique PLUS de chiffres.
  async getRevenueStats(): Promise<RevenueStats> {
    const { total_tnd, lines } = await this.fetchEarnings();

    const monthlyRevenue = lines
      .filter((line) => isInCurrentMonth(line.reconciled_at))
      .reduce((sum, line) => sum + line.earnings_tnd, 0);

    const earningsByScreen = new Map<string, { name: string; total: number }>();
    for (const line of lines) {
      const current = earningsByScreen.get(line.screenhost_id);
      if (current) {
        current.total += line.earnings_tnd;
      } else {
        earningsByScreen.set(line.screenhost_id, {
          name: line.screenhost_name,
          total: line.earnings_tnd,
        });
      }
    }

    let topPerformingScreen = '';
    let topTotal = -Infinity;
    for (const { name, total } of earningsByScreen.values()) {
      if (total > topTotal) {
        topTotal = total;
        topPerformingScreen = name;
      }
    }

    const screenCount = earningsByScreen.size;

    return {
      totalRevenue: total_tnd,
      monthlyRevenue,
      quarterlyRevenue: 0,
      yearlyRevenue: 0,
      averagePerScreen: screenCount > 0 ? Math.round(total_tnd / screenCount) : 0,
      topPerformingScreen,
      growthRate: 0,
      activeScreens: screenCount,
      totalScreens: screenCount,
      loyaltyPoints: 0,
    };
  }

  // Comparaison mensuelle — aucun consommateur live ; la série temporelle mock (Math.random sur 12
  // mois) n'a pas d'équivalent dans les paies réelles. On renvoie [] (le type est conservé pour
  // export.service) plutôt que d'inventer un historique.
  async getMonthlyComparison(): Promise<MonthlyComparison[]> {
    return [];
  }
}

export const revenueService = new RevenueService();
