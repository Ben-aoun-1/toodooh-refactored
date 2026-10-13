import { CalendarClock, MapPin } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { getErrorMessage } from '@/lib/errors';

import { useAppointmentMutation } from '../hooks/useAppointments';
import { agentCanAnswer, canCancel, dayLabel, hourLabel } from '../lib/appointments';
import { type AppointmentView, appointmentsService } from '../services/appointments.service';

import { AppointmentStatusBadge } from './AppointmentStatusBadge';
import { ProposeSlotModal } from './ProposeSlotModal';

/**
 * AGT-5 — one appointment as the agent sees it (Dashboard, calendar, bell): affiliate, status,
 * date, hour, reason — and, for a Screenhost, the venue and its address. A request still waiting
 * for him shows Accepter / Proposer un nouvel horaire; a treated one shows no buttons.
 */
export function AgentAppointmentCard({ appointment: a }: { appointment: AppointmentView }) {
  const [proposing, setProposing] = useState(false);
  const accept = useAppointmentMutation((id: string) => appointmentsService.accept(id));
  const propose = useAppointmentMutation((v: { id: string; day: string; hour: number }) =>
    appointmentsService.propose(v.id, v.day, v.hour),
  );
  const cancel = useAppointmentMutation((id: string) => appointmentsService.cancelAsAgent(id));
  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  return (
    <div className="rounded-xl border border-[#E1E4EA] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{a.counterpart_name}</p>
          {a.venue_name && (
            <p className="flex items-center gap-1 truncate text-xs text-gray-500">
              <MapPin className="h-3.5 w-3.5" />
              {a.venue_name}
              {a.venue_address ? ` — ${a.venue_address}` : ''}
            </p>
          )}
        </div>
        <AppointmentStatusBadge status={a.status} />
      </div>
      <p className="mt-2 flex items-center gap-1 text-sm text-gray-700">
        <CalendarClock className="h-4 w-4" />
        {dayLabel(a.day)} à {hourLabel(a.hour)}
        {a.status === 'nouvel_horaire' && a.proposed_day && a.proposed_hour !== null && (
          <span className="text-gray-500">
            {' '}
            → proposé le {dayLabel(a.proposed_day)} à {hourLabel(a.proposed_hour)}
          </span>
        )}
      </p>
      {a.objective && <p className="mt-1 text-sm text-gray-600">{a.objective}</p>}
      {a.message && <p className="mt-1 text-sm italic text-gray-500">« {a.message} »</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {agentCanAnswer(a) && (
          <>
            <button
              type="button"
              disabled={accept.isPending}
              onClick={() => void run(accept.mutateAsync(a.id), 'Rendez-vous confirmé')}
              className="rounded-lg bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-deep"
            >
              Accepter
            </button>
            <button
              type="button"
              onClick={() => setProposing(true)}
              className="rounded-lg border px-3 py-1.5 text-sm"
            >
              Proposer un nouvel horaire
            </button>
          </>
        )}
        {canCancel(a) && (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => void run(cancel.mutateAsync(a.id), 'Rendez-vous annulé')}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700"
          >
            Annuler
          </button>
        )}
      </div>
      {proposing && (
        <ProposeSlotModal
          busy={propose.isPending}
          onClose={() => setProposing(false)}
          onSubmit={(day, hour) =>
            void run(propose.mutateAsync({ id: a.id, day, hour }), 'Nouvel horaire proposé').then(
              () => setProposing(false),
            )
          }
        />
      )}
    </div>
  );
}
