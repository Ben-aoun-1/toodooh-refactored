import { useState } from 'react';
import { createPortal } from 'react-dom';

import { ProposeSlotModal } from '@/features/appointments/components/ProposeSlotModal';
import { useAppointmentMutation } from '@/features/appointments/hooks/useAppointments';
import {
  APPOINTMENT_STATUS_FR,
  agentCanAnswer,
  canCancel,
  dayLabel,
  hourLabel,
} from '@/features/appointments/lib/appointments';
import {
  type AppointmentStatus,
  type AppointmentView,
  appointmentsService,
} from '@/features/appointments/services/appointments.service';
import { getErrorMessage } from '@/lib/errors';

import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

const BADGE: Record<AppointmentStatus, string> = {
  en_attente: 'b-av',
  nouvel_horaire: 'b-att',
  confirme: 'b-act',
  annule: 'b-wait',
  expire: 'b-wait',
  passe: 'b-ter',
};

/**
 * AGENT-VF — « Mes rendez-vous » as the prototype lists them: who · date à heure, then the reason,
 * the status badge and the actions the agent still has (answer a request, cancel).
 */
export function VfRdvList({ rows, past = false }: { rows: AppointmentView[]; past?: boolean }) {
  return (
    <div className="list vf-rdv">
      {rows.map((a) => (
        <Row key={a.id} appointment={a} past={past} />
      ))}
    </div>
  );
}

function Row({ appointment: a, past }: { appointment: AppointmentView; past: boolean }) {
  const { openModal, closeAll, toast } = useVfOverlay();
  const [proposing, setProposing] = useState(false);
  const accept = useAppointmentMutation((id: string) => appointmentsService.accept(id));
  const propose = useAppointmentMutation((v: { id: string; day: string; hour: number }) =>
    appointmentsService.propose(v.id, v.day, v.hour),
  );
  const cancel = useAppointmentMutation((id: string) => appointmentsService.cancelAsAgent(id));
  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast(ok);
    } catch (e) {
      toast(getErrorMessage(e) || 'Action impossible');
    }
  };
  const who = a.venue_name ?? a.counterpart_name;
  const when = `${dayLabel(a.day)} à ${hourLabel(a.hour)}`;
  const details = [
    a.objective,
    a.venue_name ? a.counterpart_name : null,
    a.status === 'nouvel_horaire' && a.proposed_day && a.proposed_hour !== null
      ? `proposé le ${dayLabel(a.proposed_day)} à ${hourLabel(a.proposed_hour)}`
      : null,
    a.message ? `« ${a.message} »` : null,
  ].filter(Boolean);

  const confirmCancel = () =>
    openModal(
      <>
        <div className="mh">
          <span className="mi">
            <VfIcon k="cal" size={18} />
          </span>
          <div>
            <b>Annuler ce rendez-vous ?</b>
            <small>
              {who} · {when}
            </small>
          </div>
          <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="mb2">
          <p className="tiny vf-m0">
            {who} et l&apos;équipe Toodooh seront prévenus de l&apos;annulation.
          </p>
        </div>
        <div className="mf">
          <button type="button" className="btn" onClick={closeAll}>
            Retour
          </button>
          <button
            type="button"
            className="btn pri"
            onClick={() => {
              closeAll();
              void run(cancel.mutateAsync(a.id), 'Rendez-vous annulé.');
            }}
          >
            Annuler le rendez-vous
          </button>
        </div>
      </>,
    );

  return (
    <div className="li">
      <span className="vf-rdv-id">
        <span className="ni">
          <VfIcon k="cal" size={16} />
        </span>
        <span className="nm">
          <b>
            {who} · {when}
          </b>
          <small>{details.join(' · ')}</small>
        </span>
      </span>
      <span className="vf-rdv-acts">
        <span className={`badge ${BADGE[a.status]}`}>{APPOINTMENT_STATUS_FR[a.status]}</span>
        {!past && agentCanAnswer(a) && (
          <>
            <button
              type="button"
              className="btn sm pri"
              disabled={accept.isPending}
              onClick={() => void run(accept.mutateAsync(a.id), 'Rendez-vous confirmé')}
            >
              Accepter
            </button>
            <button type="button" className="btn sm" onClick={() => setProposing(true)}>
              Proposer un nouvel horaire
            </button>
          </>
        )}
        {!past && canCancel(a) && (
          <button type="button" className="btn sm" onClick={confirmCancel}>
            Annuler
          </button>
        )}
      </span>
      {proposing &&
        createPortal(
          <ProposeSlotModal
            busy={propose.isPending}
            onClose={() => setProposing(false)}
            onSubmit={(day, hour) =>
              void run(propose.mutateAsync({ id: a.id, day, hour }), 'Nouvel horaire proposé').then(
                () => setProposing(false),
              )
            }
          />,
          document.body,
        )}
    </div>
  );
}
