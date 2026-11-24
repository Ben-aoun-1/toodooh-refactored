import { agentKindOf } from '@/features/agent/lib/agent-shell';
import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfDashboard } from '@/features/agent/vf/VfDashboard';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// AGENT-VF — the agent Dashboard, in Mariem's final design: « Finalisez votre compte » above the
// blocks while the onboarding is open, then the blocks of the agent's type.
export default function AgentWorkspace() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentVfLayout page="dashboard">
      <VfDashboard kind={agentKindOf(role) ?? 'screencaster'} />
    </AgentVfLayout>
  );
}
