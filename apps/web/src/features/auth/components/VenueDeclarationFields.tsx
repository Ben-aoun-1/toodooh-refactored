import {
  BROADCASTS_MATCHES_QUESTION,
  RAMADAN_HOURS_ERROR,
  type VenueDeclarations,
} from '@/features/auth/lib/venue-declarations';
import { HOUR_OPTIONS, isValidHoursWindow, nextDayHint } from '@/features/auth/lib/working-hours';

const INPUT_CLASS =
  'w-full px-4 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-all text-sm text-gray-900';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700 mb-1.5';

interface VenueDeclarationFieldsProps {
  idPrefix: string;
  value: VenueDeclarations;
  onChange: (next: VenueDeclarations) => void;
  /** The step's message for the unanswered match question (set on « Suivant »). */
  matchesError?: string | null;
}

const answerClass = (active: boolean): string =>
  `flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${
    active
      ? 'border-brand-primary bg-brand-primary/15 text-brand-deep'
      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
  }`;

/**
 * Mariem 11/11 — next to the opening hours: the Ramadan window (same selects, same overnight rule)
 * and « Diffusez-vous les matchs ? » with only Oui / Non. Rules in lib/venue-declarations.
 */
export default function VenueDeclarationFields({
  idPrefix,
  value,
  onChange,
  matchesError,
}: VenueDeclarationFieldsProps) {
  const hint = nextDayHint(value.ramadanOpening, value.ramadanClosing);
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">Horaires pendant le Ramadan</p>
        <p className="text-xs text-gray-500 mt-1">
          Les horaires de votre établissement pendant le mois de Ramadan.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-ramadan-opening-hour`}>
            Heure d&apos;ouverture
          </label>
          <select
            value={value.ramadanOpening}
            onChange={(e) => onChange({ ...value, ramadanOpening: parseInt(e.target.value, 10) })}
            className={INPUT_CLASS}
            id={`${idPrefix}-ramadan-opening-hour`}
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={`${idPrefix}-ro-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-ramadan-closing-hour`}>
            Heure de fermeture
          </label>
          <select
            value={value.ramadanClosing}
            onChange={(e) => onChange({ ...value, ramadanClosing: parseInt(e.target.value, 10) })}
            className={INPUT_CLASS}
            id={`${idPrefix}-ramadan-closing-hour`}
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={`${idPrefix}-rc-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!isValidHoursWindow(value.ramadanOpening, value.ramadanClosing) && (
        <p className="text-xs text-red-600">{RAMADAN_HOURS_ERROR}</p>
      )}
      {hint && <p className="text-xs text-gray-600">{hint}</p>}

      <div className="border-t border-gray-200 pt-4">
        <p className="text-sm font-semibold text-gray-900 mb-2">{BROADCASTS_MATCHES_QUESTION}</p>
        <div className="flex gap-3" role="radiogroup" aria-label={BROADCASTS_MATCHES_QUESTION}>
          <button
            type="button"
            role="radio"
            aria-checked={value.broadcastsMatches === true}
            onClick={() => onChange({ ...value, broadcastsMatches: true })}
            className={answerClass(value.broadcastsMatches === true)}
            id={`${idPrefix}-matches-yes`}
          >
            Oui
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={value.broadcastsMatches === false}
            onClick={() => onChange({ ...value, broadcastsMatches: false })}
            className={answerClass(value.broadcastsMatches === false)}
            id={`${idPrefix}-matches-no`}
          >
            Non
          </button>
        </div>
        {matchesError && <p className="text-xs text-red-600 mt-1">{matchesError}</p>}
      </div>
    </div>
  );
}
