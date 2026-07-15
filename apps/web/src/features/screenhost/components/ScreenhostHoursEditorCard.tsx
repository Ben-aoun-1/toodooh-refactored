import { Clock, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';

import { DEFAULT_CLOSING_HOUR, DEFAULT_OPENING_HOUR } from '@/features/auth/lib/working-hours';
import {
  DELETE_HOURS_CONFIRM,
  HOUR_OPTIONS,
  HOURS_CLEARED_TOAST,
  HOURS_ERROR_TOAST,
  HOURS_ORDER_HINT,
  HOURS_SAVED_TOAST,
  NO_HOURS_EXPLANATION,
  NO_HOURS_LABEL,
  clearHoursPatch,
  hoursSummary,
  isValidHoursWindow,
  saveHoursPatch,
} from '@/features/screenhost/lib/venue-hours';
import type {
  HoursPatch,
  OwnerScreenhost,
} from '@/features/screenhost/services/screenhost.service';
import { getErrorMessage } from '@/lib/errors';

const SELECT_CLASS =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white';

/**
 * H2 — one venue's « Horaires d'ouverture » editor (the single-window pair, H1's model). Shows
 * the current state honestly: set → the window summary + prefilled selects; none → « Aucun
 * horaire défini » with what that MEANS (heatmap hachurée + inéligible aux campagnes). Saving
 * sends the full pair; « Supprimer les horaires » (set venues only) is gated by a confirm that
 * repeats the consequence, then sends the both-null clear.
 */
export default function ScreenhostHoursEditorCard({
  screenhost,
  onSave,
}: {
  screenhost: OwnerScreenhost;
  onSave: (patch: HoursPatch) => Promise<void>;
}) {
  const hasHours = screenhost.opening_hour !== null && screenhost.closing_hour !== null;
  const [opening, setOpening] = useState(screenhost.opening_hour ?? DEFAULT_OPENING_HOUR);
  const [closing, setClosing] = useState(screenhost.closing_hour ?? DEFAULT_CLOSING_HOUR);
  const [saving, setSaving] = useState(false);

  // Re-sync the selects when the data refetches after a save/clear.
  useEffect(() => {
    setOpening(screenhost.opening_hour ?? DEFAULT_OPENING_HOUR);
    setClosing(screenhost.closing_hour ?? DEFAULT_CLOSING_HOUR);
  }, [screenhost.opening_hour, screenhost.closing_hour]);

  const valid = isValidHoursWindow(opening, closing);

  const run = async (patch: HoursPatch, successToast: string) => {
    setSaving(true);
    try {
      await onSave(patch);
      toast.success(successToast);
    } catch (error) {
      toast.error(getErrorMessage(error) || HOURS_ERROR_TOAST);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) {
      toast.error(HOURS_ORDER_HINT);
      return;
    }
    await run(saveHoursPatch(opening, closing), HOURS_SAVED_TOAST);
  };

  const handleClear = async () => {
    if (!window.confirm(DELETE_HOURS_CONFIRM)) return;
    await run(clearHoursPatch(), HOURS_CLEARED_TOAST);
  };

  return (
    <form
      onSubmit={(e) => void handleSave(e)}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="h-5 w-5 text-brand-deep flex-shrink-0" />
          <h3 className="font-semibold text-gray-900 truncate">{screenhost.name}</h3>
        </div>
        {hasHours ? (
          <span className="text-sm font-medium text-gray-700 tabular-nums flex-shrink-0">
            {hoursSummary(screenhost.opening_hour, screenhost.closing_hour)}
          </span>
        ) : (
          <span className="text-sm font-medium text-amber-700 bg-amber-50 rounded-full px-3 py-1 flex-shrink-0">
            {NO_HOURS_LABEL}
          </span>
        )}
      </div>

      {!hasHours && <p className="text-sm text-gray-600">{NO_HOURS_EXPLANATION}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`hours-open-${screenhost.id}`}
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Ouverture
          </label>
          <select
            id={`hours-open-${screenhost.id}`}
            value={opening}
            onChange={(e) => setOpening(Number(e.target.value))}
            className={SELECT_CLASS}
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={`hours-close-${screenhost.id}`}
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Fermeture
          </label>
          <select
            id={`hours-close-${screenhost.id}`}
            value={closing}
            onChange={(e) => setClosing(Number(e.target.value))}
            className={SELECT_CLASS}
          >
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!valid && <p className="text-sm text-[#FB3748]">{HOURS_ORDER_HINT}</p>}

      <div className="flex items-center justify-between gap-3">
        <button
          type="submit"
          disabled={saving || !valid}
          className="px-5 py-2.5 rounded-xl bg-brand-primary text-sm font-semibold text-[#101010] hover:bg-brand-primary/90 disabled:opacity-50"
        >
          Enregistrer les horaires
        </button>
        {hasHours && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleClear()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Supprimer les horaires
          </button>
        )}
      </div>
    </form>
  );
}
