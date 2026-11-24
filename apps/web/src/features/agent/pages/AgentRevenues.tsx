import { agentKindOf } from '@/features/agent/lib/agent-shell';
import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfRevenues } from '@/features/agent/vf/VfRevenues';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// AGENT-VF — « Mes revenus »: the balance, the cumulated revenue and the transactions.
export default function AgentRevenues() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentVfLayout page="revenues">
      <VfRevenues kind={agentKindOf(role) ?? 'screencaster'} />
    </AgentVfLayout>
  );
}
