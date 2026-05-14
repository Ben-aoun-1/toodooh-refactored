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
} from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation } from 'react-router-dom';

import AdminLayout from '../../components/admin/AdminLayout';
import { logger } from '../../lib/logger';
import { supabase } from '../../lib/supabase';
import { adminUserService, AdminUser } from '../../services/admin-user.service';
import { useAdminStore } from '../../stores/admin.store';
import { getErrorMessage } from '../../lib/errors';

const log = logger.child({ module: 'UserManagement' });

// Utiliser AdminUser du service

export default function UserManagement() {
  const { admin } = useAdminStore();
  const location = useLocation();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // État pour la sélection multiple
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [itemsPerPage] = useState(10);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [agentCodeInput, setAgentCodeInput] = useState('');
  const [savingAgentCode, setSavingAgentCode] = useState(false);

  // Fonctions pour la sélection multiple
  const handleSelectUser = (userId: string) => {
    const newSelectedUsers = new Set(selectedUsers);
    if (newSelectedUsers.has(userId)) {
      newSelectedUsers.delete(userId);
    } else {
      newSelectedUsers.add(userId);
    }
    setSelectedUsers(newSelectedUsers);
    setShowBulkActions(newSelectedUsers.size > 0);
  };

  const handleSelectAll = () => {
    // Sélectionner uniquement les utilisateurs de la page actuelle
    const currentPageUsers = paginatedUsers;
    const currentPageUserIds = currentPageUsers.map((user) => user.id);

    // Vérifier si tous les utilisateurs de la page sont sélectionnés
    const allCurrentPageSelected = currentPageUserIds.every((id) => selectedUsers.has(id));

    if (allCurrentPageSelected) {
      // Désélectionner tous les utilisateurs de la page actuelle
      const newSelectedUsers = new Set(selectedUsers);
      currentPageUserIds.forEach((id) => newSelectedUsers.delete(id));
      setSelectedUsers(newSelectedUsers);
      setShowBulkActions(newSelectedUsers.size > 0);
    } else {
      // Sélectionner tous les utilisateurs de la page actuelle
      const newSelectedUsers = new Set(selectedUsers);
      currentPageUserIds.forEach((id) => newSelectedUsers.add(id));
      setSelectedUsers(newSelectedUsers);
      setShowBulkActions(true);
    }
  };

  const clearSelection = () => {
    setSelectedUsers(new Set());
    setShowBulkActions(false);
  };

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

  // Fonctions pour les actions en lot
  const handleBulkApprove = async () => {
    if (selectedUsers.size === 0) return;

    // Sécurité pour les actions en masse
    if (selectedUsers.size > 20) {
      const confirmed = window.confirm(
        `Vous êtes sur le point d'approuver ${selectedUsers.size} utilisateur(s). Voulez-vous continuer ?`,
      );
      if (!confirmed) return;
    }

    setBulkActionLoading(true);
    try {
      const { error } = await supabase
        .from('business_profiles')
        .update({
          status: 'approved',
          verification_status: 'approved',
          onboarding_completed: true,
          validated_at: new Date().toISOString(),
          validated_by: admin?.id || 'admin',
        })
        .in('id', Array.from(selectedUsers));

      if (error) throw error;

      toast.success(`✅ ${selectedUsers.size} utilisateur(s) approuvé(s) avec succès`);
      await loadUsers();
      clearSelection();
    } catch (error) {
      toast.error(`❌ Erreur lors de l'approbation: ${getErrorMessage(error)}`);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedUsers.size === 0) return;

    // Sécurité pour les actions en masse
    if (selectedUsers.size > 20) {
      const confirmed = window.confirm(
        `Vous êtes sur le point de rejeter ${selectedUsers.size} utilisateur(s). Voulez-vous continuer ?`,
      );
      if (!confirmed) return;
    }

    setBulkActionLoading(true);
    try {
      const { error } = await supabase
        .from('business_profiles')
        .update({
          status: 'rejected',
          verification_status: 'rejected',
          validated_at: new Date().toISOString(),
          validated_by: admin?.id || 'admin',
        })
        .in('id', Array.from(selectedUsers));

      if (error) throw error;

      toast.success(`✅ ${selectedUsers.size} utilisateur(s) rejeté(s) avec succès`);
      await loadUsers();
      clearSelection();
    } catch (error) {
      toast.error(`❌ Erreur lors du rejet: ${getErrorMessage(error)}`);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) return;

    // Sécurité supplémentaire pour éviter les suppressions massives
    if (selectedUsers.size > 10) {
      const confirmed = window.confirm(
        `⚠️ ATTENTION : Vous êtes sur le point de supprimer ${selectedUsers.size} utilisateur(s) !\n\nCette action est irréversible et pourrait avoir un impact majeur sur votre système.\n\nÊtes-vous absolument certain de vouloir continuer ?`,
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        `Êtes-vous sûr de vouloir supprimer ${selectedUsers.size} utilisateur(s) ? Cette action est irréversible.`,
      );
      if (!confirmed) return;
    }

    setBulkActionLoading(true);
    try {
      const userIds = Array.from(selectedUsers);

      let successCount = 0;
      let errorCount = 0;

      // Supprimer chaque utilisateur individuellement avec la fonction complète
      for (let i = 0; i < userIds.length; i++) {
        const userId = userIds[i];

        try {
          const success = await adminUserService.deleteUser(userId);
          if (success) {
            successCount++;
          } else {
            errorCount++;
            log.error(`❌ Échec de la suppression de l'utilisateur ${i + 1}/${userIds.length}`);
          }
        } catch (error) {
          log.error({ error }, `❌ Erreur lors de la suppression de l'utilisateur ${userId}`);
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`✅ ${successCount} utilisateur(s) supprimé(s) avec succès`);
      }
      if (errorCount > 0) {
        toast.error(`❌ ${errorCount} utilisateur(s) n'ont pas pu être supprimés`);
      }

      await loadUsers();
      clearSelection();
    } catch (error) {
      toast.error(`❌ Erreur lors de la suppression: ${getErrorMessage(error)}`);
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Charger les utilisateurs
  const loadUsers = async () => {
    try {
      setLoading(true);

      const usersData = await adminUserService.getUsers();

      setUsers(usersData);
    } catch (error) {
      toast.error(`Erreur lors du chargement des utilisateurs: ${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    setAgentCodeInput(selectedUser?.agent_toodooh || '');
  }, [selectedUser?.id, selectedUser?.agent_toodooh]);

  const filteredUsers = getFilteredUsers();

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

  // Reset à la page 1 et désélectionner tout quand les filtres changent
  useEffect(() => {
    setCurrentPage(1);
    clearSelection(); // Désélectionner pour éviter de manipuler des utilisateurs non visibles
  }, [searchTerm, statusFilter, typeFilter]);

  const handleApprove = async (userId: string) => {
    try {
      const success = await adminUserService.approveUser(userId, admin?.id);
      if (success) {
        setUsers(
          users.map((user) =>
            user.id === userId
              ? {
                  ...user,
                  status: 'approved' as const,
                  validated_by: admin?.id,
                  validated_at: new Date().toISOString(),
                }
              : user,
          ),
        );
        toast.success('Utilisateur approuvé avec succès');
      } else {
        toast.error("Erreur lors de l'approbation");
      }
    } catch (error) {
      toast.error("Erreur lors de l'approbation");
    }
  };

  const handleReject = async (userId: string) => {
    try {
      const success = await adminUserService.rejectUser(userId, admin?.id);
      if (success) {
        setUsers(
          users.map((user) =>
            user.id === userId
              ? {
                  ...user,
                  status: 'rejected' as const,
                  validated_by: admin?.id,
                  validated_at: new Date().toISOString(),
                }
              : user,
          ),
        );
        toast.success('Utilisateur rejeté');
      } else {
        toast.error('Erreur lors du rejet');
      }
    } catch (error) {
      toast.error('Erreur lors du rejet');
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    setDeleting(true);
    try {
      const success = await adminUserService.deleteUser(userToDelete.id);
      if (success) {
        // Supprimer l'utilisateur de la liste locale
        setUsers(users.filter((user) => user.id !== userToDelete.id));
        toast.success('Utilisateur supprimé définitivement');
        setShowDeleteModal(false);
        setUserToDelete(null);
      } else {
        toast.error('Erreur lors de la suppression');
      }
    } catch (error) {
      toast.error('Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = (user: AdminUser) => {
    setUserToDelete(user);
    setShowDeleteModal(true);
  };

  const handleUploadDocument = async (authUserId: string, userProfileType: string) => {
    if (!documentFile) {
      toast.error('Veuillez sélectionner un fichier');
      return;
    }

    setUploadingDocument(true);
    try {
      const ext = documentFile.name.split('.').pop();

      // Déterminer le type de document selon le profil
      const isIndividualOwner = userProfileType === 'individual_owner';
      const filePrefix = isIndividualOwner ? 'cin' : 'rne';
      const filePath = `${filePrefix}_${authUserId}_admin_${Date.now()}.${ext}`;

      // Upload vers le bucket registres
      const { error: uploadError } = await supabase.storage
        .from('registres')
        .upload(filePath, documentFile);

      if (uploadError) {
        throw uploadError;
      }

      // Créer une URL signée
      const { data: signedData, error: signedError } = await supabase.storage
        .from('registres')
        .createSignedUrl(filePath, 604800); // 7 jours

      if (signedError || !signedData) {
        throw signedError || new Error("Impossible de créer l'URL signée");
      }

      // Mettre à jour le profil avec l'URL du document
      const updateField = isIndividualOwner ? 'cin_doc_url' : 'registration_doc_url';

      const { error: updateError } = await supabase
        .from('business_profiles')
        .update({ [updateField]: signedData.signedUrl })
        .eq('user_id', authUserId);

      if (updateError) {
        throw updateError;
      }

      // Recharger les utilisateurs pour rafraîchir l'affichage
      const usersData = await adminUserService.getUsers();
      setUsers(usersData);

      // Mettre à jour l'utilisateur sélectionné
      const updatedUser = usersData.find((u) => u.user_id === authUserId);
      if (updatedUser) {
        setSelectedUser(updatedUser);
      }

      setDocumentFile(null);
      toast.success('✅ Document uploadé avec succès !');
    } catch (error) {
      toast.error(`❌ Erreur lors de l'upload: ${getErrorMessage(error) || 'Erreur inconnue'}`);
    } finally {
      setUploadingDocument(false);
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

  const handleSaveAgentCode = async () => {
    if (!selectedUser) return;

    const value = agentCodeInput.trim();
    if (!value) {
      toast.error('Veuillez saisir un code agent');
      return;
    }

    setSavingAgentCode(true);
    try {
      const { error } = await supabase
        .from('business_profiles')
        .update({
          agent_toodooh: value,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedUser.id);

      if (error) throw error;

      setUsers((prev) =>
        prev.map((user) =>
          user.id === selectedUser.id
            ? { ...user, agent_toodooh: value, updated_at: new Date().toISOString() }
            : user,
        ),
      );
      setSelectedUser((prev) =>
        prev ? { ...prev, agent_toodooh: value, updated_at: new Date().toISOString() } : prev,
      );
      toast.success('Code agent enregistré');
    } catch (error) {
      toast.error(
        `Erreur lors de l'enregistrement: ${getErrorMessage(error) || 'Erreur inconnue'}`,
      );
    } finally {
      setSavingAgentCode(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout title="Gestion des Utilisateurs" subtitle="Validez et gérez les inscriptions">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
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
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
              />
            </div>
          </div>

          {/* Filtre statut */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
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
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
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

      {/* Actions en lot */}
      {showBulkActions && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="bg-blue-100 p-2 rounded-lg mr-3">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-blue-900">
                  {selectedUsers.size} utilisateur(s) sélectionné(s)
                </h3>
                <p className="text-sm text-blue-700">
                  Choisissez une action à appliquer à tous les utilisateurs sélectionnés
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleBulkApprove}
                disabled={bulkActionLoading}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="h-4 w-4 mr-2" />
                {bulkActionLoading ? 'Traitement...' : 'Approuver'}
              </button>
              <button
                onClick={handleBulkReject}
                disabled={bulkActionLoading}
                className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="h-4 w-4 mr-2" />
                {bulkActionLoading ? 'Traitement...' : 'Rejeter'}
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkActionLoading}
                className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {bulkActionLoading ? 'Traitement...' : 'Supprimer'}
              </button>
              <button
                onClick={clearSelection}
                className="flex items-center px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <input
                    type="checkbox"
                    checked={
                      paginatedUsers.length > 0 &&
                      paginatedUsers.every((user) => selectedUsers.has(user.id))
                    }
                    onChange={handleSelectAll}
                    className="h-4 w-4 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded"
                  />
                </th>
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
                <tr
                  key={user.id}
                  className={`hover:bg-gray-50 ${selectedUsers.has(user.id) ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedUsers.has(user.id)}
                      onChange={() => handleSelectUser(user.id)}
                      className="h-4 w-4 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 bg-[#00B3A6] rounded-full flex items-center justify-center">
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
                          setDocumentFile(null); // Réinitialiser le fichier
                          setAgentCodeInput(user.agent_toodooh || '');
                        }}
                        className="text-[#00B3A6] hover:text-[#00B3A6]/80"
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
                            onClick={() => handleReject(user.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Rejeter"
                          >
                            <UserX className="h-4 w-4" />
                          </button>
                        </>
                      )}

                      {/* Bouton de suppression pour tous les utilisateurs */}
                      <button
                        onClick={() => confirmDelete(user)}
                        className="text-red-600 hover:text-red-800"
                        title="Supprimer définitivement"
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
                          ? 'z-10 bg-[#00B3A6] border-[#00B3A6] text-white'
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
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-[#00B3A6] sm:mx-0 sm:h-10 sm:w-10">
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
                            <User className="h-5 w-5 mr-2 text-[#00B3A6]" />
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
                                className="font-medium text-[#00B3A6] hover:text-[#008C82] flex items-center"
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
                            <Building className="h-5 w-5 mr-2 text-[#00B3A6]" />
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
                                {selectedUser.cin_doc_url ? (
                                  <div className="flex justify-between items-center pt-2">
                                    <span className="text-gray-600">Document CIN:</span>
                                    <a
                                      href={selectedUser.cin_doc_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center text-[#00B3A6] hover:text-[#008C82] font-medium transition-colors"
                                    >
                                      <FileText className="h-4 w-4 mr-1" />
                                      Voir le document
                                    </a>
                                  </div>
                                ) : (
                                  <div className="pt-2">
                                    <span className="text-gray-600 text-xs block mb-2">
                                      Document CIN non fourni - Upload manuel :
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            if (e.target.files[0].size > 5 * 1024 * 1024) {
                                              toast.error('Fichier trop volumineux (max 5 MB)');
                                              return;
                                            }
                                            setDocumentFile(e.target.files[0]);
                                          }
                                        }}
                                        className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-[#00B3A6] file:text-white hover:file:bg-[#008C82] cursor-pointer"
                                      />
                                      {documentFile && (
                                        <button
                                          onClick={() =>
                                            handleUploadDocument(
                                              selectedUser.user_id,
                                              selectedUser.profile_type,
                                            )
                                          }
                                          disabled={uploadingDocument}
                                          className="px-3 py-1 bg-[#00B3A6] text-white rounded text-xs font-semibold hover:bg-[#008C82] transition-colors disabled:opacity-50"
                                        >
                                          {uploadingDocument ? 'Upload...' : 'Uploader'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
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
                                {selectedUser.registration_doc_url ? (
                                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2">
                                    <span className="text-gray-600">Registre de commerce:</span>
                                    <a
                                      href={selectedUser.registration_doc_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center text-[#00B3A6] hover:text-[#008C82] font-medium transition-colors"
                                    >
                                      <FileText className="h-4 w-4 mr-1" />
                                      Voir le document
                                    </a>
                                  </div>
                                ) : (
                                  <div className="pt-2 border-t border-gray-200 mt-2">
                                    <span className="text-gray-600 text-xs block mb-2">
                                      Registre de commerce non fourni - Upload manuel :
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            if (e.target.files[0].size > 5 * 1024 * 1024) {
                                              toast.error('Fichier trop volumineux (max 5 MB)');
                                              return;
                                            }
                                            setDocumentFile(e.target.files[0]);
                                          }
                                        }}
                                        className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-[#00B3A6] file:text-white hover:file:bg-[#008C82] cursor-pointer"
                                      />
                                      {documentFile && (
                                        <button
                                          onClick={() =>
                                            handleUploadDocument(
                                              selectedUser.user_id,
                                              selectedUser.profile_type,
                                            )
                                          }
                                          disabled={uploadingDocument}
                                          className="px-3 py-1 bg-[#00B3A6] text-white rounded text-xs font-semibold hover:bg-[#008C82] transition-colors disabled:opacity-50"
                                        >
                                          {uploadingDocument ? 'Upload...' : 'Uploader'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
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
                                {selectedUser.registration_doc_url ? (
                                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2">
                                    <span className="text-gray-600">Registre de commerce:</span>
                                    <a
                                      href={selectedUser.registration_doc_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center text-[#00B3A6] hover:text-[#008C82] font-medium transition-colors"
                                    >
                                      <FileText className="h-4 w-4 mr-1" />
                                      Voir le document
                                    </a>
                                  </div>
                                ) : (
                                  <div className="pt-2 border-t border-gray-200 mt-2">
                                    <span className="text-gray-600 text-xs block mb-2">
                                      Registre de commerce non fourni - Upload manuel :
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            if (e.target.files[0].size > 5 * 1024 * 1024) {
                                              toast.error('Fichier trop volumineux (max 5 MB)');
                                              return;
                                            }
                                            setDocumentFile(e.target.files[0]);
                                          }
                                        }}
                                        className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-[#00B3A6] file:text-white hover:file:bg-[#008C82] cursor-pointer"
                                      />
                                      {documentFile && (
                                        <button
                                          onClick={() =>
                                            handleUploadDocument(
                                              selectedUser.user_id,
                                              selectedUser.profile_type,
                                            )
                                          }
                                          disabled={uploadingDocument}
                                          className="px-3 py-1 bg-[#00B3A6] text-white rounded text-xs font-semibold hover:bg-[#008C82] transition-colors disabled:opacity-50"
                                        >
                                          {uploadingDocument ? 'Upload...' : 'Uploader'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Code agent (proprio/annonceur) */}
                            {(isOwnerProfile(selectedUser.profile_type) ||
                              selectedUser.profile_type === 'advertiser') && (
                              <div className="pt-2 border-t border-gray-200 mt-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-gray-600">
                                    {getAgentCodeLabel(selectedUser.profile_type)}:
                                  </span>
                                  {selectedUser.agent_toodooh ? (
                                    <span className="font-medium text-gray-900">
                                      {selectedUser.agent_toodooh}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-amber-600">Non renseigné</span>
                                  )}
                                </div>

                                {!selectedUser.agent_toodooh && (
                                  <div className="mt-2 flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={agentCodeInput}
                                      onChange={(e) => setAgentCodeInput(e.target.value)}
                                      placeholder="Saisir le code agent"
                                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent text-sm"
                                    />
                                    <button
                                      onClick={handleSaveAgentCode}
                                      disabled={savingAgentCode}
                                      className="px-3 py-2 bg-[#00B3A6] text-white rounded-lg text-sm font-medium hover:bg-[#008C82] transition-colors disabled:opacity-50"
                                    >
                                      {savingAgentCode ? 'Enregistrement...' : 'Enregistrer'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Colonne droite */}
                      <div className="space-y-4">
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                            <MapPin className="h-5 w-5 mr-2 text-[#00B3A6]" />
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
                            <Clock className="h-5 w-5 mr-2 text-[#00B3A6]" />
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
                            <div className="flex justify-between">
                              <span className="text-gray-600">Dernière MAJ:</span>
                              <span className="font-medium text-gray-900">
                                {formatDate(selectedUser.updated_at)}
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
                          {selectedUser.validated_by && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Validé par:</span>
                              <span className="font-medium text-gray-900">
                                Admin ID: {selectedUser.validated_by}
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
                            onClick={() => handleReject(selectedUser.id)}
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
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-[#00B3A6] text-base font-medium text-white hover:bg-[#00B3A6]/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00B3A6] sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmation de suppression */}
      {showDeleteModal && userToDelete && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <Trash2 className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">
                      Supprimer définitivement
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Êtes-vous sûr de vouloir supprimer définitivement l'utilisateur{' '}
                        <strong>{userToDelete.contact_name}</strong> ({userToDelete.business_name})
                        ?
                      </p>
                      <div className="mt-3 p-3 bg-red-50 rounded-lg">
                        <p className="text-sm text-red-800 font-medium">
                          ⚠️ Cette action est irréversible et supprimera :
                        </p>
                        <ul className="text-sm text-red-700 mt-2 list-disc list-inside">
                          <li>Le profil utilisateur</li>
                          <li>Toutes les campagnes publicitaires</li>
                          <li>Tous les écrans et emplacements</li>
                          <li>Tous les clients associés</li>
                          <li>Toutes les recharges et factures</li>
                          <li>Le compte d'authentification</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  onClick={handleDeleteUser}
                  disabled={deleting}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed sm:ml-3 sm:w-auto sm:text-sm"
                >
                  {deleting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Suppression...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Supprimer définitivement
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setUserToDelete(null);
                  }}
                  disabled={deleting}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
