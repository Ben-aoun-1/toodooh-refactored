import {
  DollarSign,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Eye,
  CreditCard,
  Building,
  Banknote,
  TrendingUp,
  Filter,
  Plus,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import {
  useRecharges,
  useRechargeStats,
  useRechargeAdvertisers,
  useRechargeMutations,
} from '@/features/admin/hooks/useRecharges';
import {
  adminRechargesService,
  type AdminRecharge,
} from '@/features/admin/services/admin-recharges.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage, isErrorWithCode } from '@/lib/errors';

export default function RechargeManagement() {
  const user = useAuthStore((s) => s.user);
  const contactName = useAuthStore((s) => s.contactName);
  const [selectedRecharge, setSelectedRecharge] = useState<AdminRecharge | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showValidateModal, setShowValidateModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [validationNotes, setValidationNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  // Formulaire création recharge
  const [newRecharge, setNewRecharge] = useState({
    user_id: '',
    amount: '',
    payment_method: 'bank' as 'card' | 'bank' | 'cash',
    description: '',
    auto_validate: true,
  });
  // Filtres et pagination
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const {
    recharges,
    total: totalRecharges,
    loading,
    error: rechargesError,
  } = useRecharges({
    status: statusFilter,
    search: searchTerm,
    page: currentPage,
    perPage: itemsPerPage,
  });
  const { stats } = useRechargeStats();
  const { advertisers } = useRechargeAdvertisers();
  const { approveRecharge, rejectRecharge, createRecharge } = useRechargeMutations();

  // Distingue "table absente" d'une erreur générique, comme l'ancien loadData.
  useEffect(() => {
    if (!rechargesError) return;
    const err = isErrorWithCode(rechargesError) ? rechargesError : null;
    if (
      err?.code === 'PGRST204' ||
      err?.code === 'PGRST205' ||
      err?.message?.includes('does not exist')
    ) {
      toast.error(
        "La table recharges n'existe pas encore. Veuillez exécuter create_recharges_table.sql",
        { duration: 5000 },
      );
    } else {
      toast.error('Erreur lors du chargement des données');
    }
  }, [rechargesError]);

  const handleApprove = async () => {
    if (!selectedRecharge || !user) return;

    try {
      await approveRecharge.mutateAsync({
        rechargeId: selectedRecharge.id,
        adminId: user.id,
        advertiserUserId: selectedRecharge.user_id,
        notes: validationNotes,
      });

      toast.success('Recharge validée avec succès !');
      setShowValidateModal(false);
      setValidationNotes('');
      setSelectedRecharge(null);
    } catch (_error) {
      toast.error('Erreur lors de la validation');
    }
  };

  const handleReject = async () => {
    if (!selectedRecharge || !user || !rejectReason.trim()) {
      toast.error('Veuillez indiquer une raison de rejet');
      return;
    }

    try {
      await rejectRecharge.mutateAsync({
        rechargeId: selectedRecharge.id,
        adminId: user.id,
        reason: rejectReason,
      });

      toast.success('Recharge rejetée');
      setShowRejectModal(false);
      setRejectReason('');
      setSelectedRecharge(null);
    } catch (_error) {
      toast.error('Erreur lors du rejet');
    }
  };

  const handleCreateRecharge = async () => {
    if (!user) return;

    // Validation
    if (!newRecharge.user_id) {
      toast.error('Veuillez sélectionner un annonceur');
      return;
    }
    if (!newRecharge.amount || parseFloat(newRecharge.amount) <= 0) {
      toast.error('Veuillez saisir un montant valide');
      return;
    }

    try {
      await createRecharge.mutateAsync({
        userId: newRecharge.user_id,
        amount: parseFloat(newRecharge.amount),
        paymentMethod: newRecharge.payment_method,
        description: newRecharge.description,
        autoValidate: newRecharge.auto_validate,
        adminId: user.id,
        adminFullName: contactName ?? '',
      });

      toast.success(
        newRecharge.auto_validate
          ? 'Recharge créée et validée avec succès !'
          : 'Recharge créée, en attente de validation',
      );

      // Réinitialiser le formulaire
      setNewRecharge({
        user_id: '',
        amount: '',
        payment_method: 'bank',
        description: '',
        auto_validate: true,
      });
      setShowCreateModal(false);
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la création de la recharge');
    }
  };

  const totalPages = Math.ceil(totalRecharges / itemsPerPage);

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    completed: 'bg-green-100 text-green-800 border-green-200',
    failed: 'bg-red-100 text-red-800 border-red-200',
    cancelled: 'bg-gray-100 text-gray-800 border-gray-200',
  };

  const statusLabels = {
    pending: 'En attente',
    completed: 'Validée',
    failed: 'Rejetée',
    cancelled: 'Annulée',
  };

  const paymentMethodIcons = {
    card: <CreditCard className="h-4 w-4" />,
    bank: <Building className="h-4 w-4" />,
    cash: <Banknote className="h-4 w-4" />,
  };

  const paymentMethodLabels = {
    card: 'Carte bancaire',
    bank: 'Virement bancaire',
    cash: 'Espèces',
  };

  if (loading && recharges.length === 0) {
    return (
      <AdminLayout>
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
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Recharges</p>
                <p className="text-2xl font-bold text-gray-900">{stats.total_recharges}</p>
              </div>
              <DollarSign className="h-10 w-10 text-blue-500" />
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
                <p className="text-2xl font-bold text-gray-900">{stats.completed_count}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {adminRechargesService.formatAmount(stats.completed_amount)}
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
      )}

      {/* Filtres et Bouton Nouvelle Recharge */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Filtres</h3>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors"
          >
            <Plus className="h-5 w-5" />
            <span>Nouvelle recharge</span>
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Filtre par statut */}
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
              <option value="pending">En attente</option>
              <option value="completed">Validées</option>
              <option value="failed">Rejetées</option>
              <option value="cancelled">Annulées</option>
            </select>
          </div>

          {/* Recherche */}
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
                  Mode de paiement
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
              {recharges.map((recharge) => (
                <tr key={recharge.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{recharge.reference}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">
                      {recharge.business_name}
                    </div>
                    <div className="text-xs text-gray-500">{recharge.user_email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-bold text-brand-primary">
                      {adminRechargesService.formatAmount(recharge.amount)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2 text-sm text-gray-600">
                      {paymentMethodIcons[recharge.payment_method]}
                      <span>{paymentMethodLabels[recharge.payment_method]}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${statusColors[recharge.status]}`}
                    >
                      {statusLabels[recharge.status]}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(recharge.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end space-x-2">
                      {/* Voir détails */}
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

                      {/* Actions selon le statut */}
                      {recharge.status === 'pending' && (
                        <>
                          <button
                            onClick={() => {
                              setSelectedRecharge(recharge);
                              setShowValidateModal(true);
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
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Précédent
            </button>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Affichage de{' '}
                <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> à{' '}
                <span className="font-medium">
                  {Math.min(currentPage * itemsPerPage, totalRecharges)}
                </span>{' '}
                sur <span className="font-medium">{totalRecharges}</span> résultats
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm"
              >
                <option value={10}>10 par page</option>
                <option value={20}>20 par page</option>
                <option value={50}>50 par page</option>
                <option value={100}>100 par page</option>
              </select>

              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  Précédent
                </button>
                <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                  Page {currentPage} sur {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  Suivant
                </button>
              </nav>
            </div>
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
                        className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${statusColors[selectedRecharge.status]}`}
                      >
                        {statusLabels[selectedRecharge.status]}
                      </span>
                    </p>
                  </div>
                </div>

                <div>
                  <span className="text-sm font-medium text-gray-600">Annonceur</span>
                  <p className="text-lg font-semibold text-gray-900">
                    {selectedRecharge.business_name}
                  </p>
                  <p className="text-sm text-gray-500">{selectedRecharge.user_email}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-gray-600">Montant</span>
                    <p className="text-2xl font-bold text-brand-primary">
                      {adminRechargesService.formatAmount(selectedRecharge.amount)}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-600">Mode de paiement</span>
                    <div className="flex items-center space-x-2 text-gray-900">
                      {paymentMethodIcons[selectedRecharge.payment_method]}
                      <span>{paymentMethodLabels[selectedRecharge.payment_method]}</span>
                    </div>
                  </div>
                </div>

                {selectedRecharge.transaction_id && (
                  <div>
                    <span className="text-sm font-medium text-gray-600">ID Transaction</span>
                    <p className="text-sm font-mono text-gray-900">
                      {selectedRecharge.transaction_id}
                    </p>
                  </div>
                )}

                {selectedRecharge.description && (
                  <div>
                    <span className="text-sm font-medium text-gray-600">Description</span>
                    <p className="text-sm text-gray-900">{selectedRecharge.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-gray-600">Date de création</span>
                    <p className="text-sm text-gray-900">
                      {new Date(selectedRecharge.created_at).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  {selectedRecharge.validated_at && (
                    <div>
                      <span className="text-sm font-medium text-gray-600">Date de validation</span>
                      <p className="text-sm text-gray-900">
                        {new Date(selectedRecharge.validated_at).toLocaleString('fr-FR')}
                      </p>
                    </div>
                  )}
                </div>

                {selectedRecharge.validator_name && (
                  <div>
                    <span className="text-sm font-medium text-gray-600">Validé par</span>
                    <p className="text-sm text-gray-900">{selectedRecharge.validator_name}</p>
                  </div>
                )}

                {selectedRecharge.validation_notes && (
                  <div>
                    <span className="text-sm font-medium text-gray-600">Notes de validation</span>
                    <p className="text-sm text-gray-900 bg-gray-50 p-3 rounded-lg">
                      {selectedRecharge.validation_notes}
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
      {showValidateModal && selectedRecharge && (
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
                    Montant: {adminRechargesService.formatAmount(selectedRecharge.amount)}
                  </p>
                  <p className="text-sm text-green-700">
                    Annonceur: {selectedRecharge.business_name}
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <label
                  className="block text-sm font-medium text-gray-700 mb-2"
                  htmlFor="validation-notes"
                >
                  Notes (optionnel)
                </label>
                <textarea
                  value={validationNotes}
                  onChange={(e) => setValidationNotes(e.target.value)}
                  rows={3}
                  placeholder="Ajouter des notes de validation..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  id="validation-notes"
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowValidateModal(false);
                    setValidationNotes('');
                    setSelectedRecharge(null);
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleApprove}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
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
                    Montant: {adminRechargesService.formatAmount(selectedRecharge.amount)}
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
                  disabled={!rejectReason.trim()}
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

      {/* Modal Création Recharge */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-2xl font-bold text-[#00263A] mb-6">
                Créer une nouvelle recharge
              </h3>

              <div className="space-y-4">
                {/* Sélection annonceur */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="user-id">
                    Annonceur *
                  </label>
                  <select
                    value={newRecharge.user_id}
                    onChange={(e) => setNewRecharge({ ...newRecharge, user_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                    required
                    id="user-id"
                  >
                    <option value="">Sélectionner un annonceur</option>
                    {advertisers.map((adv) => (
                      <option key={adv.user_id} value={adv.user_id}>
                        {adv.business_name} ({adv.email})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Montant */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="amount">
                    Montant (TND) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newRecharge.amount}
                    onChange={(e) => setNewRecharge({ ...newRecharge, amount: e.target.value })}
                    placeholder="Ex: 500.00"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                    required
                    id="amount"
                  />
                </div>

                {/* Mode de paiement */}
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-2"
                    htmlFor="payment-method"
                  >
                    Mode de paiement
                  </label>
                  <select
                    value={newRecharge.payment_method}
                    onChange={(e) =>
                      setNewRecharge({
                        ...newRecharge,
                        payment_method: e.target.value as 'card' | 'bank' | 'cash',
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                    id="payment-method"
                  >
                    <option value="bank">Virement bancaire</option>
                    <option value="card">Carte bancaire</option>
                    <option value="cash">Espèces</option>
                  </select>
                </div>

                {/* Description */}
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-2"
                    htmlFor="description"
                  >
                    Description (optionnel)
                  </label>
                  <textarea
                    value={newRecharge.description}
                    onChange={(e) =>
                      setNewRecharge({ ...newRecharge, description: e.target.value })
                    }
                    rows={3}
                    placeholder="Ajouter une description..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                    id="description"
                  />
                </div>

                {/* Validation automatique */}
                <div className="flex items-center space-x-2 bg-green-50 border border-green-200 rounded-lg p-4">
                  <input
                    type="checkbox"
                    id="auto_validate"
                    checked={newRecharge.auto_validate}
                    onChange={(e) =>
                      setNewRecharge({ ...newRecharge, auto_validate: e.target.checked })
                    }
                    className="h-4 w-4 text-brand-primary focus:ring-brand-primary border-gray-300 rounded"
                  />
                  <label htmlFor="auto_validate" className="text-sm text-gray-700">
                    <span className="font-medium">Valider automatiquement</span>
                    <p className="text-xs text-gray-500 mt-1">
                      Si coché, la recharge sera validée immédiatement et le solde mis à jour
                    </p>
                  </label>
                </div>

                {/* Aperçu du montant */}
                {newRecharge.amount && parseFloat(newRecharge.amount) > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-blue-800">
                      Montant à ajouter:{' '}
                      {adminRechargesService.formatAmount(parseFloat(newRecharge.amount))}
                    </p>
                    {newRecharge.auto_validate && (
                      <p className="text-xs text-blue-600 mt-1">
                        ✓ Le solde de l'annonceur sera crédité immédiatement
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewRecharge({
                      user_id: '',
                      amount: '',
                      payment_method: 'bank',
                      description: '',
                      auto_validate: true,
                    });
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleCreateRecharge}
                  disabled={
                    !newRecharge.user_id ||
                    !newRecharge.amount ||
                    parseFloat(newRecharge.amount) <= 0
                  }
                  className="px-6 py-2 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="h-5 w-5" />
                  <span>Créer la recharge</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
