import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfSensors } from '@/features/agent/vf/VfSensors';

// AGENT-VF (Agent Screenhost spec VF §12) — « Suivi des capteurs ».
export default function AgentSensors() {
  return (
    <AgentVfLayout page="sensors">
      <VfSensors />
    </AgentVfLayout>
  );
}
