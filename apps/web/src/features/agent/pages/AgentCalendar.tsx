import AgentVfLayout from '@/features/agent/vf/AgentVfLayout';
import { VfCalendar } from '@/features/agent/vf/VfCalendar';

// AGENT-VF — « Mon calendrier »: availability (days or hours, several days at once) and
// rendez-vous.
export default function AgentCalendar() {
  return (
    <AgentVfLayout page="calendar">
      <VfCalendar />
    </AgentVfLayout>
  );
}
