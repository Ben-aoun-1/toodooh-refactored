import {
  Users,
  Monitor,
  Video,
  TrendingUp,
  DollarSign,
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  BarChart3,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { usePlatformStats } from '@/features/admin/hooks/usePlatformStats';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// De-Supabase: every figure below comes from GET /api/admin/platform-stats (new engine). Fields the
// new engine does NOT yet model — events, per-screen revenue (the legacy Top-5 table), occupancy/
// uptime, revenue growth-rate, daily revenue, average-revenue-per-screen, campaign views — have been
// REMOVED from this dashboard rather than faked. They return when their data source is built.
export default function AdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const contactName = useAuthStore((s) => s.contactName);
  const navigate = useNavigate();
  const { data: stats, loading } = usePlatformStats();

  const usersStats = stats?.users;
  const screensStats = stats?.screens;
  const campaignsStats = stats?.campaigns;
  const creativesStats = stats?.creatives;
  const revenueStats = stats?.revenue;

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

  if (!user) {
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
          Bienvenue, {contactName}. Voici les chiffres clés de TooDooh.
        </p>
      </div>

      {/* Revenus — total + mensuel (recharges confirmées) + budget campagnes */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">💰 Revenus Globaux</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-sm p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-100">Revenu Total</p>
                <p className="text-3xl font-bold mt-2">
                  {formatCurrency(revenueStats?.total_tnd ?? 0)}
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
                  {formatCurrency(revenueStats?.monthly_tnd ?? 0)}
                </p>
              </div>
              <TrendingUp className="h-10 w-10 text-green-500" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Budget Campagnes</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {formatCurrency(campaignsStats?.total_budget_tnd ?? 0)}
                </p>
              </div>
              <BarChart3 className="h-10 w-10 text-purple-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Utilisateurs et Écrans */}
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
                  <p className="text-2xl font-bold text-gray-900">{usersStats?.total ?? 0}</p>
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
                  <p className="text-2xl font-bold text-yellow-600">{usersStats?.pending ?? 0}</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-500" />
              </div>
            </button>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Propriétaires</p>
                  <p className="text-2xl font-bold text-gray-900">{usersStats?.owners ?? 0}</p>
                </div>
                <Monitor className="h-8 w-8 text-blue-500" />
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Annonceurs</p>
                  <p className="text-2xl font-bold text-gray-900">{usersStats?.advertisers ?? 0}</p>
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
                  <p className="text-2xl font-bold text-gray-900">{screensStats?.total ?? 0}</p>
                </div>
                <Monitor className="h-8 w-8 text-gray-400" />
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Actifs</p>
                  <p className="text-2xl font-bold text-green-600">{screensStats?.active ?? 0}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Campagnes et Créatives */}
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
                  <p className="text-2xl font-bold text-gray-900">{campaignsStats?.total ?? 0}</p>
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
                  <p className="text-2xl font-bold text-green-600">{campaignsStats?.active ?? 0}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </button>
            <button
              onClick={() => navigate('/admin-campaigns?status=pending')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-yellow-400 transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">En attente</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {campaignsStats?.pending ?? 0}
                  </p>
                </div>
                <Clock className="h-8 w-8 text-yellow-500" />
              </div>
            </button>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Budget moyen</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatCurrency(campaignsStats?.average_budget_tnd ?? 0)}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">📹 Créatives</h3>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => navigate('/admin-creatives')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-brand-primary transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total</p>
                  <p className="text-2xl font-bold text-gray-900">{creativesStats?.total ?? 0}</p>
                </div>
                <Video className="h-8 w-8 text-gray-400" />
              </div>
            </button>
            <button
              onClick={() => navigate('/admin-creatives?status=pending')}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-yellow-400 transition-all cursor-pointer text-left w-full"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">À valider</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {creativesStats?.pending ?? 0}
                  </p>
                </div>
                <Clock className="h-8 w-8 text-yellow-500" />
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Validations en attente */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
            <AlertCircle className="h-5 w-5 mr-2 text-yellow-500" />
            Validations en attente
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Utilisateurs</span>
              <span className="font-semibold text-gray-900">{usersStats?.pending ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Créatives</span>
              <span className="font-semibold text-gray-900">{creativesStats?.pending ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Campagnes</span>
              <span className="font-semibold text-gray-900">{campaignsStats?.pending ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
            <Activity className="h-5 w-5 mr-2 text-brand-primary" />
            Activité campagnes
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Brouillons</span>
              <span className="font-semibold text-gray-900">{campaignsStats?.draft ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Actives</span>
              <span className="font-semibold text-green-600">{campaignsStats?.active ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Rejetées</span>
              <span className="font-semibold text-gray-900">{campaignsStats?.rejected ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
            <Monitor className="h-5 w-5 mr-2 text-blue-500" />
            Réseau
          </h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Écrans actifs</span>
              <span className="font-semibold text-gray-900">{screensStats?.active ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Propriétaires</span>
              <span className="font-semibold text-gray-900">{usersStats?.owners ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Annonceurs</span>
              <span className="font-semibold text-gray-900">{usersStats?.advertisers ?? 0}</span>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
