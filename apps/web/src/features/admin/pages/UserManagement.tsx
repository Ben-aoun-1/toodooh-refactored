import { useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Search,
  Eye,
  Check,
  X,
  Clock,
  UserCheck,
  UserX,
  Mail,
  MapPin,
  Shield,
  Building,
  User,
  FileText,
  AlertCircle,
  Trash2,
  CreditCard,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation } from 'react-router-dom';

import AdminLayout from '@/features/admin/components/AdminLayout';
import UserDocumentReviewGroup from '@/features/admin/components/UserDocumentReviewGroup';
import { adminKeys } from '@/features/admin/hooks/queryKeys';
import { useUserDocuments, useUserMutations, useUsers } from '@/features/admin/hooks/useUsers';
import { adminUserService, type AdminUser } from '@/features/admin/services/admin-user.service';
import { apiErrorMessage } from '@/features/auth/services/auth-errors';
import { ApiError } from '@/lib/api-client';

export default function UserManagement() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { users, loading, isError: usersError } = useUsers();
  const { approveUser, rejectUser } = useUserMutations();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'all',
  );
  const [typeFilter, setTypeFilter] = useState<
    'all' | 'individual_owner' | 'fleet_owner' | 'advertiser' | 'agency'
  >('all');

  // Détecter le filtre depuis l'URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('status');
    if (status === 'pending' || status === 'approved' || status === 'rejected') {
      setStatusFilter(status);
    }
  }, [location.search]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  // The reviewed user's documents, grouped by category (F-docs Commit 3). Fetched only while a user
  // is selected; presigning a single document is the imperative getDocumentUrlById call below.
  const { documents: userDocuments, loading: documentsLoading } = useUserDocuments(
    selectedUser?.id ?? null,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  // Reject-reason modal (G2 D-G2-3) — the backend requires a non-empty rejection note.
  const [rejectTarget, setRejectTarget] = useState<AdminUser | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [submittingReject, setSubmittingReject] = useState(false);
  // 409 prior-state modal (G2 D-G2-4) — set to the conflicted user's id; the queue is refetched
  // first so the modal reads the now-fresh row from the merged list.
  const [conflictId, setConflictId] = useState<string | null>(null);

  // Fonction pour obtenir les utilisateurs filtrés
  const getFilteredUsers = () => {
    return users.filter((user) => {
      const matchesSearch =
        user.business_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.contact_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.contact_phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.city.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
      const matchesType = typeFilter === 'all' || user.profile_type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  };

  useEffect(() => {
    if (usersError) {
      toast.error('Erreur lors du chargement des utilisateurs');
    }
  }, [usersError]);

  const filteredUsers = getFilteredUsers();

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

  // Reset à la page 1 quand les filtres changent
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, typeFilter]);

  // On a 409 (already approved/rejected by another admin), refetch the queue first so the modal
  // reads the now-fresh row, then open the prior-state modal (G2 D-G2-4).
  const handleConflict = async (id: string): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    setConflictId(id);
  };

  const handleApprove = async (id: string) => {
    try {
      await approveUser.mutateAsync({ id });
      toast.success('Utilisateur approuvé avec succès');
      setShowDetailsModal(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await handleConflict(id);
      } else {
        toast.error(`Erreur lors de l'approbation: ${apiErrorMessage(error)}`);
      }
    }
  };

  // The reject flow opens a modal collecting the required reason (G2 D-G2-3); submitReject sends it.
  const openReject = (target: AdminUser) => {
    setRejectNotes('');
    setRejectTarget(target);
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    const notes = rejectNotes.trim();
    if (!notes) return;
    setSubmittingReject(true);
    const id = rejectTarget.id;
    try {
      await rejectUser.mutateAsync({ id, notes });
      toast.success('Utilisateur rejeté');
      setRejectTarget(null);
      setRejectNotes('');
      setShowDetailsModal(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setRejectTarget(null);
        await handleConflict(id);
      } else {
        toast.error(`Erreur lors du rejet: ${apiErrorMessage(error)}`);
      }
    } finally {
      setSubmittingReject(false);
    }
  };

  // Presign-on-demand by document uuid (the :id-scoped route, NOT the legacy category shim) and open
  // it (G2 D-G2-1). The uuid route preserves recto-vs-verso; the shim collapses to lowest position.
  const handleViewDocument = async (userId: string, docId: string) => {
    try {
      const url = await adminUserService.getDocumentUrlById(userId, docId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(`Impossible d'ouvrir le document: ${apiErrorMessage(error)}`);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock, text: 'En attente' },
      approved: { color: 'bg-green-100 text-green-800', icon: Check, text: 'Approuvé' },
      rejected: { color: 'bg-red-100 text-red-800', icon: X, text: 'Rejeté' },
    };

    const config = statusConfig[status as keyof typeof statusConfig];
    const Icon = config.icon;

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}
      >
        <Icon className="w-3 h-3 mr-1" />
        {config.text}
      </span>
    );
  };

  const getTypeBadge = (type: string) => {
    const typeConfig = {
      individual_owner: {
        color: 'bg-blue-100 text-blue-800',
        icon: UserCheck,
        text: 'Propriétaire Individuel',
      },
      fleet_owner: {
        color: 'bg-purple-100 text-purple-800',
        icon: Building,
        text: 'Propriétaire Flotte',
      },
      advertiser: { color: 'bg-orange-100 text-orange-800', icon: Shield, text: 'Annonceur' },
      agency: { color: 'bg-cyan-100 text-cyan-800', icon: Building, text: 'Agence' },
      unknown: { color: 'bg-gray-100 text-gray-700', icon: User, text: 'Inconnu' },
    };

    const config = typeConfig[type as keyof typeof typeConfig] || typeConfig.unknown;
    const Icon = config.icon;

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}
      >
        <Icon className="w-3 h-3 mr-1" />
        {config.text}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isOwnerProfile = (profileType: AdminUser['profile_type']) =>
    profileType === 'individual_owner' || profileType === 'fleet_owner';

  const getAgentCodeLabel = (profileType: AdminUser['profile_type']) => {
    if (isOwnerProfile(profileType)) return "Code agent ScreenHost'";
    if (profileType === 'advertiser') return 'Code agent ScreenCast';
    return '';
  };

  if (loading) {
    return (
      <AdminLayout title="Gestion des Utilisateurs" subtitle="Validez et gérez les inscriptions">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement des utilisateurs...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Gestion des Utilisateurs" subtitle="Validez et gérez les inscriptions">
      {/* Filtres et recherche */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Recherche */}
          <div className="md:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher par nom, entreprise, téléphone ou ville..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              />
            </div>
          </div>

          {/* Filtre statut */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="all">Tous les statuts</option>
              <option value="pending">En attente</option>
              <option value="approved">Approuvés</option>
              <option value="rejected">Rejetés</option>
            </select>
          </div>

          {/* Filtre type */}
          <div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            >
              <option value="all">Tous les types</option>
              <option value="individual_owner">Propriétaire Individuel</option>
              <option value="fleet_owner">Propriétaire Flotte</option>
              <option value="advertiser">Annonceur</option>
              <option value="agency">Agence</option>
            </select>
          </div>
        </div>
      </div>

      {/* Actions en lot (approbation/rejet/suppression groupés) — désactivées en attendant les
          endpoints backend correspondants (slice future). */}

      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">En attente</p>
              <p className="text-2xl font-bold text-gray-900">
                {users.filter((u) => u.status === 'pending').length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-lg">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Approuvés</p>
              <p className="text-2xl font-bold text-gray-900">
                {users.filter((u) => u.status === 'approved').length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-3 bg-red-100 rounded-lg">
              <X className="h-6 w-6 text-red-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Rejetés</p>
              <p className="text-2xl font-bold text-gray-900">
                {users.filter((u) => u.status === 'rejected').length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total</p>
              <p className="text-2xl font-bold text-gray-900">{users.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tableau des utilisateurs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Utilisateur
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Inscription
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 bg-brand-primary rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-medium">
                          {user.contact_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{user.contact_name}</div>
                        <div className="text-sm text-gray-500">{user.business_name}</div>
                        <div className="text-xs text-gray-400">{user.contact_phone}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">{getTypeBadge(user.profile_type)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(user.status)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setShowDetailsModal(true);
                        }}
                        className="text-brand-primary hover:text-brand-primary/80"
                        title="Voir détails"
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      {user.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleApprove(user.id)}
                            className="text-green-600 hover:text-green-800"
                            title="Approuver"
                          >
                            <UserCheck className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openReject(user)}
                            className="text-red-600 hover:text-red-800"
                            title="Rejeter"
                          >
                            <UserX className="h-4 w-4" />
                          </button>
                        </>
                      )}

                      {/* Suppression — bientôt disponible (endpoint backend à venir, slice future) */}
                      <button
                        disabled
                        className="text-gray-300 cursor-not-allowed"
                        title="Suppression bientôt disponible"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Affichage de <span className="font-medium">{startIndex + 1}</span> à{' '}
                  <span className="font-medium">{Math.min(endIndex, filteredUsers.length)}</span>{' '}
                  sur <span className="font-medium">{filteredUsers.length}</span> résultats
                </p>
              </div>
              <div>
                <nav
                  className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
                  aria-label="Pagination"
                >
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ‹
                  </button>
                  {[...Array(totalPages)].map((_, idx) => (
                    <button
                      key={idx + 1}
                      onClick={() => setCurrentPage(idx + 1)}
                      className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                        currentPage === idx + 1
                          ? 'z-10 bg-brand-primary border-brand-primary text-brand-deep'
                          : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ›
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de détails */}
      {showDetailsModal && selectedUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-brand-primary sm:mx-0 sm:h-10 sm:w-10">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 mb-6">
                      Détails de l'utilisateur - Validation
                    </h3>

                    {/* Informations principales */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                      {/* Colonne gauche */}
                      <div className="space-y-4">
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                            <User className="h-5 w-5 mr-2 text-brand-primary" />
                            Informations personnelles
                          </h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Nom complet:</span>
                              <span className="font-medium text-gray-900">
                                {selectedUser.contact_name}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-gray-600">Email:</span>
                              <a
                                href={`mailto:${selectedUser.email}`}
                                className="font-medium text-brand-primary hover:text-brand-primary/90 flex items-center"
                              >
                                <Mail className="h-3 w-3 mr-1" />
                                {selectedUser.email}
                              </a>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Téléphone:</span>
                              <span className="font-medium text-gray-900">
                                {selectedUser.contact_phone}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Type de profil:</span>
                              {getTypeBadge(selectedUser.profile_type)}
                            </div>
                          </div>
                        </div>

                        <div className="bg-gray-50 p-4 rounded-lg">
                          <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                            <Building className="h-5 w-5 mr-2 text-brand-primary" />
                            Informations entreprise
                          </h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Nom entreprise:</span>
                              <span className="font-medium text-gray-900">
                                {selectedUser.business_name}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Type d'activité:</span>
                              <span className="font-medium text-gray-900">
                                {selectedUser.business_type || 'Non spécifié'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">SIRET/TVA:</span>
                              <span className="font-medium text-gray-900">
                                {selectedUser.tax_number || 'Non fourni'}
                              </span>
                            </div>

                            {/* Documents selon le type de profil */}

                            {/* CIN pour les propriétaires individuels */}
                            {selectedUser.profile_type === 'individual_owner' && (
                              <>
                                <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2">
                                  <span className="text-gray-600">Numéro CIN:</span>
                                  <span className="font-medium text-gray-900">
                                    {selectedUser.cin || 'Non fourni'}
                                  </span>
                                </div>
                                <UserDocumentReviewGroup
                                  label="Document CIN"
                                  cin
                                  docs={userDocuments?.cin ?? []}
                                  loading={documentsLoading}
                                  onView={(docId) => handleViewDocument(selectedUser.id, docId)}
                                />
                                {selectedUser.zone && (
                                  <div className="flex justify-between items-center pt-2">
                                    <span className="text-gray-600">Zone:</span>
                                    <span className="font-medium text-gray-900">
                                      {selectedUser.zone}
                                    </span>
                                  </div>
                                )}
                                {/* Nombre d'écrans */}
                                {selectedUser.number_of_screens !== undefined &&
                                  selectedUser.number_of_screens !== null && (
                                    <div className="flex justify-between items-center pt-2">
                                      <span className="text-gray-600">Nombre d'écrans:</span>
                                      <span className="font-medium text-gray-900">
                                        {selectedUser.number_of_screens}
                                      </span>
                                    </div>
                                  )}
                              </>
                            )}

                            {/* RNE pour les propriétaires de parc */}
                            {selectedUser.profile_type === 'fleet_owner' && (
                              <>
                                <UserDocumentReviewGroup
                                  label="Registre de commerce"
                                  topBorder
                                  docs={userDocuments?.rne ?? []}
                                  loading={documentsLoading}
                                  onView={(docId) => handleViewDocument(selectedUser.id, docId)}
                                />
                                {selectedUser.zone && (
                                  <div className="flex justify-between items-center pt-2">
                                    <span className="text-gray-600">Zone:</span>
                                    <span className="font-medium text-gray-900">
                                      {selectedUser.zone}
                                    </span>
                                  </div>
                                )}
                                {/* Nombre d'écrans */}
                                {selectedUser.number_of_screens !== undefined &&
                                  selectedUser.number_of_screens !== null && (
                                    <div className="flex justify-between items-center pt-2">
                                      <span className="text-gray-600">Nombre d'écrans:</span>
                                      <span className="font-medium text-gray-900">
                                        {selectedUser.number_of_screens}
                                      </span>
                                    </div>
                                  )}
                              </>
                            )}

                            {/* RNE pour les annonceurs */}
                            {selectedUser.profile_type === 'advertiser' && (
                              <>
                                <UserDocumentReviewGroup
                                  label="Registre de commerce"
                                  topBorder
                                  docs={userDocuments?.rne ?? []}
                                  loading={documentsLoading}
                                  onView={(docId) => handleViewDocument(selectedUser.id, docId)}
                                />
                              </>
                            )}

                            {/* Documents complémentaires — toutes catégories de profil (F-docs) */}
                            <UserDocumentReviewGroup
                              label="Documents complémentaires"
                              topBorder
                              docs={userDocuments?.complementaire ?? []}
                              loading={documentsLoading}
                              onView={(docId) => handleViewDocument(selectedUser.id, docId)}
                            />

                            {/* Code agent (proprio/annonceur) */}
                            {(isOwnerProfile(selectedUser.profile_type) ||
                              selectedUser.profile_type === 'advertiser') && (
                              <div className="pt-2 border-t border-gray-200 mt-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-gray-600">
                                    {getAgentCodeLabel(selectedUser.profile_type)}:
                                  </span>
                                  {selectedUser.agent_code ? (
                                    <span className="font-medium text-gray-900">
                                      {selectedUser.agent_code}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-amber-600">Non renseigné</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Coordonnées bancaires (propriétaires) — lecture seule (F6) */}
                        {isOwnerProfile(selectedUser.profile_type) && (
                          <div className="bg-gray-50 p-4 rounded-lg">
                            <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                              <CreditCard className="h-5 w-5 mr-2 text-brand-primary" />
                              Coordonnées bancaires
                            </h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Titulaire du compte:</span>
                                <span className="font-medium text-gray-900">
                                  {selectedUser.bank_account_holder || 'Non fourni'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">RIB:</span>
                                <span className="font-medium text-gray-900">
                                  {selectedUser.bank_rib || 'Non fourni'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">IBAN:</span>
                                <span className="font-medium text-gray-900">
                                  {selectedUser.bank_iban || 'Non fourni'}
                                </span>
                              </div>
                              <UserDocumentReviewGroup
                                label="Relevé d'identité bancaire"
                                single
                                topBorder
                                docs={userDocuments?.bank ?? []}
                                loading={documentsLoading}
                                onView={(docId) => handleViewDocument(selectedUser.id, docId)}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Colonne droite */}
                      <div className="space-y-4">
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                            <MapPin className="h-5 w-5 mr-2 text-brand-primary" />
                            Adresse complète
                          </h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Adresse:</span>
                              <span className="font-medium text-gray-900">
                                {selectedUser.street_address}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Ville:</span>
                              <span className="font-medium text-gray-900">{selectedUser.city}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Code postal:</span>
                              <span className="font-medium text-gray-900">
                                {selectedUser.postal_code}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-gray-50 p-4 rounded-lg">
                          <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                            <Clock className="h-5 w-5 mr-2 text-brand-primary" />
                            Statut et historique
                          </h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Statut actuel:</span>
                              {getStatusBadge(selectedUser.status)}
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Inscrit le:</span>
                              <span className="font-medium text-gray-900">
                                {formatDate(selectedUser.created_at)}
                              </span>
                            </div>
                            {selectedUser.verification_status && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Vérification:</span>
                                <span
                                  className={`px-2 py-1 rounded text-xs font-medium ${
                                    selectedUser.verification_status === 'approved'
                                      ? 'bg-green-100 text-green-800'
                                      : selectedUser.verification_status === 'rejected'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-yellow-100 text-yellow-800'
                                  }`}
                                >
                                  {selectedUser.verification_status}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Notes de validation */}
                    {(selectedUser.validation_notes ||
                      selectedUser.validated_at ||
                      selectedUser.validated_by) && (
                      <div className="bg-blue-50 p-4 rounded-lg mb-4">
                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                          <FileText className="h-5 w-5 mr-2 text-blue-600" />
                          Historique de validation
                        </h4>
                        <div className="space-y-2 text-sm">
                          {selectedUser.validation_notes && (
                            <div>
                              <span className="text-gray-600">Notes:</span>
                              <p className="text-gray-900 mt-1 p-2 bg-white rounded border">
                                {selectedUser.validation_notes}
                              </p>
                            </div>
                          )}
                          {selectedUser.validated_at && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Validé le:</span>
                              <span className="font-medium text-gray-900">
                                {formatDate(selectedUser.validated_at)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Actions rapides */}
                    {selectedUser.status === 'pending' && (
                      <div className="bg-yellow-50 p-4 rounded-lg">
                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                          <AlertCircle className="h-5 w-5 mr-2 text-yellow-600" />
                          Actions de validation
                        </h4>
                        <p className="text-sm text-gray-600 mb-3">
                          Cet utilisateur est en attente de validation. Vérifiez toutes les
                          informations avant de prendre une décision.
                        </p>
                        <div className="flex space-x-3">
                          <button
                            onClick={() => handleApprove(selectedUser.id)}
                            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                          >
                            <Check className="h-4 w-4 mr-2" />
                            Approuver
                          </button>
                          <button
                            onClick={() => openReject(selectedUser)}
                            className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                          >
                            <X className="h-4 w-4 mr-2" />
                            Rejeter
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-brand-primary text-base font-medium text-brand-deep hover:bg-brand-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal — raison du rejet (obligatoire, G2 D-G2-3) */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Rejeter {rejectTarget.contact_name}?
                </h3>
                <label htmlFor="reject-notes" className="block text-sm text-gray-600 mb-2">
                  Raison du rejet (obligatoire)
                </label>
                <textarea
                  id="reject-notes"
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent text-sm"
                  placeholder="Expliquez la raison du rejet…"
                />
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  onClick={submitReject}
                  disabled={submittingReject || rejectNotes.trim().length === 0}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed sm:ml-3 sm:w-auto sm:text-sm"
                >
                  {submittingReject ? 'Rejet…' : 'Rejeter'}
                </button>
                <button
                  onClick={() => setRejectTarget(null)}
                  disabled={submittingReject}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal — conflit 409 (déjà approuvé/rejeté ailleurs, G2 D-G2-4). La file a déjà été
          rafraîchie; on lit la ligne fraîche dans la liste fusionnée. */}
      {conflictId &&
        (() => {
          const conflictUser = users.find((u) => u.id === conflictId);
          const statusLabel =
            conflictUser?.status === 'approved'
              ? 'approuvé'
              : conflictUser?.status === 'rejected'
                ? 'rejeté'
                : 'mis à jour';
          return (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
                <div className="fixed inset-0 transition-opacity" aria-hidden="true">
                  <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
                </div>
                <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                  <div className="bg-white px-4 pt-5 pb-4 sm:p-6">
                    <div className="flex items-center mb-3">
                      <AlertCircle className="h-6 w-6 text-yellow-600 mr-2" />
                      <h3 className="text-lg leading-6 font-medium text-gray-900">
                        Action déjà effectuée
                      </h3>
                    </div>
                    <p className="text-sm text-gray-600">
                      Cet utilisateur a déjà été <strong>{statusLabel}</strong>
                      {conflictUser?.validated_at && (
                        <> le {formatDate(conflictUser.validated_at)}</>
                      )}
                      . La file a été actualisée.
                    </p>
                    {conflictUser?.validation_notes && (
                      <p className="text-sm text-gray-900 mt-2 p-2 bg-gray-50 rounded border">
                        {conflictUser.validation_notes}
                      </p>
                    )}
                  </div>
                  <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                    <button
                      onClick={() => setConflictId(null)}
                      className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-brand-primary text-base font-medium text-brand-deep hover:bg-brand-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary sm:ml-3 sm:w-auto sm:text-sm"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </AdminLayout>
  );
}
