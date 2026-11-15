import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfChecklist } from '@/features/agent/vf/VfChecklist';

// AGENT-VF (Agent Screenhost spec VF §11) — the Checklist tab.
export default function AgentChecklist() {
  return (
    <AgentVfLayout page="checklist">
      <VfChecklist />
    </AgentVfLayout>
  );
}
