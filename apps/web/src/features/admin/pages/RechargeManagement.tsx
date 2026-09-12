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

import AdjustWalletModal from '@/features/admin/components/AdjustWalletModal';
import AdminLayout from '@/features/admin/components/AdminLayout';
import RechargeDetailsModal from '@/features/admin/components/RechargeDetailsModal';
import {
  useAdminRecharges,
  useAdvertiserIdentities,
  useRechargeMutations,
} from '@/features/admin/hooks/useRecharges';
import {
  adminRechargesService,
  computeRechargeStats,
  type AdminRecharge,
} from '@/features/admin/services/admin-recharges.service';
import {
  ADMIN_STATUS_FILTER_LABELS,
  isAdminDecidable,
  methodLabel,
  statusChipClass,
  statusLabel,
} from '@/features/wallet/lib/recharge-methods';
import { getErrorMessage } from '@/lib/errors';

// The recharge moderation queue over /api/admin/recharges. FCT1: the table gains the Type column
// (Virement / Bon de commande / « — » legacy) and the PER-METHOD status labels from the shared
// wallet lib; the status filter offers the display labels; Valider/Annuler show on the DECIDABLE
// rows (virement + legacy while pending, bon once « Bon retourné signé » — « Bon émis » rows are
// server-excluded and never reach this page). Annuler requires a reason (surfaced to the
// screencaster). Filter/search/pagination + the stat cards stay client-side over the one list.
// CF-M2: documented recharges badge « Justificatif ✓ »; the details modal shows the file(s).

const PER_PAGE = 20;

export default function RechargeManagement() {
  const { recharges, loading, isError } = useAdminRecharges();
  const advertisers = useAdvertiserIdentities();
  const { confirmRecharge, rejectRecharge } = useRechargeMutations();

  const [selectedRecharge, setSelectedRecharge] = useState<AdminRecharge | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  // FCT2 (US-FCT-9) — the « $ » solde adjustment, targeting the row's advertiser.
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // FCT1 — filtered by DISPLAY label (the per-method labels are the admin's vocabulary).
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement des recharges');
  }, [isError]);

  const stats = useMemo(() => computeRechargeStats(recharges), [recharges]);

  // Client-side filter (per-method status label) + search (reference) over the full list.
  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return recharges.filter((r) => {
      const matchesStatus =
        statusFilter === 'all' || statusLabel(r.method, r.status) === statusFilter;
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
      toast.error("Veuillez indiquer une raison d'annulation");
      return;
    }
    try {
      await rejectRecharge.mutateAsync({ id: selectedRecharge.id, reason: rejectReason });
      toast.success('Demande annulée');
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedRecharge(null);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || "Erreur lors de l'annulation");
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
              {/* ADM-RCH1 — the cancelled money is named, never summed. */}
              {stats.rejected_count > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  hors {stats.rejected_count} annulée{stats.rejected_count > 1 ? 's' : ''} ·{' '}
                  {adminRechargesService.formatAmount(stats.rejected_amount)}
                </p>
              )}
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
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              id="status-filter"
            >
              <option value="all">Tous les statuts</option>
              {ADMIN_STATUS_FILTER_LABELS.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
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
                  Type
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
                    <div className="text-sm text-gray-600">{methodLabel(recharge.method)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${statusChipClass(recharge.status)}`}
                      >
                        {statusLabel(recharge.method, recharge.status)}
                      </span>
                      {/* CF-M2 — documented recharges are badged so the queue shows at a glance
                          which requests carry their bank-transfer proof. */}
                      {recharge.has_document && (
                        <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                          Justificatif ✓
                        </span>
                      )}
                    </div>
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
                      {/* FCT2 — « $ »: adjust the ROW'S advertiser's solde (any row, any status). */}
                      <button
                        onClick={() => {
                          setSelectedRecharge(recharge);
                          setShowAdjustModal(true);
                        }}
                        className="text-emerald-600 hover:text-emerald-900"
                        title="Ajuster le solde"
                      >
                        <Banknote className="h-5 w-5" />
                      </button>
                      {isAdminDecidable(recharge) && (
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
                            title="Annuler"
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
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500">
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

      {/* Modal Détails (extracted — CF-M2 adds the justificatif display) */}
      {showDetailsModal && selectedRecharge && (
        <RechargeDetailsModal
          recharge={selectedRecharge}
          advertiserName={advertiserName(selectedRecharge)}
          advertiserEmail={advertiserEmail(selectedRecharge)}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedRecharge(null);
          }}
        />
      )}

      {/* FCT2 — Modal Ajustement du solde (US-FCT-9) */}
      {showAdjustModal && selectedRecharge && (
        <AdjustWalletModal
          advertiserId={selectedRecharge.advertiser_id}
          advertiserName={advertiserName(selectedRecharge)}
          onClose={() => {
            setShowAdjustModal(false);
            setSelectedRecharge(null);
          }}
        />
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

      {/* Modal Annulation (FCT1 — the reject action, per-method « Annulée » status label) */}
      {showRejectModal && selectedRecharge && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
            <div className="p-6">
              <h3 className="text-2xl font-bold text-[#00263A] mb-4">Annuler la demande</h3>
              <div className="mb-4">
                <p className="text-gray-700">Veuillez indiquer la raison de l&apos;annulation :</p>
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
                  Raison de l&apos;annulation *
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={4}
                  placeholder="Indiquer la raison de l'annulation..."
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
                  Fermer
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || rejectRecharge.isPending}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <XCircle className="h-5 w-5" />
                  <span>Annuler la demande</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
