import { QueryClientProvider } from '@tanstack/react-query';
import React, { lazy, Suspense, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import PageLoadingFallback from '@/components/PageLoadingFallback';
import AdminRoute from '@/features/admin/components/AdminRoute';
import AgentRoute from '@/features/agent/components/AgentRoute';
import { isAgentRole } from '@/features/agent/utils/agent-roles';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { resolveHomeRoute } from '@/features/auth/utils/home-route';
import { createQueryClient } from '@/lib/query-client';

// Toutes les pages sont chargées à la demande (code-splitting par route).
const AdvertiserLayout = lazy(() => import('@/features/advertiser/components/AdvertiserLayout'));
const AdvertiserDashboard = lazy(() => import('@/features/advertiser/pages/AdvertiserDashboard'));
const UserProfile = lazy(() => import('@/features/advertiser/pages/UserProfile'));
const NewCampaign = lazy(() => import('@/features/campaigns/pages/NewCampaign'));
const MyCampaigns = lazy(() => import('@/features/campaigns/pages/MyCampaigns'));
const Events = lazy(() => import('@/features/events/pages/Events'));
const EventPositioning = lazy(() => import('@/features/events/pages/EventPositioning'));
const MyRecharges = lazy(() => import('@/features/wallet/pages/MyRecharges'));
const MyInvoices = lazy(() => import('@/features/wallet/pages/MyInvoices'));
const MyCart = lazy(() => import('@/features/cart/pages/MyCart'));
const AdvertiserPerformancePlaceholder = lazy(
  () => import('@/features/performances/pages/AdvertiserPerformancePlaceholder'),
);
const OwnerDashboard = lazy(() => import('@/features/screenhost/pages/OwnerDashboard'));
const Login = lazy(() => import('@/features/auth/pages/Login'));
const SignUp = lazy(() => import('@/features/auth/pages/SignUp'));
const SignUpSuccess = lazy(() => import('@/features/auth/pages/SignUpSuccess'));
const AppTvDownload = lazy(() => import('@/features/apptv/pages/AppTvDownload'));
const ResetPassword = lazy(() => import('@/features/auth/pages/ResetPassword'));
const UpdatePassword = lazy(() => import('@/features/auth/pages/UpdatePassword'));
const VerifyEmail = lazy(() => import('@/features/auth/pages/VerifyEmail'));
const AccountRejected = lazy(() => import('@/features/auth/pages/AccountRejected'));
const CorrectDocuments = lazy(() => import('@/features/auth/pages/CorrectDocuments'));
const OwnerScreens = lazy(() => import('@/features/screenhost/pages/OwnerScreens'));
const OwnerRevenue = lazy(() => import('@/features/screenhost/pages/OwnerRevenue'));
const OwnerCampaigns = lazy(() => import('@/features/screenhost/pages/OwnerCampaigns'));
const OwnerAllocations = lazy(() => import('@/features/screenhost/pages/OwnerAllocations'));
const OwnerCampaignCalendar = lazy(
  () => import('@/features/screenhost/pages/OwnerCampaignCalendar'),
);
const OwnerPerformance = lazy(() => import('@/features/screenhost/pages/OwnerPerformance'));
const OwnerCalendarDevices = lazy(() => import('@/features/screenhost/pages/OwnerCalendarDevices'));
const OwnerFacturesPage = lazy(() => import('@/features/screenhost/pages/OwnerFacturesPage'));
const OwnerFactureDetailPage = lazy(
  () => import('@/features/screenhost/pages/OwnerFactureDetailPage'),
);
const OwnerSettings = lazy(() => import('@/features/screenhost/pages/OwnerSettings'));
const ContactPage = lazy(() => import('@/features/screenhost/pages/ContactPage'));
const AgentWorkspace = lazy(() => import('@/features/agent/pages/AgentWorkspace'));
const AdminLogin = lazy(() => import('@/features/admin/pages/AdminLogin'));
const AdminDashboard = lazy(() => import('@/features/admin/pages/AdminDashboard'));
const UserManagement = lazy(() => import('@/features/admin/pages/UserManagement'));
const CreativeManagement = lazy(() => import('@/features/admin/pages/CreativeManagement'));
const EventManagement = lazy(() => import('@/features/admin/pages/EventManagement'));
const CampaignReviewQueue = lazy(() => import('@/features/admin/pages/CampaignReviewQueue'));
const CreateAdmin = lazy(() => import('@/features/admin/pages/CreateAdmin'));
const AdminManagement = lazy(() => import('@/features/admin/pages/AdminManagement'));
const ScreenManagement = lazy(() => import('@/features/admin/pages/ScreenManagement'));
const ScreenhostFactureManagement = lazy(
  () => import('@/features/admin/pages/ScreenhostFactureManagement'),
);
const RechargeManagement = lazy(() => import('@/features/admin/pages/RechargeManagement'));
const GeographicZonesManagement = lazy(
  () => import('@/features/admin/pages/GeographicZonesManagement'),
);
const AdminGlobalConfiguration = lazy(
  () => import('@/features/admin/pages/AdminGlobalConfiguration'),
);
const DispatchConfigManagement = lazy(
  () => import('@/features/admin/pages/DispatchConfigManagement'),
);

// Client React Query unique pour toute l'application (config : voir D-Q).
const queryClient = createQueryClient();

// React Query Devtools — dev uniquement. Import dynamique sous une branche
// `import.meta.env.DEV` (décision D-V) : le paquet devtools n'est jamais tiré
// dans le bundle de production.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

function AdvertiserRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized, profileType, role, validationStatus } = useAuthStore();
  if (!initialized) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" />;
  }

  // N3 — a rejected account is gated out of the app (defense for a direct nav to a protected route).
  if (validationStatus === 'rejected') {
    return <Navigate to="/account-rejected" replace />;
  }

  // Les utilisateurs en attente peuvent accéder au dashboard
  // mais les fonctionnalités seront grisées/désactivées via isDisabled

  // Slice-2 E / P2 — an agent (profile_type null) must not sit on the advertiser dashboard.
  if (isAgentRole(role)) {
    return <Navigate to="/agent" />;
  }
  // Utiliser le profileType du store au lieu de localStorage
  if (profileType === 'individual_owner' || profileType === 'fleet_owner') {
    return <Navigate to="/owner-dashboard" />;
  }
  // Seul l'annonceur peut accéder
  return <>{children}</>;
}

function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized, profileType, validationStatus } = useAuthStore();
  if (!initialized) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" />;
  }

  // N3 — a rejected account is gated out of the app (defense for a direct nav to a protected route).
  if (validationStatus === 'rejected') {
    return <Navigate to="/account-rejected" replace />;
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
  const { user, initialized, profileType, role, validationStatus } = useAuthStore();

  if (!initialized) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  // Si un utilisateur est connecté, le rediriger vers son espace (agent/owner/advertiser) via le
  // résolveur unique — même s'il est en attente de validation (les fonctionnalités seront grisées),
  // ou vers l'écran de statut si le compte a été rejeté (resolveHomeRoute décide).
  if (user) {
    return <Navigate to={resolveHomeRoute(profileType, role, validationStatus)} />;
  }

  return <>{children}</>;
}

// N3 — the /account-rejected status screen is reachable only by a signed-in REJECTED account. Anyone
// else is bounced: signed-out → /login; pending/approved → their normal landing (so the screen can't
// be sat on once an account is later approved). Mirrors the rejected redirect in the app guards.
function RejectedRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized, profileType, role, validationStatus } = useAuthStore();
  if (!initialized) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" />;
  }
  if (validationStatus !== 'rejected') {
    return <Navigate to={resolveHomeRoute(profileType, role, validationStatus)} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { initialize, initialized, loading, rehydrateError } = useAuthStore();

  useEffect(() => {
    if (!initialized && !loading) {
      initialize();
    }
  }, [initialize, initialized, loading]);

  // D3 — rehydration hit a transient error (network/5xx, not a 401). Identity fails closed (no
  // false-authed app) but we offer a retry instead of a silent logout to /login.
  if (rehydrateError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-sm px-6">
          <p className="text-gray-800 font-medium mb-2">Connexion au serveur impossible</p>
          <p className="text-gray-600 text-sm mb-4">
            Veuillez vérifier votre connexion internet, puis réessayer.
          </p>
          <button
            type="button"
            onClick={() => void initialize()}
            className="px-5 py-2.5 rounded-xl font-semibold text-sm text-white bg-brand-primary hover:opacity-90 transition-opacity"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
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
            {/* Post-signup validation screen (slice-1 auth-bug-1). Standalone — reached right after
                signup with the email in router state; the just-registered user is logged out. */}
            <Route path="/signup-success" element={<SignUpSuccess />} />
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
            {/* Verify-email result (Phase-1f F3): the better-auth callbackURL target. Standalone —
                the just-verified user is logged out and must always see the result. */}
            <Route path="/verify-email" element={<VerifyEmail />} />

            {/* APPTV-1 — the PUBLIC TV-app download page. Standalone on purpose (the
                /verify-email idiom): no guard, no PublicRoute (which bounces authed users) —
                reachable logged-out AND logged-in; a TV browser may open it on the television. */}
            <Route path="/apptv" element={<AppTvDownload />} />

            {/* N3 — account-status screen for a rejected end-user (gated to a signed-in rejected account). */}
            <Route
              path="/account-rejected"
              element={
                <RejectedRoute>
                  <AccountRejected />
                </RejectedRoute>
              }
            />
            {/* N3 Scenario 1 — the rejected account's document-correction surface (reuses the existing
                managers; same RejectedRoute gate as the status screen). */}
            <Route
              path="/account-rejected/documents"
              element={
                <RejectedRoute>
                  <CorrectDocuments />
                </RejectedRoute>
              }
            />

            {/* Slice-2 E / P2 — agent referred-clients workspace (role-gated, both agent roles) */}
            <Route
              path="/agent"
              element={
                <AgentRoute>
                  <AgentWorkspace />
                </AgentRoute>
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
              path="/evenements/positionnement/:campaignId"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <EventPositioning />
                  </AdvertiserLayout>
                </AdvertiserRoute>
              }
            />
            <Route
              path="/my-cart"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <MyCart />
                  </AdvertiserLayout>
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
              path="/perfor"
              element={
                <AdvertiserRoute>
                  <AdvertiserLayout>
                    <AdvertiserPerformancePlaceholder />
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
              path="/owner-allocations"
              element={
                <OwnerRoute>
                  <OwnerAllocations />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-campaign-calendar"
              element={
                <OwnerRoute>
                  <OwnerCampaignCalendar />
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
              path="/owner-factures"
              element={
                <OwnerRoute>
                  <OwnerFacturesPage />
                </OwnerRoute>
              }
            />
            <Route
              path="/owner-factures/:id"
              element={
                <OwnerRoute>
                  <OwnerFactureDetailPage />
                </OwnerRoute>
              }
            />
            {/* REV2 — the pre-rename URL. Bookmarks and any already-sent link keep working; the
                bell's own legacy mapping routes through actionFor, not through here. */}
            <Route path="/owner-statements" element={<Navigate to="/owner-factures" replace />} />
            <Route
              path="/owner-settings"
              element={
                <OwnerRoute>
                  <OwnerSettings />
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
              path="/admin-creatives"
              element={
                <AdminRoute>
                  <CreativeManagement />
                </AdminRoute>
              }
            />
            <Route
              // EV6 RIDER — matches EV5's API guard: an inspecting screenhost_agent must be
              // able to reach the attestation panel, and the catalogue itself is harmless.
              path="/admin-events"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin', 'screenhost_agent']}>
                  <EventManagement />
                </AdminRoute>
              }
            />
            <Route
              path="/admin-campaigns"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <CampaignReviewQueue />
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
              path="/admin-screenhost-factures"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <ScreenhostFactureManagement />
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
            <Route
              path="/admin-dispatch-config"
              element={
                <AdminRoute requiredRoles={['superadmin', 'admin']}>
                  <DispatchConfigManagement />
                </AdminRoute>
              }
            />

            {/* Redirection par défaut */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </Router>
      <Toaster position="top-right" />
      {ReactQueryDevtools ? (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
