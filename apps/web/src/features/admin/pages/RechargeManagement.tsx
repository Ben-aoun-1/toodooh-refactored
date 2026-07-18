import {
  Banknote,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Eye,
  TrendingUp,
  Filter,
} from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import {
  useAdminRecharges,
  useAdvertiserIdentities,
  useRechargeMutations,
} from '@/features/admin/hooks/useRecharges';
import {
  adminRechargesService,
  computeRechargeStats,
  type AdminRecharge,
  type AdminRechargeStatus,
} from '@/features/admin/services/admin-recharges.service';
import { getErrorMessage } from '@/lib/errors';

// De-Supabase: the queue, confirm and reject now ride the EXISTING /api/admin/recharges API. The
// manual admin create-recharge flow + advertiser picker, payment_method, and the confirming admin's
// name are GONE — no new-engine source (advertisers self-top-up via the wallet; see the service
// header). Filter/search/pagination + the stat cards are derived client-side over the one list.

const STATUS_COLORS: Record<AdminRechargeStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
};

const STATUS_LABELS: Record<AdminRechargeStatus, string> = {
  pending: 'En attente',
  confirmed: 'Validée',
  rejected: 'Rejetée',
};

const PER_PAGE = 20;

export default function RechargeManagement() {
  const { recharges, loading, isError } = useAdminRecharges();
  const advertisers = useAdvertiserIdentities();
  const { confirmRecharge, rejectRecharge } = useRechargeMutations();

  const [selectedRecharge, setSelectedRecharge] = useState<AdminRecharge | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AdminRechargeStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement des recharges');
  }, [isError]);

  const stats = useMemo(() => computeRechargeStats(recharges), [recharges]);

  // Client-side filter (status) + search (reference) over the full list.
  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return recharges.filter((r) => {
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      const matchesSearch = needle === '' || r.reference.toLowerCase().includes(needle);
      return matchesStatus && matchesSearch;
    });
  }, [recharges, statusFilter, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const advertiserName = (r: AdminRecharge) =>
    advertisers.get(r.advertiser_id)?.business_name ?? r.advertiser_id;
  const advertiserEmail = (r: AdminRecharge) => advertisers.get(r.advertiser_id)?.email ?? '';

  const handleConfirm = async () => {
    if (!selectedRecharge) return;
    try {
      await confirmRecharge.mutateAsync(selectedRecharge.id);
      toast.success('Recharge validée avec succès !');
      setShowConfirmModal(false);
      setSelectedRecharge(null);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || 'Erreur lors de la validation');
    }
  };

  const handleReject = async () => {
    if (!selectedRecharge || !rejectReason.trim()) {
      toast.error('Veuillez indiquer une raison de rejet');
      return;
    }
    try {
      await rejectRecharge.mutateAsync({ id: selectedRecharge.id, reason: rejectReason });
      toast.success('Recharge rejetée');
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedRecharge(null);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || 'Erreur lors du rejet');
    }
  };

  if (loading && recharges.length === 0) {
    return (
      <AdminLayout title="Gestion des Recharges">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto"></div>
            <p className="mt-4 text-gray-600">Chargement...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Gestion des Recharges"
      subtitle="Valider et gérer les recharges des annonceurs"
    >
      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Recharges</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total_recharges}</p>
            </div>
            <Banknote className="h-10 w-10 text-blue-500" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-yellow-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">En attente</p>
              <p className="text-2xl font-bold text-gray-900">{stats.pending_count}</p>
              <p className="text-xs text-gray-500 mt-1">
                {adminRechargesService.formatAmount(stats.pending_amount)}
              </p>
            </div>
            <Clock className="h-10 w-10 text-yellow-500" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Validées</p>
              <p className="text-2xl font-bold text-gray-900">{stats.confirmed_count}</p>
              <p className="text-xs text-gray-500 mt-1">
                {adminRechargesService.formatAmount(stats.confirmed_amount)}
              </p>
            </div>
            <CheckCircle className="h-10 w-10 text-green-500" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-brand-primary">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Montant Total</p>
              <p className="text-2xl font-bold text-gray-900">
                {adminRechargesService.formatAmount(stats.total_amount)}
              </p>
            </div>
            <TrendingUp className="h-10 w-10 text-brand-primary" />
          </div>
        </div>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="status-filter">
              <Filter className="inline h-4 w-4 mr-1" />
              Statut
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'all' | AdminRechargeStatus);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              id="status-filter"
            >
              <option value="all">Tous les statuts</option>
              <option value="pending">En attente</option>
              <option value="confirmed">Validées</option>
              <option value="rejected">Rejetées</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="search-term">
              <Search className="inline h-4 w-4 mr-1" />
              Rechercher par référence
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Rechercher une référence..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              id="search-term"
            />
          </div>
        </div>
      </div>

      {/* Table des recharges */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Référence
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Annonceur
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Montant
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {pageRows.map((recharge) => (
                <tr key={recharge.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{recharge.reference}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">
                      {advertiserName(recharge)}
                    </div>
                    <div className="text-xs text-gray-500">{advertiserEmail(recharge)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-bold text-brand-primary">
                      {adminRechargesService.formatAmount(recharge.amount_tnd)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${STATUS_COLORS[recharge.status]}`}
                    >
                      {STATUS_LABELS[recharge.status]}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(recharge.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => {
                          setSelectedRecharge(recharge);
                          setShowDetailsModal(true);
                        }}
                        className="text-blue-600 hover:text-blue-900"
                        title="Voir détails"
                      >
                        <Eye className="h-5 w-5" />
                      </button>
                      {recharge.status === 'pending' && (
                        <>
                          <button
                            onClick={() => {
                              setSelectedRecharge(recharge);
                              setShowConfirmModal(true);
                            }}
                            className="text-green-600 hover:text-green-900"
                            title="Valider"
                          >
                            <CheckCircle className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedRecharge(recharge);
                              setShowRejectModal(true);
                            }}
                            className="text-red-600 hover:text-red-900"
                            title="Rejeter"
                          >
                            <XCircle className="h-5 w-5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-500">
                    Aucune recharge à afficher
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
          <p className="text-sm text-gray-700">
            {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="relative inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Précédent
            </button>
            <span className="text-sm font-medium text-gray-700">
              Page {page} sur {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="relative inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        </div>
      </div>

      {/* Modal Détails */}
      {showDetailsModal && selectedRecharge && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-2xl font-bold text-[#00263A] mb-6">Détails de la recharge</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-gray-600">Référence</span>
                    <p className="text-lg font-bold text-gray-900">{selectedRecharge.reference}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-600">Statut</span>
                    <p>
                      <span
                        className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${STATUS_COLORS[selectedRecharge.status]}`}
                      >
                        {STATUS_LABELS[selectedRecharge.status]}
                      </span>
                    </p>
                  </div>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Annonceur</span>
                  <p className="text-lg font-semibold text-gray-900">
                    {advertiserName(selectedRecharge)}
                  </p>
                  <p className="text-sm text-gray-500">{advertiserEmail(selectedRecharge)}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Montant</span>
                  <p className="text-2xl font-bold text-brand-primary">
                    {adminRechargesService.formatAmount(selectedRecharge.amount_tnd)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-gray-600">Date de création</span>
                    <p className="text-sm text-gray-900">
                      {new Date(selectedRecharge.created_at).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  {selectedRecharge.confirmed_at && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Date de validation</span>
                      <p className="text-sm text-gray-900">
                        {new Date(selectedRecharge.confirmed_at).toLocaleString('fr-FR')}
                      </p>
                    </div>
                  )}
                </div>
                {selectedRecharge.reject_reason && (
                  <div>
                    <span className="text-sm font-medium text-gray-600">Raison du rejet</span>
                    <p className="text-sm text-gray-900 bg-gray-50 p-3 rounded-lg">
                      {selectedRecharge.reject_reason}
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => {
                    setShowDetailsModal(false);
                    setSelectedRecharge(null);
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Validation */}
      {showConfirmModal && selectedRecharge && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
            <div className="p-6">
              <h3 className="text-2xl font-bold text-[#00263A] mb-4">Valider la recharge</h3>
              <div className="mb-4">
                <p className="text-gray-700">Êtes-vous sûr de vouloir valider cette recharge ?</p>
                <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-green-800">
                    Référence: {selectedRecharge.reference}
                  </p>
                  <p className="text-sm font-medium text-green-800">
                    Montant: {adminRechargesService.formatAmount(selectedRecharge.amount_tnd)}
                  </p>
                  <p className="text-sm text-green-700">
                    Annonceur: {advertiserName(selectedRecharge)}
                  </p>
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowConfirmModal(false);
                    setSelectedRecharge(null);
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={confirmRecharge.isPending}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
                >
                  <CheckCircle className="h-5 w-5" />
                  <span>Valider</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Rejet */}
      {showRejectModal && selectedRecharge && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
            <div className="p-6">
              <h3 className="text-2xl font-bold text-[#00263A] mb-4">Rejeter la recharge</h3>
              <div className="mb-4">
                <p className="text-gray-700">Veuillez indiquer la raison du rejet :</p>
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-red-800">
                    Référence: {selectedRecharge.reference}
                  </p>
                  <p className="text-sm font-medium text-red-800">
                    Montant: {adminRechargesService.formatAmount(selectedRecharge.amount_tnd)}
                  </p>
                </div>
              </div>
              <div className="mb-4">
                <label
                  className="block text-sm font-medium text-gray-700 mb-2"
                  htmlFor="reject-reason"
                >
                  Raison du rejet *
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={4}
                  placeholder="Indiquer la raison du rejet..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  required
                  id="reject-reason"
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                    setSelectedRecharge(null);
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || rejectRecharge.isPending}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <XCircle className="h-5 w-5" />
                  <span>Rejeter</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
