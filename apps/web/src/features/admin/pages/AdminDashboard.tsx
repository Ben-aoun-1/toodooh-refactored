import {
  Users,
  Monitor,
  Video,
  TrendingUp,
  DollarSign,
  Activity,
  Eye,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  Star,
  BarChart3,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { usePlatformStats } from '@/features/admin/hooks/usePlatformStats';
import { useAdminStore } from '@/features/admin/stores/admin.store';

export default function AdminDashboard() {
  const { admin } = useAdminStore();
  const navigate = useNavigate();
  const { data: platformStats, loading } = usePlatformStats();
  const globalStats = platformStats?.global ?? null;
  const revenueStats = platformStats?.revenue ?? null;
  const occupancyStats = platformStats?.occupancy ?? null;
  const campaignsPerf = platformStats?.campaigns ?? null;
  const topScreens = platformStats?.top ?? [];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'TND',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  if (loading) {
    return (
      <AdminLayout title="Tableau de Bord">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement des statistiques...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (!admin) {
    return (
      <AdminLayout title="Administration">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Tableau de Bord">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Vue d'ensemble de la plateforme</h2>
        <p className="text-gray-600">
          Bienvenue, {admin.first_name} {admin.last_name}. Voici les chiffres clés de TooDooh.
        </p>
      </div>

      {/* Chiffres clés - Ligne 1 : Revenus */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">💰 Revenus Globaux</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-sm p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-100">Revenu Total</p>
                <p className="text-3xl font-bold mt-2">
                  {formatCurrency(revenueStats?.total_revenue || 0)}
                </p>
              </div>
              <DollarSign className="h-12 w-12 text-green-200" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Revenu Mensuel</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {formatCurrency(revenueStats?.monthly_revenue || 0)}
                </p>
              </div>
              <TrendingUp className="h-10 w-10 text-green-500" />
            </div>
            <div className="mt-3 flex items-center text-sm">
              <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
              <span className="text-green-600 font-medium">
                +{revenueStats?.revenue_growth_rate || 0}%
              </span>
              <span className="text-gray-500 ml-1">vs mois dernier</span>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Revenu Quotidien</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {formatCurrency(revenueStats?.daily_revenue || 0)}
                </p>
              </div>
              <Activity className="h-10 w-10 text-blue-500" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Budget Campagnes</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {formatCurrency(revenueStats?.total_campaigns_budget || 0)}
                </p>
              </div>
              <BarChart3 className="h-10 w-10 text-purple-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Chiffres clés - Ligne 2 : Utilisateurs et Écrans */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">👥 Utilisateurs</h3>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => navigate('/admin-users')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-brand-primary transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {globalStats?.total_users || 0}
                  </p>
                </div>
                <Users className="h-8 w-8 text-gray-400" />
              </div>
            </button>
            <button
              onClick={() => navigate('/admin-users?status=pending')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-yellow-400 transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">En attente</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {globalStats?.pending_users || 0}
                  </p>
                </div>
                <Clock className="h-8 w-8 text-yellow-500" />
              </div>
            </button>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Propriétaires</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {globalStats?.owners_count || 0}
                  </p>
                </div>
                <Monitor className="h-8 w-8 text-blue-500" />
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Annonceurs</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {globalStats?.advertisers_count || 0}
                  </p>
                </div>
                <Users className="h-8 w-8 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">📺 Écrans</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {globalStats?.total_screens || 0}
                  </p>
                </div>
                <Monitor className="h-8 w-8 text-gray-400" />
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">En ligne</p>
                  <p className="text-2xl font-bold text-green-600">
                    {globalStats?.online_screens || 0}
                  </p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Taux d'occupation</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {occupancyStats?.occupancy_rate || 0}%
                  </p>
                </div>
                <Activity className="h-8 w-8 text-brand-primary" />
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Uptime moyen</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {occupancyStats?.average_uptime || 0}%
                  </p>
                </div>
                <CheckCircle className="h-8 w-8 text-blue-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ligne 3 : Campagnes et Vidéos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">🎬 Campagnes</h3>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => navigate('/admin-campaigns')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-brand-primary transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {campaignsPerf?.total_campaigns || 0}
                  </p>
                </div>
                <Video className="h-8 w-8 text-gray-400" />
              </div>
            </button>
            <button
              onClick={() => navigate('/admin-campaigns?status=active')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-green-400 transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Actives</p>
                  <p className="text-2xl font-bold text-green-600">
                    {campaignsPerf?.active_campaigns || 0}
                  </p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </button>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Vues totales</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {campaignsPerf?.total_views?.toLocaleString('fr-FR') || 0}
                  </p>
                </div>
                <Eye className="h-8 w-8 text-blue-500" />
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Budget moyen</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(campaignsPerf?.average_budget || 0)}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">📹 Vidéos & Événements</h3>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => navigate('/admin-videos')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-brand-primary transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Vidéos totales</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {globalStats?.total_videos || 0}
                  </p>
                </div>
                <Video className="h-8 w-8 text-gray-400" />
              </div>
            </button>
            <button
              onClick={() => navigate('/admin-videos?status=pending')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-yellow-400 transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">À valider</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {globalStats?.pending_videos || 0}
                  </p>
                </div>
                <Clock className="h-8 w-8 text-yellow-500" />
              </div>
            </button>
            <button
              onClick={() => navigate('/admin-events')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-brand-primary transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Événements</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {globalStats?.total_events || 0}
                  </p>
                </div>
                <Calendar className="h-8 w-8 text-gray-400" />
              </div>
            </button>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">À venir</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {globalStats?.upcoming_events || 0}
                  </p>
                </div>
                <Calendar className="h-8 w-8 text-blue-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ligne 4 : Recharges */}
      <div className="mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">💰 Recharges</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => navigate('/admin-recharges')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-brand-primary transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total</p>
                  <p className="text-2xl font-bold text-gray-900">-</p>
                </div>
                <DollarSign className="h-8 w-8 text-gray-400" />
              </div>
            </button>
            <button
              onClick={() => navigate('/admin-recharges?status=pending')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-yellow-400 transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">En attente</p>
                  <p className="text-2xl font-bold text-yellow-600">-</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-500" />
              </div>
            </button>
            <button
              onClick={() => navigate('/admin-recharges?status=completed')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-green-400 transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Validées</p>
                  <p className="text-2xl font-bold text-green-600">-</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </button>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Montant total</p>
                  <p className="text-2xl font-bold text-brand-primary">-</p>
                </div>
                <TrendingUp className="h-8 w-8 text-brand-primary" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top écrans performants */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          ⭐ Top 5 Écrans les Plus Rentables
        </h3>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Rang
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Écran
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Propriétaire
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Revenu Total
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Revenu Mensuel
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {topScreens.map((screen, idx) => (
                <tr key={screen.screen_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {idx === 0 && (
                        <Star className="h-5 w-5 text-yellow-500 fill-yellow-500 mr-2" />
                      )}
                      <span className="text-sm font-medium text-gray-900">#{idx + 1}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{screen.screen_name}</div>
                    <div className="text-xs text-gray-500">{screen.location}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {screen.owner_business_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">
                    {formatCurrency(screen.total_revenue)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(screen.monthly_revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Aperçu rapide */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
            <AlertCircle className="h-5 w-5 mr-2 text-yellow-500" />
            Validations en attente
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Utilisateurs</span>
              <span className="font-semibold text-gray-900">{globalStats?.pending_users || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Vidéos</span>
              <span className="font-semibold text-gray-900">
                {globalStats?.pending_videos || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Campagnes</span>
              <span className="font-semibold text-gray-900">
                {globalStats?.pending_campaigns || 0}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
            <Monitor className="h-5 w-5 mr-2 text-brand-primary" />
            Performance Écrans
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Taux d'occupation</span>
              <span className="font-semibold text-brand-primary">
                {occupancyStats?.occupancy_rate || 0}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Disponibles</span>
              <span className="font-semibold text-gray-900">
                {occupancyStats?.available_screens || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Revenu moyen/écran</span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(revenueStats?.average_revenue_per_screen || 0)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
            <TrendingUp className="h-5 w-5 mr-2 text-green-500" />
            Croissance
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Revenus</span>
              <span className="font-semibold text-green-600">
                +{revenueStats?.revenue_growth_rate || 0}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Nouveaux utilisateurs</span>
              <span className="font-semibold text-gray-900">{globalStats?.pending_users || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Nouvelles campagnes</span>
              <span className="font-semibold text-gray-900">
                {globalStats?.pending_campaigns || 0}
              </span>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
