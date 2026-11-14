import { agentKindOf } from '@/features/agent/lib/agent-shell';
import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfFaq } from '@/features/agent/vf/VfFaq';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// AGENT-VF — the agent FAQ, opened from the Support window.
export default function AgentFaq() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentVfLayout page="faq">
      <VfFaq kind={agentKindOf(role) ?? 'screencaster'} />
    </AgentVfLayout>
  );
}
