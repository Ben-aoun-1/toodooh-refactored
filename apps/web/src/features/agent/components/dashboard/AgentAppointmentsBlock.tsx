import { CalendarDays } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { AGENT_PATHS } from '@/features/agent/lib/agent-shell';
import { AgentAppointmentCard } from '@/features/appointments/components/AgentAppointmentCard';
import { useAgentAppointments } from '@/features/appointments/hooks/useAppointments';
import { splitAppointments } from '@/features/appointments/lib/appointments';

import { DashboardSection } from './DashboardSection';

/** Dashboard bloc 9 — the next appointments (Confirmé, En attente), « Accéder au calendrier ». */
export function AgentAppointmentsBlock() {
  const navigate = useNavigate();
  const list = useAgentAppointments();
  const next = splitAppointments(list.data?.appointments ?? []).upcoming.slice(0, 3);
  return (
    <DashboardSection
      title="Mes rendez-vous"
      isEmpty={next.length === 0}
      empty="Aucun rendez-vous à venir."
      emptyIcon={<CalendarDays className="h-10 w-10" />}
      action={
        <button
          type="button"
          onClick={() => navigate(AGENT_PATHS.calendar)}
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          Accéder au calendrier
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {next.map((a) => (
          <AgentAppointmentCard key={a.id} appointment={a} />
        ))}
      </div>
    </DashboardSection>
  );
}
