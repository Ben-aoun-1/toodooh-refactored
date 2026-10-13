import AgentLayout from '@/features/agent/components/AgentLayout';
import { AgentAppointmentsBlock } from '@/features/agent/components/dashboard/AgentAppointmentsBlock';
import { AgentNotificationsBlock } from '@/features/agent/components/dashboard/AgentNotificationsBlock';
import { ScAgentDashboard } from '@/features/agent/components/dashboard/ScAgentDashboard';
import { ShAgentDashboard } from '@/features/agent/components/dashboard/ShAgentDashboard';
import { OnboardingCard } from '@/features/agent/components/OnboardingCard';
import { agentKindOf } from '@/features/agent/lib/agent-shell';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// AGT-4 — the agent Dashboard: the « Finalisez votre compte » card above the blocks while the
// onboarding is open (spec §4), then the Screencaster agent's ten blocks or the Screenhost
// agent's dashboard.
export default function AgentWorkspace() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentLayout page="dashboard">
      <OnboardingCard />
      {agentKindOf(role) === 'screencaster' ? (
        <ScAgentDashboard
          appointments={<AgentAppointmentsBlock />}
          notifications={<AgentNotificationsBlock />}
        />
      ) : (
        <ShAgentDashboard />
      )}
    </AgentLayout>
  );
}
