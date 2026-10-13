import React from 'react';
import { Navigate } from 'react-router-dom';

import { AgentCgeModal } from '@/features/agent/components/AgentCgeModal';
import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import { isAgentRole } from '@/features/agent/utils/agent-roles';
import { useAuthStore } from '@/features/auth/stores/auth.store';

const Spinner = () => (
  <div className="min-h-screen bg-white flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
      <p className="text-gray-600">Chargement...</p>
    </div>
  </div>
);

/** AGT-1b — the CGE gate: nothing of the agent space renders before the CGE in force is accepted. */
function CgeGate({ children }: { children: React.ReactNode }) {
  const account = useAgentAccount();
  if (account.isLoading) return <Spinner />;
  const a = account.data;
  if (a?.cge_required && a.cge) return <AgentCgeModal cgeId={a.cge.id} version={a.cge.version} />;
  return <>{children}</>;
}

// Slice-2 E / P2 — role gate for the agent workspace. Mirrors AdminRoute: it only READS the one
// auth store (App's initialize() rehydrates the session). Both agent roles may enter; a logged-out
// user goes to /login, and any other authenticated role is sent to /dashboard. AGT-1b — then the
// CGE gate.
export default function AgentRoute({ children }: { children: React.ReactNode }) {
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);

  if (!initialized) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAgentRole(role)) return <Navigate to="/dashboard" replace />;
  return <CgeGate>{children}</CgeGate>;
}
