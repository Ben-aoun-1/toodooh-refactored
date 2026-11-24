import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfSettings } from '@/features/agent/vf/VfSettings';

// AGENT-VF — « Paramètres »: four tabs, deep-linkable (?tab=) so each step of « Finalisez votre
// compte » opens the right entry.
export default function AgentSettings() {
  return (
    <AgentVfLayout page="settings">
      <VfSettings />
    </AgentVfLayout>
  );
}
