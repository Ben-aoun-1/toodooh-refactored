import React from 'react';
import { Navigate } from 'react-router-dom';

import { isAgentRole } from '@/features/agent/utils/agent-roles';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// Slice-2 E / P2 — role gate for the agent workspace. Mirrors AdminRoute: it only READS the one
// auth store (App's initialize() rehydrates the session). Both agent roles (screenhost_agent,
// screencast_agent — P2 referred-clients dashboard) may enter; a logged-out user goes to /login,
// and any other authenticated role is sent to /dashboard (the advertiser/owner guards re-route
// owners from there), so a non-agent never sees the agent surface.
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
  if (!isAgentRole(role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
