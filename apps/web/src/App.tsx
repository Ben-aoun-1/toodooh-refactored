import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './stores/auth.store';
import { useAdminStore } from './stores/admin.store';
import './utils/clearAuthCache'; // Utilitaire de debug
import Dashboard from './pages/Dashboard';
import OwnerDashboard from './pages/OwnerDashboard';
import NewCampaign from './pages/NewCampaign';
import MyCampaigns from './pages/MyCampaigns';
import CampaignDetails from './pages/CampaignDetails';
import MyInvoices from './pages/MyInvoices';
import MyClients from './pages/MyClients';
import MyRecharges from './pages/MyRecharges';
import Login from './pages/auth/Login';
import SignUp from './pages/auth/SignUp';
import ResetPassword from './pages/auth/ResetPassword';
import UpdatePassword from './pages/auth/UpdatePassword';
import OwnerScreens from './pages/OwnerScreens';
import OwnerLocations from './pages/OwnerLocations';
import OwnerRevenue from './pages/OwnerRevenue';
import OwnerCampaigns from './pages/OwnerCampaigns';
import OwnerPerformance from './pages/OwnerPerformance';
import OwnerCalendarDevices from './pages/OwnerCalendarDevices';
import OwnerStatementsPage from './pages/OwnerStatementsPage';
import OwnerStatementDetailPage from './pages/OwnerStatementDetailPage';
import OwnerActivity from './pages/OwnerActivity';
import OwnerMaintenance from './pages/OwnerMaintenance';
import OwnerSettings from './pages/OwnerSettings';
import OwnerCampaignApprovals from './pages/OwnerCampaignApprovals';
import GiftCatalogPage from './pages/GiftCatalogPage';
import ContactPage from './pages/ContactPage';
import MyAccount from './pages/MyAccount';
import UserProfile from './pages/UserProfile';
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminDashboardSimple from './pages/admin/AdminDashboardSimple';
import UserManagement from './pages/admin/UserManagement';
import VideoManagement from './pages/admin/VideoManagement';
import EventManagement from './pages/admin/EventManagement';
import CampaignMonitoring from './pages/admin/CampaignMonitoring';
import CreateAdmin from './pages/admin/CreateAdmin';
import AdminManagement from './pages/admin/AdminManagement';
import ScreenManagement from './pages/admin/ScreenManagement';
import RechargeManagement from './pages/admin/RechargeManagement';
import GeographicZonesManagement from './pages/admin/GeographicZonesManagement';
import AdminGlobalConfiguration from './pages/admin/AdminGlobalConfiguration';
import AdminRoute from './components/admin/AdminRoute';

function AdvertiserRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized, profileType, needsApproval } = useAuthStore();
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
  const { user, initialized, profileType, needsApproval } = useAuthStore();
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
  const { user, initialized, profileType, needsApproval } = useAuthStore();
  
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
        <Routes>
          {/* Route racine */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          
          {/* Routes publiques */}
          <Route path="/login" element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          } />
          <Route path="/signup" element={
            <PublicRoute>
              <SignUp />
            </PublicRoute>
          } />
          <Route path="/reset-password" element={
            <PublicRoute>
              <ResetPassword />
            </PublicRoute>
          } />
          <Route path="/update-password" element={
            <PublicRoute>
              <UpdatePassword />
            </PublicRoute>
          } />

          {/* Routes protégées - Dashboard Annonceur */}
          <Route path="/dashboard" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/profile" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/new-campaign" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/my-campaigns" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/parcs" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/evenements" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/perfor" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/new-event-campaign" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/campaign-details/:id" element={
            <AdvertiserRoute>
              <CampaignDetails />
            </AdvertiserRoute>
          } />
          <Route path="/my-recharges" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/my-invoices" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/my-clients" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />
          <Route path="/my-cart" element={
            <AdvertiserRoute>
              <Dashboard />
            </AdvertiserRoute>
          } />

          {/* Routes protégées - Dashboard Propriétaire */}
          <Route path="/owner-dashboard" element={
            <OwnerRoute>
              <OwnerDashboard />
            </OwnerRoute>
          } />
          <Route path="/owner-screens" element={
            <OwnerRoute>
              <OwnerScreens />
            </OwnerRoute>
          } />
          <Route path="/owner-campaigns" element={
            <OwnerRoute>
              <OwnerCampaigns />
            </OwnerRoute>
          } />
          <Route path="/owner-locations" element={
            <OwnerRoute>
              <OwnerLocations />
            </OwnerRoute>
          } />
          <Route path="/owner-revenue" element={
            <OwnerRoute>
              <OwnerRevenue />
            </OwnerRoute>
          } />
          <Route path="/owner-performance" element={
            <OwnerRoute>
              <OwnerPerformance />
            </OwnerRoute>
          } />
          <Route path="/owner-calendar-devices" element={
            <OwnerRoute>
              <OwnerCalendarDevices />
            </OwnerRoute>
          } />
          <Route path="/owner-statements" element={
            <OwnerRoute>
              <OwnerStatementsPage />
            </OwnerRoute>
          } />
          <Route path="/owner-statements/:statementId" element={
            <OwnerRoute>
              <OwnerStatementDetailPage />
            </OwnerRoute>
          } />
          <Route path="/owner-activity" element={
            <OwnerRoute>
              <OwnerActivity />
            </OwnerRoute>
          } />
          <Route path="/owner-maintenance" element={
            <OwnerRoute>
              <OwnerMaintenance />
            </OwnerRoute>
          } />
          <Route path="/owner-campaign-approvals" element={
            <OwnerRoute>
              <OwnerCampaignApprovals />
            </OwnerRoute>
          } />
          <Route path="/owner-settings" element={
            <OwnerRoute>
              <OwnerSettings />
            </OwnerRoute>
          } />
          <Route path="/gift-catalog" element={
            <OwnerRoute>
              <GiftCatalogPage />
            </OwnerRoute>
          } />
          <Route path="/my-account" element={
            <OwnerRoute>
              <MyAccount />
            </OwnerRoute>
          } />
          <Route path="/contact" element={
            <OwnerRoute>
              <ContactPage />
            </OwnerRoute>
          } />

          {/* Routes Admin */}
          <Route path="/admin-login" element={<AdminLogin />} />
          <Route path="/admin-dashboard" element={
            <AdminRoute>
              <AdminDashboard />
            </AdminRoute>
          } />
          <Route path="/admin-users" element={
            <AdminRoute>
              <UserManagement />
            </AdminRoute>
          } />
          <Route path="/admin-videos" element={
            <AdminRoute>
              <VideoManagement />
            </AdminRoute>
          } />
          <Route path="/admin-events" element={
            <AdminRoute requiredRoles={['superadmin']}>
              <EventManagement />
            </AdminRoute>
          } />
          <Route path="/admin-campaigns" element={
            <AdminRoute requiredRoles={['superadmin', 'admin']}>
              <CampaignMonitoring />
            </AdminRoute>
          } />
          <Route path="/admin-create" element={
            <AdminRoute requiredRoles={['superadmin']}>
              <CreateAdmin />
            </AdminRoute>
          } />
          <Route path="/admin-management" element={
            <AdminRoute requiredRoles={['superadmin']}>
              <AdminManagement />
            </AdminRoute>
          } />
          <Route path="/admin-screens" element={
            <AdminRoute requiredRoles={['superadmin', 'admin']}>
              <ScreenManagement />
            </AdminRoute>
          } />
          <Route path="/admin-recharges" element={
            <AdminRoute requiredRoles={['superadmin', 'admin']}>
              <RechargeManagement />
            </AdminRoute>
          } />
          <Route path="/admin-zones" element={
            <AdminRoute requiredRoles={['superadmin', 'admin']}>
              <GeographicZonesManagement />
            </AdminRoute>
          } />
          <Route path="/admin-global-config" element={
            <AdminRoute requiredRoles={['superadmin', 'admin']}>
              <AdminGlobalConfiguration />
            </AdminRoute>
          } />

          {/* Redirection par défaut */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
      <Toaster position="top-right" />
    </>
  );
}