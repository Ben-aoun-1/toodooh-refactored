import { format, parse } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { toast } from 'react-hot-toast';
import 'react-datepicker/dist/react-datepicker.css';

import { ApiError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';

import { useSuggestMatch } from '../hooks/useEvents';
import { type SuggestFormErrors, validateSuggestForm } from '../lib/event-display';

const INPUT_CLASSES =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary';

// GREEN2 item 7b — French/24h PRESENTATION over the native mm/dd/yyyy + 12-hour controls; the
// stored state stays exactly the wire strings ('yyyy-MM-dd' / 'HH:mm').
registerLocale('fr', fr);
const TIME_CARRIER = new Date(2000, 0, 1);

/**
 * « Suggérer un match » — Équipe A/B + date + horaire, ALL required (the client mirrors the
 * server's French per-field messages; the duplicate 409's pointer message surfaces verbatim).
 */
export default function SuggestMatchForm() {
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [errors, setErrors] = useState<SuggestFormErrors>({});
  const suggest = useSuggestMatch();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = { team_a: teamA, team_b: teamB, date, kickoff_time: time };
    const validation = validateSuggestForm(input);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    suggest.mutate(input, {
      onSuccess: (created) => {
        toast.success(`Match suggéré : ${created.name}`);
        setTeamA('');
        setTeamB('');
        setDate('');
        setTime('');
        setErrors({});
      },
      onError: (err) => {
        // The duplicate refusal carries its own pointer (« …retrouvez-le dans “Ce que les
        // screencasters suggèrent” ») — surface the server message verbatim.
        if (err instanceof ApiError && err.status === 409) toast.error(err.message);
        else toast.error(getErrorMessage(err) || 'La suggestion a échoué. Veuillez réessayer.');
      },
    });
  };

  const field = (
    label: string,
    key: keyof SuggestFormErrors,
    node: React.ReactNode,
  ): React.ReactNode => (
    <div>
      <label htmlFor={`suggest-${key}`} className="block text-sm font-medium text-[#171717] mb-1">
        {label} <span className="text-red-500">*</span>
      </label>
      {node}
      {errors[key] !== undefined && <p className="mt-1 text-xs text-red-600">{errors[key]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-base font-semibold text-[#171717] mb-4">Suggérer un match</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field(
          'Équipe A',
          'team_a',
          <input
            id="suggest-team_a"
            className={INPUT_CLASSES}
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
            placeholder="Espérance"
          />,
        )}
        {field(
          'Équipe B',
          'team_b',
          <input
            id="suggest-team_b"
            className={INPUT_CLASSES}
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
            placeholder="Club Africain"
          />,
        )}
        {field(
          'Date du match',
          'date',
          <DatePicker
            id="suggest-date"
            locale="fr"
            dateFormat="dd/MM/yyyy"
            placeholderText="JJ/MM/AAAA"
            className={INPUT_CLASSES}
            wrapperClassName="w-full"
            selected={date === '' ? null : parse(date, 'yyyy-MM-dd', new Date())}
            onChange={(d) => setDate(d === null ? '' : format(d, 'yyyy-MM-dd'))}
          />,
        )}
        {field(
          'Horaire (coup d’envoi)',
          'kickoff_time',
          <DatePicker
            id="suggest-kickoff_time"
            locale="fr"
            showTimeSelect
            showTimeSelectOnly
            timeIntervals={15}
            timeCaption="Heure"
            dateFormat="HH:mm"
            timeFormat="HH:mm"
            placeholderText="HH:MM"
            className={INPUT_CLASSES}
            wrapperClassName="w-full"
            selected={time === '' ? null : parse(time, 'HH:mm', TIME_CARRIER)}
            onChange={(d) => setTime(d === null ? '' : format(d, 'HH:mm'))}
          />,
        )}
      </div>
      <button
        type="submit"
        disabled={suggest.isPending}
        className="mt-4 rounded-lg bg-brand-primary text-brand-deep text-sm font-medium px-5 py-2.5 disabled:opacity-60"
      >
        {suggest.isPending ? 'Envoi…' : 'Suggérer ce match'}
      </button>
    </form>
  );
}
