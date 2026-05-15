import React, { lazy, Suspense, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import AdminRoute from './components/admin/AdminRoute';
import PageLoadingFallback from './components/PageLoadingFallback';
import { useAuthStore } from './features/auth/stores/auth.store';

// Toutes les pages sont chargées à la demande (code-splitting par route).
const AdvertiserLayout = lazy(() => import('./components/layout/AdvertiserLayout'));
const AdvertiserDashboard = lazy(() => import('./pages/AdvertiserDashboard'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const NewCampaign = lazy(() => import('./pages/NewCampaign'));
const MyCampaigns = lazy(() => import('./pages/MyCampaigns'));
const Events = lazy(() => import('./features/events/pages/Events'));
const MyRecharges = lazy(() => import('./pages/MyRecharges'));
const MyInvoices = lazy(() => import('./pages/MyInvoices'));
const MyClients = lazy(() => import('./pages/MyClients'));
const AdvertiserPerformancePlaceholder = lazy(
  () => import('./pages/AdvertiserPerformancePlaceholder'),
);
const CartPage = lazy(() => import('./pages/CartPage'));
const OwnerDashboard = lazy(() => import('./pages/OwnerDashboard'));
const CampaignDetails = lazy(() => import('./pages/CampaignDetails'));
const Login = lazy(() => import('./features/auth/pages/Login'));
const SignUp = lazy(() => import('./features/auth/pages/SignUp'));
const ResetPassword = lazy(() => import('./features/auth/pages/ResetPassword'));
const UpdatePassword = lazy(() => import('./features/auth/pages/UpdatePassword'));
const OwnerScreens = lazy(() => import('./pages/OwnerScreens'));
const OwnerLocations = lazy(() => import('./pages/OwnerLocations'));
const OwnerRevenue = lazy(() => import('./pages/OwnerRevenue'));
const OwnerCampaigns = lazy(() => import('./pages/OwnerCampaigns'));
const OwnerPerformance = lazy(() => import('./pages/OwnerPerformance'));
const OwnerCalendarDevices = lazy(() => import('./pages/OwnerCalendarDevices'));
const OwnerStatementsPage = lazy(() => import('./pages/OwnerStatementsPage'));
const OwnerStatementDetailPage = lazy(() => import('./pages/OwnerStatementDetailPage'));
const OwnerActivity = lazy(() => import('./pages/OwnerActivity'));
const OwnerMaintenance = lazy(() => import('./pages/OwnerMaintenance'));
const OwnerSettings = lazy(() => import('./pages/OwnerSettings'));
const OwnerCampaignApprovals = lazy(() => import('./pages/OwnerCampaignApprovals'));
const GiftCatalogPage = lazy(() => import('./pages/GiftCatalogPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const MyAccount = lazy(() => import('./pages/MyAccount'));
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const VideoManagement = lazy(() => import('./pages/admin/VideoManagement'));
const EventManagement = lazy(() => import('./pages/admin/EventManagement'));
const CampaignMonitoring = lazy(() => import('./pages/admin/CampaignMonitoring'));
const CreateAdmin = lazy(() => import('./pages/admin/CreateAdmin'));
const AdminManagement = lazy(() => import('./pages/admin/AdminManagement'));
const ScreenManagement = lazy(() => import('./pages/admin/ScreenManagement'));
const RechargeManagement = lazy(() => import('./pages/admin/RechargeManagement'));
const GeographicZonesManagement = lazy(() => import('./pages/admin/GeographicZonesManagement'));
const AdminGlobalConfiguration = lazy(() => import('./pages/admin/AdminGlobalConfiguration'));

function AdvertiserRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized, profileType } = useAuthStore();
  if (!initialized) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" />;
  }

  // Les utilisateurs en attente peuvent accéder au dashboard
  // mais les fonctionnalités seront grisées/désactivées via isDisabled

  // Utiliser le profileType du store au lieu de localStorage
  if (profileType === 'individual_owner' || profileType === 'fleet_owner') {
    return <Navigate to="/owner-dashboard" />;
  }
  // Seul l'annonceur peut accéder
  return <>{children}</>;
}

function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized, profileType } = useAuthStore();
  if (!initialized) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" />;
  }

  // Les utilisateurs en attente peuvent accéder au dashboard
  // mais les fonctionnalités seront grisées/désactivées via isDisabled

  // Utiliser le profileType du store au lieu de localStorage
  if (profileType !== 'individual_owner' && profileType !== 'fleet_owner') {
    return <Navigate to="/dashboard" />;
  }
  // Seul le propriétaire peut accéder
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized, profileType } = useAuthStore();

  if (!initialized) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  // Si un utilisateur est connecté, le rediriger vers son dashboard
  // même s'il est en attente de validation (les fonctionnalités seront grisées)
  if (user) {
    if (profileType === 'individual_owner' || profileType === 'fleet_owner') {
      return <Navigate to="/owner-dashboard" />;
    }
    return <Navigate to="/dashboard" />;
  }

  return <>{children}</>;
}

export default function App() {
  const { initialize, initialized, loading } = useAuthStore();

  useEffect(() => {
    if (!initialized && !loading) {
      initialize();
    }
  }, [initialize, initialized, loading]);
  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }
  return (
    <>
      <Router>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            {/* Route racine */}
            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* Routes publiques */}
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <Login />
                </PublicRoute>
              }
            />
            <Route
              path="/signup"
              element={
                <PublicRoute>
                  <SignUp />
                </PublicRoute>
              }
            />
            <Route
              path="/reset-password"
              element={
                <PublicRoute>
                  <ResetPassword />
                </PublicRoute>
              }
            />
            <Route
              path="/update-password"
              element={
                <PublicRoute>
                  <UpdatePassword />
                </PublicRoute>
              }
            />

            {/* Routes protégées - Dashboard Annonceur */}
            <Route
              path="/dashboard"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <AdvertiserDashboard />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <UserProfile />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/new-campaign"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <NewCampaign />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/my-campaigns"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <MyCampaigns />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/evenements"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <Events />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/new-event-campaign"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <NewCampaign />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/campaign-details/:id"
              element={
                <AdvertiserRoute>
                  <CampaignDetails />
                </AdvertiserRoute>
              }
            />
            <Route
              path="/my-recharges"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <MyRecharges />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/my-invoices"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <MyInvoices />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/my-clients"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <MyClients />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/perfor"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <AdvertiserPerformancePlaceholder />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/my-cart"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <CartPage />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />

            {/* Routes protégées - Dashboard Propriétaire */}
            <Route
              path="/owner-dashboard"
              element={
                <OwnerRoute>
                  <OwnerDashboard />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-screens"
              element={
                <OwnerRoute>
                  <OwnerScreens />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-campaigns"
              element={
                <OwnerRoute>
                  <OwnerCampaigns />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-locations"
              element={
                <OwnerRoute>
                  <OwnerLocations />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-revenue"
              element={
                <OwnerRoute>
                  <OwnerRevenue />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-performance"
              element={
                <OwnerRoute>
                  <OwnerPerformance />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-calendar-devices"
              element={
                <OwnerRoute>
                  <OwnerCalendarDevices />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-statements"
              element={
                <OwnerRoute>
                  <OwnerStatementsPage />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-statements/:statementId"
              element={
                <OwnerRoute>
                  <OwnerStatementDetailPage />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-activity"
              element={
                <OwnerRoute>
                  <OwnerActivity />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-maintenance"
              element={
                <OwnerRoute>
                  <OwnerMaintenance />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-campaign-approvals"
              element={
                <OwnerRoute>
                  <OwnerCampaignApprovals />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-settings"
              element={
                <OwnerRoute>
                  <OwnerSettings />
                </OwnerRoute>
              }
            />
            <Route
              path="/gift-catalog"
              element={
                <OwnerRoute>
                  <GiftCatalogPage />
                </OwnerRoute>
              }
            />
            <Route
              path="/my-account"
              element={
                <OwnerRoute>
                  <MyAccount />
                </OwnerRoute>
              }
            />
            <Route
              path="/contact"
              element={
                <OwnerRoute>
                  <ContactPage />
                </OwnerRoute>
              }
            />

            {/* Routes Admin */}
            <Route path="/admin-login" element={<AdminLogin />} />
            <Route
              path="/admin-dashboard"
              element={
                <AdminRoute>
                  <AdminDashboard />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-users"
              element={
                <AdminRoute>
                  <UserManagement />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-videos"
              element={
                <AdminRoute>
                  <VideoManagement />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-events"
              element={
                <AdminRoute requiredRoles={['superadmin']}>
                  <EventManagement />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-campaigns"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <CampaignMonitoring />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-create"
              element={
                <AdminRoute requiredRoles={['superadmin']}>
                  <CreateAdmin />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-management"
              element={
                <AdminRoute requiredRoles={['superadmin']}>
                  <AdminManagement />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-screens"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <ScreenManagement />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-recharges"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <RechargeManagement />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-zones"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <GeographicZonesManagement />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-global-config"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <AdminGlobalConfiguration />
                </AdminRoute>
              }
            />

            {/* Redirection par défaut */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </Router>
      <Toaster position="top-right" />
    </>
  );
}
