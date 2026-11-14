import { agentKindOf } from '@/features/agent/lib/agent-shell';
import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfCampaigns } from '@/features/agent/vf/VfCampaigns';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// AGENT-VF — « Mes campagnes affiliées », read-only, for either agent type.
export default function AgentCampaigns() {
  const role = useAuthStore((s) => s.role);
  return (
    <AgentVfLayout page="campaigns">
      <VfCampaigns kind={agentKindOf(role) ?? 'screencaster'} />
    </AgentVfLayout>
  );
}
