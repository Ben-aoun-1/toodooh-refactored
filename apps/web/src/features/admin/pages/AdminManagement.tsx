import {
  Shield,
  User,
  Calendar,
  Search,
  UserPlus,
  Eye,
  XCircle,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { useAdminMutations, useAdmins } from '@/features/admin/hooks/useAdmins';
import { adminService } from '@/features/admin/services/admin.service';
import { useAdminStore } from '@/features/admin/stores/admin.store';
import { AdminProfile } from '@/features/admin/types/admin';

export default function AdminManagement() {
  const { admin } = useAdminStore();
  const navigate = useNavigate();
  const { admins, loading, isError: adminsError } = useAdmins();
  const { deleteAdmin, reactivateAdmin } = useAdminMutations();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'superadmin' | 'admin' | 'moderator'>('all');
  const [selectedAdmin, setSelectedAdmin] = useState<AdminProfile | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [adminToDeactivate, setAdminToDeactivate] = useState<AdminProfile | null>(null);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [adminToReactivate, setAdminToReactivate] = useState<AdminProfile | null>(null);

  useEffect(() => {
    if (adminsError) {
      toast.error('Erreur lors du chargement des administrateurs');
    }
  }, [adminsError]);

  // Filtrage
  const filteredAdmins = admins.filter((a) => {
    const matchesSearch =
      a.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || a.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const handleViewDetails = (adminProfile: AdminProfile) => {
    setSelectedAdmin(adminProfile);
    setShowDetailsModal(true);
  };

  const handleDeactivateClick = (adminProfile: AdminProfile) => {
    setAdminToDeactivate(adminProfile);
    setShowDeactivateModal(true);
  };

  const confirmDeactivate = async () => {
    if (!adminToDeactivate) return;

    try {
      await deleteAdmin.mutateAsync(adminToDeactivate.id);
      toast.success('Administrateur désactivé avec succès');
      setShowDeactivateModal(false);
      setAdminToDeactivate(null);

      // Log l'activité
      if (admin) {
        await adminService.logActivity({
          admin_id: admin.id,
          action: 'deactivate_admin',
          target_type: 'admin',
          target_id: adminToDeactivate.id,
          description: `Désactivation de ${adminToDeactivate.first_name} ${adminToDeactivate.last_name}`,
        });
      }
    } catch (_error) {
      toast.error('Erreur lors de la désactivation');
    }
  };

  const handleReactivateClick = (adminProfile: AdminProfile) => {
    setAdminToReactivate(adminProfile);
    setShowReactivateModal(true);
  };

  const confirmReactivate = async () => {
    if (!adminToReactivate) return;

    try {
      await reactivateAdmin.mutateAsync(adminToReactivate.id);
      toast.success('Administrateur réactivé avec succès');
      setShowReactivateModal(false);
      setAdminToReactivate(null);

      // Log l'activité
      if (admin) {
        await adminService.logActivity({
          admin_id: admin.id,
          action: 'reactivate_admin',
          target_type: 'admin',
          target_id: adminToReactivate.id,
          description: `Réactivation de ${adminToReactivate.first_name} ${adminToReactivate.last_name}`,
        });
      }
    } catch (_error) {
      toast.error('Erreur lors de la réactivation');
    }
  };

  const getRoleBadge = (role: string) => {
    const badges = {
      superadmin: {
        bg: 'bg-purple-100',
        text: 'text-purple-800',
        label: 'Super Admin',
        icon: Shield,
      },
      admin: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Administrateur', icon: Shield },
      moderator: { bg: 'bg-green-100', text: 'text-green-800', label: 'Modérateur', icon: User },
    };
    const badge = badges[role as keyof typeof badges] || badges.moderator;
    const Icon = badge.icon;
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
      >
        <Icon className="w-3 h-3 mr-1" />
        {badge.label}
      </span>
    );
  };

  const getStatusBadge = (isActive: boolean) => {
    return isActive ? (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <CheckCircle className="w-3 h-3 mr-1" />
        Actif
      </span>
    ) : (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
        <XCircle className="w-3 h-3 mr-1" />
        Inactif
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Vérifier que l'utilisateur est super admin
  if (!admin || admin.role !== 'superadmin') {
    return (
      <AdminLayout title="Gestion des Admins" subtitle="Accès réservé au Super Administrateur">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Accès Refusé</h3>
          <p className="text-gray-600 mb-6">
            Seul le Super Administrateur peut gérer les administrateurs et modérateurs.
          </p>
          <button
            onClick={() => navigate('/admin-dashboard')}
            className="px-6 py-2 bg-brand-primary text-white rounded-lg hover:bg-[#008C82] transition-colors"
          >
            Retour au Dashboard
          </button>
        </div>
      </AdminLayout>
    );
  }

  if (loading) {
    return (
      <AdminLayout title="Gestion des Admins" subtitle="Liste des administrateurs et modérateurs">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Gestion des Admins" subtitle="Liste des administrateurs et modérateurs">
      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{admins.length}</p>
            </div>
            <Shield className="h-12 w-12 text-gray-400" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Super Admins</p>
              <p className="text-3xl font-bold text-purple-600 mt-2">
                {admins.filter((a) => a.role === 'superadmin').length}
              </p>
            </div>
            <Shield className="h-12 w-12 text-purple-500" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Administrateurs</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">
                {admins.filter((a) => a.role === 'admin').length}
              </p>
            </div>
            <Shield className="h-12 w-12 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Modérateurs</p>
              <p className="text-3xl font-bold text-green-600 mt-2">
                {admins.filter((a) => a.role === 'moderator').length}
              </p>
            </div>
            <User className="h-12 w-12 text-green-500" />
          </div>
        </div>
      </div>

      {/* Filtres et recherche */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Rechercher un administrateur..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>

          <div className="flex gap-4">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              <option value="all">Tous les rôles</option>
              <option value="superadmin">Super Admin</option>
              <option value="admin">Administrateur</option>
              <option value="moderator">Modérateur</option>
            </select>

            <button
              onClick={() => navigate('/admin-create')}
              className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-[#008C82] transition-colors flex items-center"
            >
              <UserPlus className="h-5 w-5 mr-2" />
              Créer Admin
            </button>
          </div>
        </div>
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Administrateur
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rôle
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dernière connexion
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date de création
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAdmins.map((adminProfile) => (
                <tr key={adminProfile.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 bg-brand-primary rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-medium">
                          {adminProfile.first_name.charAt(0)}
                          {adminProfile.last_name.charAt(0)}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {adminProfile.first_name} {adminProfile.last_name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{adminProfile.email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">{getRoleBadge(adminProfile.role)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(adminProfile.is_active)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {adminProfile.last_login ? formatDate(adminProfile.last_login) : 'Jamais'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {formatDate(adminProfile.created_at)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleViewDetails(adminProfile)}
                      className="text-brand-primary hover:text-[#008C82] mr-3"
                      title="Voir détails"
                    >
                      <Eye className="h-5 w-5" />
                    </button>
                    {adminProfile.role !== 'superadmin' && (
                      <>
                        {adminProfile.is_active ? (
                          <button
                            onClick={() => handleDeactivateClick(adminProfile)}
                            className="text-red-600 hover:text-red-800"
                            title="Désactiver"
                          >
                            <XCircle className="h-5 w-5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivateClick(adminProfile)}
                            className="text-green-600 hover:text-green-800"
                            title="Réactiver"
                          >
                            <CheckCircle className="h-5 w-5" />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de détails */}
      {showDetailsModal && selectedAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Détails de l'Administrateur</h3>
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="h-6 w-6" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Informations personnelles */}
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <User className="h-5 w-5 mr-2 text-brand-primary" />
                  Informations Personnelles
                </h4>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-gray-600">Prénom</span>
                      <p className="text-sm text-gray-900 mt-1 font-semibold">
                        {selectedAdmin.first_name}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-600">Nom</span>
                      <p className="text-sm text-gray-900 mt-1 font-semibold">
                        {selectedAdmin.last_name}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-600">Email</span>
                      <p className="text-sm text-gray-900 mt-1">{selectedAdmin.email}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-600">Rôle</span>
                      <div className="mt-1">{getRoleBadge(selectedAdmin.role)}</div>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-600">Statut</span>
                      <div className="mt-1">{getStatusBadge(selectedAdmin.is_active)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Informations de connexion */}
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <Calendar className="h-5 w-5 mr-2 text-brand-primary" />
                  Informations de Connexion
                </h4>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-gray-600">Date de création</span>
                      <p className="text-sm text-gray-900 mt-1">
                        {formatDate(selectedAdmin.created_at)}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-600">Dernière connexion</span>
                      <p className="text-sm text-gray-900 mt-1">
                        {selectedAdmin.last_login ? formatDate(selectedAdmin.last_login) : 'Jamais'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowDetailsModal(false)}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmation de désactivation */}
      {showDeactivateModal && adminToDeactivate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-gray-900">Désactiver l'administrateur</h3>
              </div>
            </div>

            <p className="text-gray-600 mb-6">
              Êtes-vous sûr de vouloir désactiver{' '}
              <strong>
                {adminToDeactivate.first_name} {adminToDeactivate.last_name}
              </strong>{' '}
              ?
              <br />
              <span className="text-sm">
                Cette action empêchera cet utilisateur de se connecter.
              </span>
            </p>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowDeactivateModal(false);
                  setAdminToDeactivate(null);
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmDeactivate}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Désactiver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmation de réactivation */}
      {showReactivateModal && adminToReactivate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="flex items-center mb-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-gray-900">Réactiver l'administrateur</h3>
              </div>
            </div>

            <p className="text-gray-600 mb-6">
              Êtes-vous sûr de vouloir réactiver{' '}
              <strong>
                {adminToReactivate.first_name} {adminToReactivate.last_name}
              </strong>{' '}
              ?
              <br />
              <span className="text-sm">
                Cet utilisateur pourra à nouveau se connecter à la plateforme.
              </span>
            </p>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowReactivateModal(false);
                  setAdminToReactivate(null);
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmReactivate}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Réactiver
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
