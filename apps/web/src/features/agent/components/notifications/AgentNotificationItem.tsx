import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useMarkNotificationRead } from '@/features/agent/hooks/useAgentNotifications';
import { relativeFr, showsAppointmentActions } from '@/features/agent/lib/agent-notifications';
import type { AgentNotification } from '@/features/agent/services/agent-notifications.service';
import { ProposeSlotModal } from '@/features/appointments/components/ProposeSlotModal';
import { useAppointmentMutation } from '@/features/appointments/hooks/useAppointments';
import { appointmentsService } from '@/features/appointments/services/appointments.service';
import { getErrorMessage } from '@/lib/errors';

/**
 * AGT-6 — one notification, the same in the bell and the Dashboard block: red dot while unread,
 * relative time, « Consulter » (marks read, opens the destination), « Marquer comme lu », and on a
 * request still waiting: Accepter / Proposer un nouvel horaire.
 */
export function AgentNotificationItem({
  notification: n,
  onNavigate,
}: {
  notification: AgentNotification;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const markRead = useMarkNotificationRead();
  const [proposing, setProposing] = useState(false);
  const accept = useAppointmentMutation((id: string) => appointmentsService.accept(id));
  const propose = useAppointmentMutation((v: { id: string; day: string; hour: number }) =>
    appointmentsService.propose(v.id, v.day, v.hour),
  );
  const unread = !n.read_at;

  const consult = () => {
    if (unread) markRead.mutate(n.id);
    if (n.link) {
      navigate(n.link);
      onNavigate?.();
    }
  };
  const act = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      if (unread) markRead.mutate(n.id);
      toast.success(ok);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
    }
  };

  return (
    <div className={`flex gap-3 px-4 py-3 ${unread ? 'bg-brand-primary/5' : ''}`}>
      <span
        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${unread ? 'bg-red-500' : 'bg-transparent'}`}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${unread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
          {n.title}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">{n.body}</p>
        <p className="mt-1 text-xs text-gray-400">{relativeFr(n.created_at)}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
          {n.link && (
            <button type="button" onClick={consult} className="text-brand-primary">
              Consulter
            </button>
          )}
          {showsAppointmentActions(n) && n.appointment_id && (
            <>
              <button
                type="button"
                onClick={() =>
                  void act(accept.mutateAsync(n.appointment_id ?? ''), 'Rendez-vous confirmé')
                }
                className="text-emerald-700"
              >
                Accepter
              </button>
              <button type="button" onClick={() => setProposing(true)} className="text-gray-700">
                Proposer un nouvel horaire
              </button>
            </>
          )}
          {unread && (
            <button type="button" onClick={() => markRead.mutate(n.id)} className="text-gray-500">
              Marquer comme lu
            </button>
          )}
        </div>
      </div>
      {proposing && n.appointment_id && (
        <ProposeSlotModal
          busy={propose.isPending}
          onClose={() => setProposing(false)}
          onSubmit={(day, hour) =>
            void act(
              propose.mutateAsync({ id: n.appointment_id ?? '', day, hour }),
              'Nouvel horaire proposé',
            ).then(() => setProposing(false))
          }
        />
      )}
    </div>
  );
}
