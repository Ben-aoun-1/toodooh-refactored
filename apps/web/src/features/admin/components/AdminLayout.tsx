import {
  LayoutDashboard,
  Users,
  Shield,
  UserPlus,
  LogOut,
  Menu,
  X,
  Bell,
  Search,
  Film,
  Calendar,
  Megaphone,
  Monitor,
  Banknote,
  MapPin,
  Coins,
  FileText,
  FlaskConical,
} from 'lucide-react';
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { usePlatformStats } from '@/features/admin/hooks/usePlatformStats';
import {
  pendingBadgeLabel,
  pendingBadgeTitle,
  showPendingBadge,
} from '@/features/admin/lib/pending-queue';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'AdminLayout' });

interface AdminLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export default function AdminLayout({ children, title, subtitle }: AdminLayoutProps) {
  // SIGN-4 — one admin-guarded aggregate the dashboard already reads; React Query dedupes it
  // across pages, so the badge costs no new endpoint and no extra round trip on the dashboard.
  const platformStats = usePlatformStats();
  const pendingQueue = {
    total: platformStats.data?.users.pending ?? 0,
    owners: platformStats.data?.users.pending_owners ?? 0,
  };
  // Phase-1g (D3): identity + role derived from the one auth store.
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const contactName = useAuthStore((s) => s.contactName);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/admin-login');
    } catch (error) {
      log.error({ error }, 'Logout error');
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-poppins text-[#171717]">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo et titre */}
            <div className="flex items-center">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              >
                <Menu className="h-6 w-6" />
              </button>
              <div className="ml-4 lg:ml-0">
                <h1 className="text-xl font-semibold text-[#171717]">{title}</h1>
                {subtitle && <p className="text-sm font-normal text-[#5C5C5C]">{subtitle}</p>}
              </div>
            </div>

            {/* Actions header */}
            <div className="flex items-center space-x-4">
              <button className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg">
                <Search className="h-5 w-5" />
              </button>
              <button className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg">
                <Bell className="h-5 w-5" />
              </button>

              {/* Profil admin */}
              <div className="flex items-center space-x-3">
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{contactName}</p>
                  <p className="text-xs text-gray-500 capitalize">{role}</p>
                </div>
                <div className="h-8 w-8 bg-brand-primary rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{contactName?.charAt(0)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <div
          className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex flex-col h-full">
            {/* Logo sidebar */}
            <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
              <div className="flex items-center">
                <Shield className="h-8 w-8 text-brand-primary" />
                <span className="ml-2 text-lg font-semibold text-gray-900">
                  Panneau d'administration
                </span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Navigation */}
            <nav className="mt-8 px-4 space-y-2 flex-1">
              <button
                onClick={() => navigate('/admin-dashboard')}
                className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                  location.pathname === '/admin-dashboard'
                    ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                }`}
              >
                <LayoutDashboard className="mr-3 h-5 w-5" />
                Dashboard
              </button>

              <button
                onClick={() => navigate('/admin-users')}
                className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                  location.pathname === '/admin-users'
                    ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                }`}
              >
                <Users className="mr-3 h-5 w-5" />
                <span className="flex-1 text-left">Utilisateurs</span>
                {/* SIGN-4 — the pending-validation queue, so an admin learns a Host is waiting
                    without opening the page. Rules (visibility, cap, wording) live in
                    lib/pending-queue: this repo has no render harness, so a rule kept in a
                    component is unpinnable. */}
                {showPendingBadge(pendingQueue) && (
                  <span
                    title={pendingBadgeTitle(pendingQueue)}
                    aria-label={pendingBadgeTitle(pendingQueue)}
                    className="ml-2 inline-flex min-w-[22px] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
                  >
                    {pendingBadgeLabel(pendingQueue)}
                  </span>
                )}
              </button>

              <button
                onClick={() => navigate('/admin-creatives')}
                className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                  location.pathname === '/admin-creatives'
                    ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                }`}
              >
                <Film className="mr-3 h-5 w-5" />
                Créatives
              </button>

              {/* Campagnes - Accessible aux Super Admin et Admin */}
              {(role === 'superadmin' || role === 'admin') && (
                <>
                  <button
                    onClick={() => navigate('/admin-campaigns')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-campaigns'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <Megaphone className="mr-3 h-5 w-5" />
                    Campagnes
                  </button>
                  <button
                    onClick={() => navigate('/admin-zones')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-zones'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <MapPin className="mr-3 h-5 w-5" />
                    Zones géographiques
                  </button>
                  <button
                    onClick={() => navigate('/admin-screens')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-screens'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <Monitor className="mr-3 h-5 w-5" />
                    Localités et écrans
                  </button>
                  <button
                    onClick={() => navigate('/admin-recharges')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-recharges'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <Banknote className="mr-3 h-5 w-5" />
                    Recharges
                  </button>
                  <button
                    onClick={() => navigate('/admin-screenhost-factures')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-screenhost-factures'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <FileText className="mr-3 h-5 w-5" />
                    Factures Screenhost
                  </button>
                </>
              )}

              {/* EV6 RIDER — Événements opens to admin + screenhost_agent too (the attestation
                  panel lives there); Gestion Admins stays superadmin-only below. */}
              {(role === 'superadmin' || role === 'admin' || role === 'screenhost_agent') && (
                <button
                  onClick={() => navigate('/admin-events')}
                  className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                    location.pathname === '/admin-events'
                      ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                  }`}
                >
                  <Calendar className="mr-3 h-5 w-5" />
                  Événements
                </button>
              )}

              {role === 'superadmin' && (
                <>
                  <button
                    onClick={() => navigate('/admin-management')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-management'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <Shield className="mr-3 h-5 w-5" />
                    Administrateurs
                  </button>

                  <button
                    onClick={() => navigate('/admin-create')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-create'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <UserPlus className="mr-3 h-5 w-5" />
                    Créer Admin
                  </button>
                </>
              )}

              {/* Masqué : Statistiques */}
              {/* <button className="group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 text-gray-700 hover:bg-gray-100 hover:text-brand-primary">
                <BarChart3 className="mr-3 h-5 w-5" />
                Statistiques
              </button> */}

              {/* Masqué : Rapports */}
              {/* <button className="group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 text-gray-700 hover:bg-gray-100 hover:text-brand-primary">
                <FileText className="mr-3 h-5 w-5" />
                Rapports
              </button> */}

              {(role === 'superadmin' || role === 'admin') && (
                <>
                  <button
                    onClick={() => navigate('/admin-dispatch-config')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-dispatch-config'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <Coins className="mr-3 h-5 w-5" />
                    Tarification (CPM)
                  </button>
                  <button
                    onClick={() => navigate('/admin-testing')}
                    className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                      location.pathname === '/admin-testing'
                        ? 'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-brand-primary'
                    }`}
                  >
                    <FlaskConical className="mr-3 h-5 w-5" />
                    Tests
                  </button>
                </>
              )}
            </nav>

            {/* Profil en bas */}
            <div className="p-4 border-t border-gray-200">
              <div className="flex items-center space-x-3 p-3 rounded-lg bg-gray-50">
                <div className="h-10 w-10 bg-brand-primary rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{contactName?.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{contactName}</p>
                  <p className="text-xs text-gray-500 truncate capitalize">{role}</p>
                </div>
                <button
                  onClick={() => setShowLogoutModal(true)}
                  className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Déconnexion"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Contenu principal */}
        <div className="flex-1 lg:ml-0">
          <main className="px-4 sm:px-6 lg:px-8 py-6 text-[15px] leading-6">
            <div className="max-w-[1600px] mx-auto">{children}</div>
          </main>
        </div>
      </div>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-600 bg-opacity-75 lg:hidden"
          role="button"
          tabIndex={0}
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              setSidebarOpen(false);
            }
          }}
        />
      )}

      {/* Modal de déconnexion */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <LogOut className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Déconnexion</h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Êtes-vous sûr de vouloir vous déconnecter ?
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  onClick={handleLogout}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Déconnexion
                </button>
                <button
                  onClick={() => setShowLogoutModal(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
