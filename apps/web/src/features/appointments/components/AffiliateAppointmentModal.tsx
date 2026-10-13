import { format } from 'date-fns';
import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { getErrorMessage } from '@/lib/errors';

import {
  useAppointmentMutation,
  useAvailability,
  useMyAppointments,
} from '../hooks/useAppointments';
import {
  affiliateCanAnswer,
  canCancel,
  dayLabel,
  freeHours,
  hourLabel,
  splitAppointments,
} from '../lib/appointments';
import { type Referent, appointmentsService } from '../services/appointments.service';

import { AppointmentStatusBadge } from './AppointmentStatusBadge';
import { MonthCalendar } from './MonthCalendar';

type ReferentAgent = NonNullable<Referent['agent']>;

/**
 * AGT-5 (agent specs v1.0 §7 « Côté Screencaster / Screenhost : réserver ») — « Prendre
 * rendez-vous » with the referring agent: his photo and name, a mandatory reason, his real
 * availability (unavailable and past days unselectable, taken hours not offered), a message.
 * Above the form, the affiliate's own live requests with their status — a counter-proposal is
 * accepted or declined here.
 */
export function AffiliateAppointmentModal({
  referent,
  onClose,
}: {
  referent: Referent & { agent: ReferentAgent };
  onClose: () => void;
}) {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [objective, setObjective] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const availability = useAvailability(month);
  const mine = useMyAppointments();
  const book = useAppointmentMutation(
    (b: { objective_id: string; day: string; hour: number; message: string | null }) =>
      appointmentsService.request(b),
  );
  const respond = useAppointmentMutation((v: { id: string; accept: boolean }) =>
    appointmentsService.respond(v.id, v.accept),
  );
  const cancel = useAppointmentMutation((id: string) => appointmentsService.cancelMine(id));
  const live = splitAppointments(mine.data?.appointments ?? []).upcoming;
  const hours = day ? freeHours(day, referent.slot_hours, availability.data?.taken ?? [], now) : [];
  const name = [referent.agent.first_name, referent.agent.last_name].filter(Boolean).join(' ');

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

  const submit = async () => {
    if (!objective || !day || hour === null) return;
    const ok = await run(
      book.mutateAsync({ objective_id: objective, day, hour, message: message.trim() || null }),
      'Demande de rendez-vous envoyée',
    );
    if (ok) {
      setDay(null);
      setHour(null);
      setMessage('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {referent.agent.photo_url ? (
              <img
                src={referent.agent.photo_url}
                alt=""
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary/15 font-semibold text-brand-deep">
                {(referent.agent.first_name ?? 'A').charAt(0)}
              </span>
            )}
            <div>
              <p className="text-xs text-gray-500">Votre agent référent</p>
              <p className="font-semibold">{name || 'Votre agent'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {live.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold">Mes demandes</p>
            {live.map((a) => (
              <div key={a.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {dayLabel(a.day)} à {hourLabel(a.hour)}
                    {a.objective ? ` — ${a.objective}` : ''}
                  </span>
                  <AppointmentStatusBadge status={a.status} />
                </div>
                {affiliateCanAnswer(a) && a.proposed_day && a.proposed_hour !== null && (
                  <p className="mt-1 text-gray-600">
                    Nouvel horaire proposé : le {dayLabel(a.proposed_day)} à{' '}
                    {hourLabel(a.proposed_hour)}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  {affiliateCanAnswer(a) && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            respond.mutateAsync({ id: a.id, accept: true }),
                            'Rendez-vous confirmé',
                          )
                        }
                        className="rounded-lg bg-brand-primary px-3 py-1 text-xs font-medium text-brand-deep"
                      >
                        Accepter
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            respond.mutateAsync({ id: a.id, accept: false }),
                            'Nouvel horaire décliné',
                          )
                        }
                        className="rounded-lg border px-3 py-1 text-xs"
                      >
                        Décliner
                      </button>
                    </>
                  )}
                  {canCancel(a) && !affiliateCanAnswer(a) && (
                    <button
                      type="button"
                      onClick={() => void run(cancel.mutateAsync(a.id), 'Rendez-vous annulé')}
                      className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-700"
                    >
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 space-y-4">
          <label className="block text-sm">
            <span className="font-medium">Choisissez votre objectif *</span>
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            >
              <option value="">Choisissez votre objectif</option>
              {referent.objectives.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <MonthCalendar
            month={month}
            onMonth={setMonth}
            today={today}
            unavailable={availability.data?.unavailable ?? []}
            selected={day ? [day] : []}
            unavailableSelectable={false}
            onDay={(d) => {
              setDay(d);
              setHour(null);
            }}
          />

          {day && (
            <div>
              <p className="mb-2 text-sm font-medium">Heure</p>
              {hours.length === 0 ? (
                <p className="text-sm text-gray-500">Aucun créneau libre ce jour-là.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {hours.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHour(h)}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${hour === h ? 'border-brand-primary bg-brand-primary/10 font-semibold' : ''}`}
                    >
                      {hourLabel(h)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="block text-sm">
            <span className="font-medium">Aidez-nous à préparer au mieux l’entretien</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!objective || !day || hour === null || book.isPending}
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
          >
            Prendre rendez-vous
          </button>
        </div>
      </div>
    </div>
  );
}
