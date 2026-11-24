import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { getErrorMessage } from '@/lib/errors';

import { useAppointmentMutation } from '../hooks/useAppointments';
import {
  PLACE_FR,
  QUARTERS,
  affiliateCanAnswer,
  affiliateCanAnswerRequest,
  canCancel,
  dayLabel,
  hourLabel,
  parseQuarter,
} from '../lib/appointments';
import { type AppointmentView, appointmentsService } from '../services/appointments.service';

import { AppointmentStatusBadge } from './AppointmentStatusBadge';

/**
 * One line of « Mes demandes » in the affiliate's « Prendre rendez-vous »: his own request (he
 * accepts or declines the agent's counter-proposal) or — AGENT-VF, spec VF §13 / §9 — a request
 * his agent sent him: « Accepter » or « Proposer un autre horaire » (a date and a quarter-hour).
 */
export function MyRequestRow({
  appointment: a,
  today,
}: {
  appointment: AppointmentView;
  today: string;
}) {
  const [proposing, setProposing] = useState(false);
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const respond = useAppointmentMutation((accept: boolean) =>
    appointmentsService.respond(a.id, accept),
  );
  const acceptRequest = useAppointmentMutation((id: string) =>
    appointmentsService.acceptRequest(id),
  );
  const proposeBack = useAppointmentMutation(
    (slot: { day: string; hour: number; minute: number }) =>
      appointmentsService.proposeBack(a.id, slot),
  );
  const cancel = useAppointmentMutation((id: string) => appointmentsService.cancelMine(id));
  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Action impossible');
      return false;
    }
  };
  const fromAgent = a.initiated_by === 'agent';
  const slot = parseQuarter(time);
  const details = [a.objective, a.place ? PLACE_FR[a.place] : null].filter(Boolean).join(' · ');

  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>
          {dayLabel(a.day)} à {hourLabel(a.hour, a.minute)}
          {details ? ` · ${details}` : ''}
        </span>
        <AppointmentStatusBadge status={a.status} />
      </div>
      {fromAgent && a.status === 'en_attente' && (
        <p className="mt-1 text-gray-600">
          Proposé par votre agent{a.message ? ` : « ${a.message} »` : '.'}
        </p>
      )}
      {a.status === 'nouvel_horaire' && a.proposed_day && a.proposed_hour !== null && (
        <p className="mt-1 text-gray-600">
          {fromAgent ? 'Vous avez proposé' : 'Nouvel horaire proposé'} : le{' '}
          {dayLabel(a.proposed_day)} à {hourLabel(a.proposed_hour, a.proposed_minute ?? 0)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {affiliateCanAnswer(a) && (
          <>
            <button
              type="button"
              onClick={() => void run(respond.mutateAsync(true), 'Rendez-vous confirmé')}
              className="rounded-lg bg-brand-primary px-3 py-1 text-xs font-medium text-brand-deep"
            >
              Accepter
            </button>
            <button
              type="button"
              onClick={() => void run(respond.mutateAsync(false), 'Nouvel horaire décliné')}
              className="rounded-lg border px-3 py-1 text-xs"
            >
              Décliner
            </button>
          </>
        )}
        {affiliateCanAnswerRequest(a) && (
          <>
            <button
              type="button"
              disabled={acceptRequest.isPending}
              onClick={() => void run(acceptRequest.mutateAsync(a.id), 'Rendez-vous confirmé')}
              className="rounded-lg bg-brand-primary px-3 py-1 text-xs font-medium text-brand-deep disabled:opacity-50"
            >
              Accepter
            </button>
            <button
              type="button"
              onClick={() => setProposing((v) => !v)}
              className="rounded-lg border px-3 py-1 text-xs"
            >
              Proposer un autre horaire
            </button>
          </>
        )}
        {canCancel(a) && !affiliateCanAnswer(a) && !affiliateCanAnswerRequest(a) && (
          <button
            type="button"
            onClick={() => void run(cancel.mutateAsync(a.id), 'Rendez-vous annulé')}
            className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-700"
          >
            Annuler
          </button>
        )}
      </div>
      {proposing && affiliateCanAnswerRequest(a) && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block font-medium">Date</span>
            <input
              type="date"
              min={today}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="mt-1 rounded-lg border px-2 py-1"
            />
          </label>
          <label className="text-xs">
            <span className="block font-medium">Heure</span>
            <select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 rounded-lg border px-2 py-1"
            >
              <option value="">Choisir</option>
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  {q.replace(':', 'h')}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!day || day < today || !slot || proposeBack.isPending}
            onClick={() =>
              slot &&
              void run(proposeBack.mutateAsync({ day, ...slot }), 'Nouvel horaire proposé').then(
                (ok) => ok && setProposing(false),
              )
            }
            className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-medium text-brand-deep disabled:opacity-50"
          >
            Envoyer
          </button>
        </div>
      )}
    </div>
  );
}
