import { agentKindOf } from '@/features/agent/lib/agent-shell';
import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfAffiliates } from '@/features/agent/vf/VfAffiliates';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// AGENT-VF — « Mes Screencasters » / « Mes Screenhosts » of the agent's type.
export default function AgentAffiliates() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentVfLayout page="affiliates">
      <VfAffiliates kind={agentKindOf(role) ?? 'screencaster'} />
    </AgentVfLayout>
  );
}
