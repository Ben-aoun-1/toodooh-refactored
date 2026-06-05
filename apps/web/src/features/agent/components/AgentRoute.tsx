import React from 'react';
import { Navigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';

// Slice-2 E — role gate for the screenhost-agent workspace. Mirrors AdminRoute: it only READS the one
// auth store (App's initialize() rehydrates the session). Only `screenhost_agent` may enter; a
// logged-out user goes to /login, and any other authenticated role is sent to /dashboard (the
// advertiser/owner guards re-route owners from there), so a non-agent never sees the agent surface.
// screencast_agent has no product surface yet (deferred) → treated as a non-agent here.
export default function AgentRoute({ children }: { children: React.ReactNode }) {
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
  if (!user) return <Navigate to="/login" replace />;
  if (role !== 'screenhost_agent') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
