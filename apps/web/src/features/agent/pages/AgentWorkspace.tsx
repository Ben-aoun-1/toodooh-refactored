import AgentLayout from '@/features/agent/components/AgentLayout';
import { AgentAppointmentsBlock } from '@/features/agent/components/dashboard/AgentAppointmentsBlock';
import { AgentDashboard } from '@/features/agent/components/dashboard/AgentDashboard';
import { AgentNotificationsBlock } from '@/features/agent/components/dashboard/AgentNotificationsBlock';
import { OnboardingCard } from '@/features/agent/components/OnboardingCard';
import { agentKindOf } from '@/features/agent/lib/agent-shell';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// AGT-4 / AGT-7 — the agent Dashboard: the « Finalisez votre compte » card above the blocks while
// the onboarding is open (spec §4), then the ten blocks of the agent's type.
export default function AgentWorkspace() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentLayout page="dashboard">
      <OnboardingCard />
      <AgentDashboard
        kind={agentKindOf(role) ?? 'screencaster'}
        appointments={<AgentAppointmentsBlock />}
        notifications={<AgentNotificationsBlock />}
      />
    </AgentLayout>
  );
}
