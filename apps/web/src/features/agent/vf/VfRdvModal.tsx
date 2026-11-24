import { format } from 'date-fns';
import { useState } from 'react';

import {
  useAgentRdvOptions,
  useAppointmentMutation,
} from '@/features/appointments/hooks/useAppointments';
import { parseQuarter, rdvRequestReady } from '@/features/appointments/lib/appointments';
import {
  type AgentRdvRequest,
  type AppointmentPlace,
  appointmentsService,
} from '@/features/appointments/services/appointments.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';

import { agentKindOf } from '../lib/agent-shell';

import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

/**
 * AGENT-VF (spec VF §13 / §9) — « Prendre un rendez-vous »: the agent asks one of his affiliates
 * himself. Affiliate, date (today or later), time on a quarter-hour, place (Sur place by default),
 * subject and an optional message; « Envoyer la demande » stays off until every mandatory field is
 * filled. `presetId` preselects the affiliate (opened from his fiche).
 */
export function VfRdvModal({ presetId = '' }: { presetId?: string }) {
  const { closeAll, toast } = useVfOverlay();
  const role = useAuthStore((s) => s.role);
  const label = agentKindOf(role) === 'screenhost' ? 'Screenhost' : 'Screencaster';
  const options = useAgentRdvOptions();
  const send = useAppointmentMutation((b: AgentRdvRequest) => appointmentsService.agentRequest(b));
  const today = format(new Date(), 'yyyy-MM-dd');
  const [target, setTarget] = useState(presetId);
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [place, setPlace] = useState<AppointmentPlace>('sur_place');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const ready = rdvRequestReady({ target, day, time, subject }, today);

  const submit = async () => {
    const slot = parseQuarter(time);
    if (!ready || !slot) return;
    try {
      const r = await send.mutateAsync({
        target_id: target,
        day,
        ...slot,
        place,
        subject,
        message: message.trim() || null,
      });
      closeAll();
      toast(`Demande envoyée à ${r.target}. L'équipe Toodooh est informée.`);
    } catch (e) {
      toast(getErrorMessage(e) || 'Envoi impossible');
    }
  };

  return (
    <>
      <div className="mh">
        <span className="mi">
          <VfIcon k="cal" size={18} />
        </span>
        <div>
          <b>Prendre un rendez-vous</b>
          <small>Avec un {label} affilié</small>
        </div>
        <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="mb2">
        <div className="f">
          <label htmlFor="vf-rdv-who">
            {label} <i>*</i>
          </label>
          <select id="vf-rdv-who" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choisissez un {label}</option>
            {(options.data?.targets ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="vf-rdv-grid">
          <div className="f">
            <label htmlFor="vf-rdv-day">
              Date <i>*</i>
            </label>
            <input
              id="vf-rdv-day"
              type="date"
              min={today}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
          <div className="f">
            <label htmlFor="vf-rdv-time">
              Heure <i>*</i>
            </label>
            <input
              id="vf-rdv-time"
              type="time"
              step={900}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>
        <div className="f">
          <span className="vf-label">
            Lieu <i>*</i>
          </span>
          <div className="vt">
            {(options.data?.places ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                className={p.id === place ? 'on' : undefined}
                onClick={() => setPlace(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="f">
          <label htmlFor="vf-rdv-subject">
            Objet <i>*</i>
          </label>
          <select id="vf-rdv-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Choisissez l&apos;objet</option>
            {(options.data?.subjects ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="f">
          <label htmlFor="vf-rdv-note">Message (facultatif)</label>
          <textarea
            id="vf-rdv-note"
            rows={2}
            placeholder={`Précisions pour le ${label}`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div className="banner vf-banner-info">
          <VfIcon k="alert" size={16} />
          <span>
            Le {label} reçoit votre demande : il l&apos;accepte ou propose un autre horaire.
            L&apos;équipe Toodooh en est informée.
          </span>
        </div>
      </div>
      <div className="mf">
        <button type="button" className="btn" onClick={closeAll}>
          Annuler
        </button>
        <button
          type="button"
          className="btn pri"
          disabled={!ready || send.isPending}
          onClick={() => void submit()}
        >
          Envoyer la demande
        </button>
      </div>
    </>
  );
}
