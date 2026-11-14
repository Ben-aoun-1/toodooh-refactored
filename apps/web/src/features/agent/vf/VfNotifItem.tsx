import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { useMarkNotificationRead } from '@/features/agent/hooks/useAgentNotifications';
import {
  relativeFr,
  showsAppointmentActions,
  vfNotifKind,
} from '@/features/agent/lib/agent-notifications';
import type { AgentNotification } from '@/features/agent/services/agent-notifications.service';
import { ProposeSlotModal } from '@/features/appointments/components/ProposeSlotModal';
import { useAppointmentMutation } from '@/features/appointments/hooks/useAppointments';
import { appointmentsService } from '@/features/appointments/services/appointments.service';
import { getErrorMessage } from '@/lib/errors';

import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

/**
 * AGENT-VF — one notification, the same in the bell and in the Dashboard block: the coloured icon
 * of its family with a red dot while unread, « Consulter » (marks it read, opens the destination),
 * « Marquer comme lu »; a rendez-vous request still waiting adds Accepter / Proposer.
 */
export function VfNotifItem({
  notification: n,
  onNavigate,
}: {
  notification: AgentNotification;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const { toast } = useVfOverlay();
  const markRead = useMarkNotificationRead();
  const [proposing, setProposing] = useState(false);
  const accept = useAppointmentMutation((id: string) => appointmentsService.accept(id));
  const propose = useAppointmentMutation((v: { id: string; day: string; hour: number }) =>
    appointmentsService.propose(v.id, v.day, v.hour),
  );
  const unread = !n.read_at;
  const kind = vfNotifKind(n.type);

  const consult = () => {
    if (unread) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
    onNavigate?.();
  };
  const act = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      if (unread) markRead.mutate(n.id);
      toast(ok);
    } catch (e) {
      toast(getErrorMessage(e) || 'Action impossible');
    }
  };

  return (
    <div className={`notif${unread ? ' unread' : ''}`}>
      <span className={`ni k-${kind}${unread ? ' u' : ''}`}>
        <VfIcon k={kind === 'att' ? 'alert' : kind === 'offer' ? 'rev' : 'camp'} size={16} />
      </span>
      <div className="vf-min0">
        <b>{n.title}</b>
        <p>{n.body}</p>
        <span className="tiny">{relativeFr(n.created_at)}</span>
        <div className="acts">
          <button type="button" className="btn sm pri" onClick={consult}>
            Consulter
          </button>
          {showsAppointmentActions(n) && n.appointment_id && (
            <>
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  void act(accept.mutateAsync(n.appointment_id ?? ''), 'Rendez-vous confirmé')
                }
              >
                Accepter
              </button>
              <button type="button" className="btn sm" onClick={() => setProposing(true)}>
                Proposer un nouvel horaire
              </button>
            </>
          )}
          {unread && (
            <button type="button" className="btn sm" onClick={() => markRead.mutate(n.id)}>
              Marquer comme lu
            </button>
          )}
        </div>
      </div>
      {proposing &&
        n.appointment_id &&
        // The slot picker is still the shared (Tailwind) one: it renders outside the VF scope.
        createPortal(
          <ProposeSlotModal
            busy={propose.isPending}
            onClose={() => setProposing(false)}
            onSubmit={(day, hour) =>
              void act(
                propose.mutateAsync({ id: n.appointment_id ?? '', day, hour }),
                'Nouvel horaire proposé',
              ).then(() => setProposing(false))
            }
          />,
          document.body,
        )}
    </div>
  );
}
