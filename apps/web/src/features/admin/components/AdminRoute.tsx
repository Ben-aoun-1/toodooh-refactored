import React from 'react';
import { Navigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';

interface AdminRouteProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

// Phase-1g (D3): admin is a user with role∈{admin,superadmin} on the one auth store. The session
// is rehydrated by auth.store.initialize() in App.tsx; this guard only reads it (no own init).
export default function AdminRoute({ children, requiredRoles = [] }: AdminRouteProps) {
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);

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

  const isAdmin = role === 'admin' || role === 'superadmin';
  // EV6 RIDER — a route that NAMES a non-admin role admits it (the Événements page lists
  // screenhost_agent so an inspecting agent reaches the attestation panel, matching EV5's API
  // guard). Every other route keeps the admin-only default, and the requiredRoles check below is
  // unchanged — an admin on a superadmin-only route still lands on the admin dashboard.
  const explicitlyAllowed = requiredRoles.includes(role ?? '');
  if (!user || (!isAdmin && !explicitlyAllowed)) {
    return <Navigate to="/admin-login" />;
  }

  if (requiredRoles.length > 0 && !requiredRoles.includes(role ?? '')) {
    return <Navigate to="/admin-dashboard" />;
  }

  return <>{children}</>;
}
