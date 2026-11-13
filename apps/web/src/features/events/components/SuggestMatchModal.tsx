import { ArrowRight, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import { usePositionner, useSuggestMatch } from '../hooks/useEvents';
import { type SuggestFormErrors, validateSuggestForm } from '../lib/event-display';
import {
  EXISTING_MATCH_TOAST,
  SUGGEST_CANCEL,
  SUGGEST_EYEBROW,
  SUGGEST_INTRO_AFTER,
  SUGGEST_INTRO_BEFORE,
  SUGGEST_INTRO_BOLD,
  SUGGEST_SUBMIT,
  SUGGEST_TITLE,
  SUGGEST_WINDOW_NOTE,
  existingEventIdOf,
} from '../lib/suggest-match';

const log = logger.child({ module: 'SuggestMatchModal' });

const INPUT_CLASS =
  'min-h-[46px] w-full rounded-xl border border-gray-200 bg-white px-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/40';

/**
 * SUGG-2 — « Suggérer un match » (Youssef's v9 mockup): Équipe A/B, the exact date and the
 * kick-off time (Tunis), all required. « Je me positionne → » records the suggestion, opens the
 * positioning on it and lands on its parcours; a match that already exists (the 409 names it) is
 * positioned on instead (ruling Q1 A).
 */
export default function SuggestMatchModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const suggest = useSuggestMatch();
  const positionner = usePositionner();
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [errors, setErrors] = useState<SuggestFormErrors>({});
  const busy = suggest.isPending || positionner.isPending;
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const positionOn = async (eventId: string) => {
    const created = await positionner.mutateAsync(eventId);
    navigate(`/evenements/positionnement/${created.id}`);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { team_a: teamA, team_b: teamB, date, kickoff_time: time };
    const validation = validateSuggestForm(input);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    try {
      let eventId: string;
      try {
        eventId = (await suggest.mutateAsync(input)).id;
      } catch (err) {
        const existing =
          err instanceof ApiError && err.status === 409 ? existingEventIdOf(err.body) : null;
        if (!existing) throw err;
        toast(EXISTING_MATCH_TOAST);
        eventId = existing;
      }
      await positionOn(eventId);
    } catch (err) {
      toast.error(getErrorMessage(err) || 'La suggestion a échoué. Veuillez réessayer.');
      log.error({ err }, 'suggest and position failed');
    }
  };

  const field = (label: string, key: keyof SuggestFormErrors, control: ReactNode) => (
    <div>
      <label
        htmlFor={`suggest-${key}`}
        className="mb-1.5 block text-[13px] font-medium text-gray-900"
      >
        {label}
      </label>
      {control}
      {errors[key] !== undefined && <p className="mt-1 text-xs text-red-600">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggest-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-[540px] overflow-y-auto rounded-3xl bg-white shadow-2xl"
      >
        <div className="relative bg-brand-deep px-6 pb-6 pt-5 sm:px-8">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/25"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
            {SUGGEST_EYEBROW}
          </span>
          <h2 id="suggest-title" className="mt-4 text-2xl font-bold text-white">
            {SUGGEST_TITLE}
          </h2>
        </div>
        <form onSubmit={(e) => void submit(e)} className="space-y-5 px-6 py-6 sm:px-8">
          <p className="text-sm leading-relaxed text-gray-600">
            {SUGGEST_INTRO_BEFORE}
            <b className="text-gray-900">{SUGGEST_INTRO_BOLD}</b>
            {SUGGEST_INTRO_AFTER}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
              'Équipe A',
              'team_a',
              <input
                id="suggest-team_a"
                className={INPUT_CLASS}
                value={teamA}
                onChange={(e) => setTeamA(e.target.value)}
                placeholder="Ex. Tunisie"
                ref={firstField}
              />,
            )}
            {field(
              'Équipe B',
              'team_b',
              <input
                id="suggest-team_b"
                className={INPUT_CLASS}
                value={teamB}
                onChange={(e) => setTeamB(e.target.value)}
                placeholder="Ex. Brésil"
              />,
            )}
            {field(
              'Date exacte du match',
              'date',
              <input
                id="suggest-date"
                type="date"
                className={INPUT_CLASS}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />,
            )}
            {field(
              'Horaire du coup d’envoi (Tunis)',
              'kickoff_time',
              <input
                id="suggest-kickoff_time"
                type="time"
                className={INPUT_CLASS}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />,
            )}
          </div>
          <p className="text-xs text-gray-500">{SUGGEST_WINDOW_NOTE}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              {SUGGEST_CANCEL}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-deep px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {SUGGEST_SUBMIT}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
