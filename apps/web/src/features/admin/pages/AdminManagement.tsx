import { Shield, Search, UserPlus, Eye, XCircle, CheckCircle, AlertCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import {
  AdminAccountDetailsModal,
  AdminDeactivateModal,
  AdminReactivateModal,
  AdminRoleBadge,
  AdminStatusBadge,
} from '@/features/admin/components/AdminAccountModals';
import AdminLayout from '@/features/admin/components/AdminLayout';
import { useAdminMutations, useAdmins, useAgents } from '@/features/admin/hooks/useAdmins';
import { formatAdminDate } from '@/features/admin/lib/admin-dates';
import {
  canDeactivate,
  canReactivate,
  filterStaffAccounts,
  isAgentRole,
  mergeStaffAccounts,
  STAFF_ROLE_LABELS,
  visibleStaffRoles,
} from '@/features/admin/lib/staff-accounts';
import { AdminAccount, StaffRole } from '@/features/admin/types/admin';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';

type RoleFilter = 'all' | StaffRole;

// ADM-ADM1 — the internal-account list. Deactivate = the EXISTING ban route (motif required,
// sessions revoked); reactivate = unban. `moderator`, permissions and « dernière connexion » are
// gone — none exists in the users model.
//
// ADM-FIX1 (operator ruling) — an ADMIN reaches this page too, and the AGENTS are listed alongside
// the admins: GET /api/admin/admins (superadmin-only, skipped for an admin actor) + GET
// /api/admin/agents (admin OR superadmin). The merge / filter / permission rules are pure
// functions in lib/staff-accounts (apps/web has no render harness).
export default function AdminManagement() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const navigate = useNavigate();
  const isSuperadmin = role === 'superadmin';
  const { admins, loading: adminsLoading, isError: adminsError } = useAdmins(isSuperadmin);
  const { agents, loading: agentsLoading, isError: agentsError } = useAgents();
  const { deactivateAdmin, reactivateAdmin } = useAdminMutations();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [selectedAdmin, setSelectedAdmin] = useState<AdminAccount | null>(null);
  const [adminToDeactivate, setAdminToDeactivate] = useState<AdminAccount | null>(null);
  const [adminToReactivate, setAdminToReactivate] = useState<AdminAccount | null>(null);

  const loading = adminsLoading || agentsLoading;
  const listError = adminsError || agentsError;

  useEffect(() => {
    if (listError) {
      toast.error('Erreur lors du chargement des comptes internes');
    }
  }, [listError]);

  const accounts = mergeStaffAccounts(admins, agents);
  const filteredAdmins = filterStaffAccounts(accounts, { search: searchTerm, role: roleFilter });

  const confirmDeactivate = async (notes: string) => {
    if (!adminToDeactivate) return;
    try {
      await deactivateAdmin.mutateAsync({ id: adminToDeactivate.id, notes });
      toast.success('Administrateur désactivé avec succès');
      setAdminToDeactivate(null);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la désactivation');
    }
  };

  const confirmReactivate = async () => {
    if (!adminToReactivate) return;
    try {
      await reactivateAdmin.mutateAsync(adminToReactivate.id);
      toast.success('Administrateur réactivé avec succès');
      setAdminToReactivate(null);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la réactivation');
    }
  };

  const initials = (a: AdminAccount) =>
    `${a.first_name.charAt(0)}${a.last_name.charAt(0)}`.toUpperCase();

  // ADM-FIX1 — un administrateur y a désormais accès (il y voit et y crée les agents).
  if (!user || (role !== 'superadmin' && role !== 'admin')) {
    return (
      <AdminLayout title="Gestion des Admins" subtitle="Accès réservé à l'équipe TOODOOH">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Accès Refusé</h3>
          <p className="text-gray-600 mb-6">
            Seule l'équipe TOODOOH peut gérer les comptes internes.
          </p>
          <button
            onClick={() => navigate('/admin-dashboard')}
            className="px-6 py-2 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors"
          >
            Retour au Dashboard
          </button>
        </div>
      </AdminLayout>
    );
  }

  const subtitle = isSuperadmin ? 'Administrateurs et agents' : 'Agents ScreenHost et ScreenCast';

  if (loading) {
    return (
      <AdminLayout title="Gestion des Admins" subtitle={subtitle}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary"></div>
        </div>
      </AdminLayout>
    );
  }

  // Les cartes « Super Admins » / « Administrateurs » n'ont de sens que pour un superadmin : la
  // liste du personnel reste superadmin-only côté serveur, un admin n'en voit aucune ligne.
  const stats: { label: string; value: number; color: string }[] = [
    { label: 'Total', value: accounts.length, color: 'text-gray-900' },
    ...(isSuperadmin
      ? [
          {
            label: 'Super Admins',
            value: accounts.filter((a) => a.role === 'superadmin').length,
            color: 'text-purple-600',
          },
          {
            label: 'Administrateurs',
            value: accounts.filter((a) => a.role === 'admin').length,
            color: 'text-blue-600',
          },
        ]
      : []),
    {
      label: 'Agents',
      value: accounts.filter((a) => isAgentRole(a.role)).length,
      color: 'text-teal-600',
    },
    { label: 'Actifs', value: accounts.filter((a) => a.is_active).length, color: 'text-green-600' },
  ];
  const th = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';

  return (
    <AdminLayout title="Gestion des Admins" subtitle={subtitle}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex items-center justify-between"
          >
            <div>
              <p className="text-sm font-medium text-gray-600">{stat.label}</p>
              <p className={`text-3xl font-bold mt-2 ${stat.color}`}>{stat.value}</p>
            </div>
            <Shield className="h-12 w-12 text-gray-400" />
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Rechercher un compte interne..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>

          <div className="flex gap-4">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              <option value="all">Tous les rôles</option>
              {visibleStaffRoles(role).map((r) => (
                <option key={r} value={r}>
                  {STAFF_ROLE_LABELS[r]}
                </option>
              ))}
            </select>

            <button
              onClick={() => navigate('/admin-create')}
              className="px-4 py-2 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors flex items-center"
            >
              <UserPlus className="h-5 w-5 mr-2" />
              Créer rôle
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>Compte</th>
                <th className={th}>Email</th>
                <th className={th}>Rôle</th>
                <th className={th}>Statut</th>
                <th className={th}>Date de création</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAdmins.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                    {listError ? 'Chargement impossible' : 'Aucun compte trouvé'}
                  </td>
                </tr>
              )}
              {filteredAdmins.map((account) => (
                <tr key={account.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 bg-brand-primary rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-medium">{initials(account)}</span>
                      </div>
                      <div className="ml-4 text-sm font-medium text-gray-900">
                        {account.contact_name}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {account.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <AdminRoleBadge role={account.role} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <AdminStatusBadge isActive={account.is_active} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatAdminDate(account.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => setSelectedAdmin(account)}
                      className="text-brand-primary hover:text-brand-primary/90 mr-3"
                      title="Voir détails"
                    >
                      <Eye className="h-5 w-5" />
                    </button>
                    {account.is_active && canDeactivate(account, role) && (
                      <button
                        onClick={() => setAdminToDeactivate(account)}
                        className="text-red-600 hover:text-red-800"
                        title="Désactiver"
                      >
                        <XCircle className="h-5 w-5" />
                      </button>
                    )}
                    {!account.is_active && canReactivate(account, role) && (
                      <button
                        onClick={() => setAdminToReactivate(account)}
                        className="text-green-600 hover:text-green-800"
                        title="Réactiver"
                      >
                        <CheckCircle className="h-5 w-5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedAdmin && (
        <AdminAccountDetailsModal
          account={selectedAdmin}
          formatDate={formatAdminDate}
          onClose={() => setSelectedAdmin(null)}
        />
      )}
      {adminToDeactivate && (
        <AdminDeactivateModal
          account={adminToDeactivate}
          busy={deactivateAdmin.isPending}
          onCancel={() => setAdminToDeactivate(null)}
          onConfirm={confirmDeactivate}
        />
      )}
      {adminToReactivate && (
        <AdminReactivateModal
          account={adminToReactivate}
          busy={reactivateAdmin.isPending}
          onCancel={() => setAdminToReactivate(null)}
          onConfirm={confirmReactivate}
        />
      )}
    </AdminLayout>
  );
}
