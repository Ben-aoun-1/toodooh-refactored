import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAdminStore } from '../../stores/admin.store';
import { adminCampaignMonitoringService } from '../../services/admin-campaign-monitoring.service';
import { supabase } from '../../lib/supabase';
import {
  CampaignMonitoringData,
  CampaignGlobalStats,
  CampaignByCategory,
  CampaignLocation,
  CampaignImpressionProgress
} from '../../types/campaign-monitoring';
import AdminLayout from '../../components/admin/AdminLayout';
import {
  Play,
  Pause,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  Eye,
  TrendingUp,
  Users,
  MapPin,
  Calendar,
  DollarSign,
  Monitor,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileVideo,
  AlertCircle,
  StopCircle
} from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function CampaignMonitoring() {
  const { admin } = useAdminStore();
  
  // Vérifier que l'utilisateur est super admin ou admin
  if (!admin || (admin.role !== 'superadmin' && admin.role !== 'admin')) {
    return (
      <AdminLayout title="Monitoring des Campagnes" subtitle="Accès réservé aux administrateurs">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Accès Refusé</h3>
          <p className="text-gray-600 mb-6">
            Cette page est réservée aux Super Administrateurs et Administrateurs.
          </p>
        </div>
      </AdminLayout>
    );
  }
  const location = useLocation();
  const [campaigns, setCampaigns] = useState<CampaignMonitoringData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'completed' | 'paused'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignMonitoringData | null>(null);
  const [selectedCampaignLocations, setSelectedCampaignLocations] = useState<CampaignLocation[]>([]);
  const [selectedCampaignImpressionProgress, setSelectedCampaignImpressionProgress] = useState<CampaignImpressionProgress | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [campaignToStop, setCampaignToStop] = useState<CampaignMonitoringData | null>(null);
  const [stopReason, setStopReason] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  
  // Statistiques
  const [stats, setStats] = useState<CampaignGlobalStats>({
    total_campaigns: 0,
    active_campaigns: 0,
    pending_campaigns: 0,
    completed_campaigns: 0,
    paused_campaigns: 0,
    total_budget: 0,
    active_budget: 0,
    total_views: 0,
    avg_budget: 0
  });
  const [categoriesData, setCategoriesData] = useState<CampaignByCategory[]>([]);

  // Détecter le filtre depuis l'URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('status');
    if (status === 'active' || status === 'pending' || status === 'completed' || status === 'paused') {
      setStatusFilter(status);
    }
  }, [location.search]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Charger la liste des campagnes en priorité (affichage rapide).
      const campaignsData = await adminCampaignMonitoringService.getCampaignsWithScreens();
      setCampaigns(campaignsData);
    } catch (error: any) {
      console.error('Error loading campaigns:', error);
      toast.error('Erreur lors du chargement des campagnes');
    } finally {
      setLoading(false);
    }

    // Charger stats et catégories en arrière-plan (sans bloquer le rendu principal)
    Promise.allSettled([
      adminCampaignMonitoringService.getGlobalStats(),
      adminCampaignMonitoringService.getCampaignsByCategory()
    ]).then((results) => {
      const [statsResult, categoriesResult] = results;
      if (statsResult.status === 'fulfilled') setStats(statsResult.value);
      if (categoriesResult.status === 'fulfilled') setCategoriesData(categoriesResult.value);
    });
  };

  // Filtrage des campagnes
  const filteredCampaigns = campaigns.filter(campaign => {
    const matchesSearch = campaign.campaign_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         campaign.advertiser_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         campaign.client_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || campaign.status === statusFilter;
    const matchesCategory = categoryFilter === 'all' || campaign.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  });

  // Pagination
  const totalPages = Math.ceil(filteredCampaigns.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCampaigns = filteredCampaigns.slice(startIndex, endIndex);

  // Réinitialiser la page lors du changement de filtre
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, categoryFilter, searchTerm]);

  const handleViewDetails = async (campaign: CampaignMonitoringData) => {
    setSelectedCampaign(campaign);
    setShowDetailsModal(true);
    setSelectedCampaignLocations([]);
    setSelectedCampaignImpressionProgress(null);
    
    // Charger les localités de la campagne
    try {
      const [locations, progress] = await Promise.all([
        adminCampaignMonitoringService.getCampaignLocations(campaign.campaign_id),
        adminCampaignMonitoringService.getCampaignImpressionProgress(campaign.campaign_id),
      ]);
      setSelectedCampaignLocations(locations);
      setSelectedCampaignImpressionProgress(progress);
    } catch (error) {
      console.error('Erreur chargement localités:', error);
      setSelectedCampaignLocations([]);
      setSelectedCampaignImpressionProgress(null);
    }
  };

  const handleStopCampaign = async () => {
    if (!campaignToStop || !admin) return;

    if (!stopReason.trim()) {
      toast.error('Veuillez indiquer une raison d\'arrêt');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      // Arrêter immédiatement la campagne
      let { error } = await supabase
        .from('campaigns')
        .update({
          status: 'paused',
          validation_notes: `⚠️ ARRÊT D'URGENCE par ${admin.full_name}\nRaison: ${stopReason}\nDate: ${new Date().toLocaleString('fr-FR')}`
        })
        .eq('id', campaignToStop.campaign_id);

      if (error?.code === 'PGRST204' && String(error?.message || '').includes('validation_notes')) {
        const { error: fallbackError } = await supabase
          .from('campaigns')
          .update({ status: 'paused' })
          .eq('id', campaignToStop.campaign_id);
        error = fallbackError;
      }

      if (error) throw error;

      toast.success('Campagne arrêtée immédiatement !', {
        icon: '⚠️',
        duration: 4000
      });

      setShowStopModal(false);
      setCampaignToStop(null);
      setStopReason('');
      loadData();
    } catch (error: any) {
      console.error('Erreur arrêt campagne:', error);
      toast.error(error.message || 'Erreur lors de l\'arrêt de la campagne');
    }
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      active: { bg: 'bg-green-100', text: 'text-green-800', icon: Play, label: 'Active' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Clock, label: 'En attente' },
      completed: { bg: 'bg-blue-100', text: 'text-blue-800', icon: CheckCircle, label: 'Terminée' },
      paused: { bg: 'bg-gray-100', text: 'text-gray-800', icon: Pause, label: 'En pause' }
    };
    const badge = badges[status as keyof typeof badges] || badges.pending;
    const Icon = badge.icon;
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        <Icon className="w-3 h-3 mr-1" />
        {badge.label}
      </span>
    );
  };

  const getValidationBadge = (status: string) => {
    const badges = {
      approved: { bg: 'bg-green-100', text: 'text-green-800', label: 'Validé' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'En attente' },
      rejected: { bg: 'bg-red-100', text: 'text-red-800', label: 'Rejeté' }
    };
    const badge = badges[status as keyof typeof badges] || badges.pending;
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      commercial: 'Commercial',
      institutional: 'Institutionnel',
      cultural: 'Culturel',
      social: 'Social',
      other: 'Autre'
    };
    return labels[category] || category;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND' }).format(amount);
  };

  const formatNumber = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));

  if (loading) {
    return (
      <AdminLayout title="Monitoring des Campagnes" subtitle="Suivez toutes les campagnes en temps réel">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6]"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Monitoring des Campagnes" subtitle="Suivez toutes les campagnes en temps réel">
      {/* Statistiques globales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Campagnes</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total_campaigns}</p>
              <p className="text-xs text-gray-500 mt-1">{stats.active_campaigns} actives</p>
            </div>
            <BarChart3 className="h-12 w-12 text-[#00B3A6]" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Budget Total</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{formatCurrency(stats.total_budget)}</p>
              <p className="text-xs text-gray-500 mt-1">{formatCurrency(stats.active_budget)} actif</p>
            </div>
            <DollarSign className="h-12 w-12 text-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Vues Totales</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total_views.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Toutes campagnes</p>
            </div>
            <TrendingUp className="h-12 w-12 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Budget Moyen</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{formatCurrency(stats.avg_budget)}</p>
              <p className="text-xs text-gray-500 mt-1">Par campagne</p>
            </div>
            <Monitor className="h-12 w-12 text-purple-500" />
          </div>
        </div>
      </div>

      {/* Filtres et recherche */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Rechercher une campagne..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B3A6]"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B3A6] appearance-none"
            >
              <option value="all">Tous les statuts</option>
              <option value="active">Active</option>
              <option value="pending">En attente</option>
              <option value="completed">Terminée</option>
              <option value="paused">En pause</option>
            </select>
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B3A6] appearance-none"
            >
              <option value="all">Toutes catégories</option>
              {categoriesData.map((cat) => (
                <option key={cat.category} value={cat.category}>
                  {getCategoryLabel(cat.category)} ({cat.count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>{filteredCampaigns.length} campagne(s)</span>
          </div>
        </div>
      </div>

      {/* Tableau des campagnes */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campagne
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Annonceur
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Catégorie
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Budget
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Écrans
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contenu
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedCampaigns.map((campaign) => (
                <tr key={campaign.campaign_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{campaign.campaign_name}</div>
                    <div className="text-xs text-gray-500">{campaign.client_name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{campaign.advertiser_name}</div>
                    <div className="text-xs text-gray-500">{campaign.advertiser_email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-900">{getCategoryLabel(campaign.category)}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900">{formatCurrency(campaign.budget)}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      <Monitor className="w-3 h-3 mr-1" />
                      {campaign.screens_count}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(campaign.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getValidationBadge(campaign.content_validation_status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end space-x-2">
                      {/* Voir détails */}
                      <button
                        onClick={() => handleViewDetails(campaign)}
                        className="text-[#00B3A6] hover:text-[#008C82]"
                        title="Voir détails"
                      >
                        <Eye className="h-5 w-5" />
                      </button>

                      {/* Arrêt d'urgence - Uniquement pour les campagnes actives */}
                      {campaign.status === 'active' && (
                        <button
                          onClick={() => {
                            setCampaignToStop(campaign);
                            setShowStopModal(true);
                          }}
                          className="text-red-600 hover:text-red-800 transition-colors"
                          title="Arrêt d'urgence"
                        >
                          <StopCircle className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Précédent
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Suivant
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Affichage de <span className="font-medium">{startIndex + 1}</span> à{' '}
                  <span className="font-medium">{Math.min(endIndex, filteredCampaigns.length)}</span> sur{' '}
                  <span className="font-medium">{filteredCampaigns.length}</span> résultats
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  {[...Array(totalPages)].map((_, i) => (
                    <button
                      key={i + 1}
                      onClick={() => setCurrentPage(i + 1)}
                      className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                        currentPage === i + 1
                          ? 'z-10 bg-[#00B3A6] border-[#00B3A6] text-white'
                          : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>


      {/* Modal de détails */}
      {showDetailsModal && selectedCampaign && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Détails de la Campagne</h3>
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Métriques clés */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-[#00B3A6] to-[#008C82] rounded-lg p-4 text-white">
                  <div className="flex items-center justify-between mb-2">
                    <DollarSign className="h-8 w-8 opacity-80" />
                    <span className="text-xs opacity-80">Budget</span>
                  </div>
                  <p className="text-2xl font-bold">{formatCurrency(selectedCampaign.budget)}</p>
                  <p className="text-xs mt-1 opacity-80">
                    {selectedCampaign.screens_count > 0 
                      ? `${formatCurrency(selectedCampaign.budget / selectedCampaign.screens_count)} / écran`
                      : 'Aucun écran'}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-4 text-white">
                  <div className="flex items-center justify-between mb-2">
                    <TrendingUp className="h-8 w-8 opacity-80" />
                    <span className="text-xs opacity-80">Vues</span>
                  </div>
                  <p className="text-2xl font-bold">{selectedCampaign.views.toLocaleString()}</p>
                  <p className="text-xs mt-1 opacity-80">
                    {selectedCampaign.screens_count > 0 
                      ? `${Math.round(selectedCampaign.views / selectedCampaign.screens_count)} / écran`
                      : 'Aucune vue'}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-4 text-white">
                  <div className="flex items-center justify-between mb-2">
                    <Monitor className="h-8 w-8 opacity-80" />
                    <span className="text-xs opacity-80">Écrans</span>
                  </div>
                  <p className="text-2xl font-bold">{selectedCampaign.screens_count}</p>
                  <p className="text-xs mt-1 opacity-80">
                    {selectedCampaign.screens_count > 1 ? 'écrans actifs' : 'écran actif'}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-4 text-white">
                  <div className="flex items-center justify-between mb-2">
                    <Calendar className="h-8 w-8 opacity-80" />
                    <span className="text-xs opacity-80">Durée</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {Math.ceil((new Date(selectedCampaign.end_date).getTime() - new Date(selectedCampaign.start_date).getTime()) / (1000 * 60 * 60 * 24))}
                  </p>
                  <p className="text-xs mt-1 opacity-80">jours</p>
                </div>
              </div>

              {/* Informations générales */}
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2 text-[#00B3A6]" />
                  Informations Générales
                </h4>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-600">Nom de la campagne</label>
                      <p className="text-sm text-gray-900 mt-1 font-semibold">{selectedCampaign.campaign_name}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Client</label>
                      <p className="text-sm text-gray-900 mt-1">{selectedCampaign.client_name}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Annonceur</label>
                      <p className="text-sm text-gray-900 mt-1 font-semibold">{selectedCampaign.advertiser_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        <a href={`mailto:${selectedCampaign.advertiser_email}`} className="hover:underline">
                          {selectedCampaign.advertiser_email}
                        </a>
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Catégorie</label>
                      <p className="text-sm text-gray-900 mt-1">{getCategoryLabel(selectedCampaign.category)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Période</label>
                      <p className="text-sm text-gray-900 mt-1">
                        Du {formatDate(selectedCampaign.start_date)}
                      </p>
                      <p className="text-sm text-gray-900">
                        au {formatDate(selectedCampaign.end_date)}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Date de création</label>
                      <p className="text-sm text-gray-900 mt-1">{formatDate(selectedCampaign.created_at)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Statut de la campagne</label>
                      <div className="mt-1">{getStatusBadge(selectedCampaign.status)}</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Validation du contenu</label>
                      <div className="mt-1">{getValidationBadge(selectedCampaign.content_validation_status)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Progression impressions */}
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2 text-[#00B3A6]" />
                  Progression des impressions
                </h4>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-white rounded-lg border border-gray-200 p-3">
                      <p className="text-xs text-gray-500">Impressions planifiées</p>
                      <p className="text-xl font-bold text-gray-900 mt-1">
                        {formatNumber(selectedCampaignImpressionProgress?.planned_impressions || 0)}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-3">
                      <p className="text-xs text-gray-500">Impressions réalisées</p>
                      <p className="text-xl font-bold text-gray-900 mt-1">
                        {formatNumber(selectedCampaignImpressionProgress?.realized_impressions || 0)}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-3">
                      <p className="text-xs text-gray-500">Taux de réalisation</p>
                      <p className="text-xl font-bold text-[#00B3A6] mt-1">
                        {((selectedCampaignImpressionProgress?.completion_rate || 0)).toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span>Réalisé / Planifié</span>
                      <span>
                        {formatNumber(selectedCampaignImpressionProgress?.realized_impressions || 0)} / {formatNumber(selectedCampaignImpressionProgress?.planned_impressions || 0)}
                      </span>
                    </div>
                    <div className="h-3 w-full rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#00B3A6] to-[#008C82] transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.max(0, selectedCampaignImpressionProgress?.completion_rate || 0))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Vidéo */}
              {selectedCampaign.video_filename && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <FileVideo className="h-5 w-5 mr-2 text-[#00B3A6]" />
                    Contenu Vidéo
                  </h4>
                  <div className="bg-gray-50 p-4 rounded-lg flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="bg-white p-3 rounded-lg mr-4">
                        <FileVideo className="h-8 w-8 text-[#00B3A6]" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-900 font-medium">{selectedCampaign.video_filename}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Statut: {getValidationBadge(selectedCampaign.content_validation_status)}
                        </p>
                      </div>
                    </div>
                    {selectedCampaign.video_url && (
                      <a
                        href={selectedCampaign.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-[#00B3A6] text-white rounded-lg hover:bg-[#008C82] transition-colors flex items-center"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Voir la vidéo
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Localités associées */}
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <MapPin className="h-5 w-5 mr-2 text-[#00B3A6]" />
                  Localités Associées ({selectedCampaignLocations.length})
                </h4>
                {selectedCampaignLocations.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedCampaignLocations.map((locationRow) => (
                      <div key={locationRow.location_id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-start">
                            <div className="bg-[#00B3A6] bg-opacity-10 p-2 rounded-lg mr-3">
                              <MapPin className="h-5 w-5 text-[#00B3A6]" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{locationRow.location_name}</p>
                              <p className="text-xs text-gray-500 mt-1 flex items-center">
                                <MapPin className="h-3 w-3 mr-1" />
                                {locationRow.location_address}
                              </p>
                            </div>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded font-medium ${
                            locationRow.location_status === 'active' 
                              ? 'bg-green-100 text-green-800' 
                              : locationRow.location_status === 'maintenance'
                                ? 'bg-yellow-100 text-yellow-800'
                                : locationRow.location_status === 'inactive'
                                  ? 'bg-gray-100 text-gray-800'
                                  : 'bg-red-100 text-red-800'
                        }`}>
                            {locationRow.location_status === 'active'
                              ? 'Active'
                              : locationRow.location_status === 'maintenance'
                                ? 'Maintenance'
                                : locationRow.location_status === 'inactive'
                                  ? 'Inactive'
                                  : locationRow.location_status === 'no_screens'
                                    ? 'Sans écran'
                                    : 'Indisponible'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-2 space-y-1">
                          <p className="flex items-center">
                            <Monitor className="h-3 w-3 mr-1" />
                            Écrans: {locationRow.screens_count} ({locationRow.online_screens_count} en ligne)
                          </p>
                          <p className="flex items-center">
                            <Users className="h-3 w-3 mr-1" />
                            Propriétaire: {locationRow.owner_name}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <MapPin className="h-12 w-12 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Aucune localité associée à cette campagne</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-between items-center">
              {/* Bouton arrêt d'urgence si campagne active */}
              {selectedCampaign.status === 'active' && (
                <button
                  onClick={() => {
                    setCampaignToStop(selectedCampaign);
                    setShowDetailsModal(false);
                    setShowStopModal(true);
                  }}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-bold flex items-center space-x-2"
                >
                  <StopCircle className="h-5 w-5" />
                  <span>Arrêt d'Urgence</span>
                </button>
              )}
              
              <button
                onClick={() => setShowDetailsModal(false)}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors ml-auto"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Arrêt d'Urgence */}
      {showStopModal && campaignToStop && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
            <div className="p-6">
              {/* En-tête avec icône d'alerte */}
              <div className="flex items-center mb-4">
                <div className="bg-red-100 p-3 rounded-full mr-4">
                  <StopCircle className="h-8 w-8 text-red-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-red-600">Arrêt d'Urgence</h3>
                  <p className="text-sm text-gray-600">Cette action est immédiate et irréversible</p>
                </div>
              </div>
              
              {/* Informations de la campagne */}
              <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-red-800 mb-2">
                  Campagne à arrêter :
                </p>
                <p className="text-base font-bold text-red-900">
                  {campaignToStop.campaign_name}
                </p>
                <div className="mt-2 text-xs text-red-700">
                  <p>Annonceur: {campaignToStop.advertiser_name}</p>
                  <p>Budget: {formatCurrency(campaignToStop.budget)}</p>
                  <p>Status actuel: Active</p>
                </div>
              </div>

              {/* Avertissement */}
              <div className="mb-4 bg-yellow-50 border-l-4 border-yellow-400 p-4">
                <div className="flex items-start">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-800">
                    <p className="font-semibold mb-1">Attention !</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>La campagne sera immédiatement mise en pause</li>
                      <li>La diffusion s'arrêtera sur tous les écrans</li>
                      <li>L'annonceur sera notifié</li>
                      <li>Cette action sera enregistrée dans l'historique</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Champ raison */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Raison de l'arrêt d'urgence *
                </label>
                <textarea
                  value={stopReason}
                  onChange={(e) => setStopReason(e.target.value)}
                  rows={4}
                  placeholder="Ex: Contenu inapproprié détecté, violation des conditions d'utilisation, erreur technique critique..."
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Cette raison sera visible par l'annonceur et enregistrée dans l'historique.
                </p>
              </div>

              {/* Boutons */}
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowStopModal(false);
                    setCampaignToStop(null);
                    setStopReason('');
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Annuler
                </button>
                <button
                  onClick={handleStopCampaign}
                  disabled={!stopReason.trim()}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-bold flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <StopCircle className="h-5 w-5" />
                  <span>Arrêter Immédiatement</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

