import { Monitor } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';

import {
  DECLARATION_ERROR_TOAST,
  DECLARATION_SAVED_TOAST,
  NOT_DECLARED_LABEL,
  declarationPatchFrom,
  declarationSummary,
  declaredCountInput,
} from '@/features/screenhost/lib/venue-declaration';
import type {
  DeclarationPatch,
  OwnerScreenhost,
} from '@/features/screenhost/services/screenhost.service';
import { getErrorMessage } from '@/lib/errors';

const INPUT_CLASS =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700 mb-1';

/**
 * SCR-DECL1 — one venue's « Écrans et salles » editor (the ScreenhostHoursEditorCard precedent).
 * Prefilled from `/mine`; a never-declared count shows empty and « À renseigner » (both are
 * required). Saving sends BOTH counts; the server's refusal (e.g. below the installed screens)
 * is shown as the toast.
 */
export default function ScreenhostDeclarationEditorCard({
  screenhost,
  onSave,
}: {
  screenhost: OwnerScreenhost;
  onSave: (patch: DeclarationPatch) => Promise<void>;
}) {
  const [screens, setScreens] = useState(declaredCountInput(screenhost.screen_count));
  const [rooms, setRooms] = useState(declaredCountInput(screenhost.room_count));
  const [saving, setSaving] = useState(false);

  // Re-sync the inputs when the data refetches after a save.
  useEffect(() => {
    setScreens(declaredCountInput(screenhost.screen_count));
    setRooms(declaredCountInput(screenhost.room_count));
  }, [screenhost.screen_count, screenhost.room_count]);

  const summary = declarationSummary(screenhost.screen_count, screenhost.room_count);
  const draft = declarationPatchFrom(screens, rooms);
  const showError = 'error' in draft && (screens.trim() !== '' || rooms.trim() !== '');

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if ('error' in draft) {
      toast.error(draft.error);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft.patch);
      toast.success(DECLARATION_SAVED_TOAST);
    } catch (error) {
      toast.error(getErrorMessage(error) || DECLARATION_ERROR_TOAST);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSave(e)}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor className="h-5 w-5 text-brand-deep flex-shrink-0" />
          <h3 className="font-semibold text-gray-900 truncate">{screenhost.name}</h3>
        </div>
        {summary ? (
          <span className="text-sm font-medium text-gray-700 tabular-nums flex-shrink-0">
            {summary}
          </span>
        ) : (
          <span className="text-sm font-medium text-amber-700 bg-amber-50 rounded-full px-3 py-1 flex-shrink-0">
            {NOT_DECLARED_LABEL}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`declared-screens-${screenhost.id}`} className={LABEL_CLASS}>
            Nombre d&apos;écrans <span className="text-red-500">*</span>
          </label>
          <input
            id={`declared-screens-${screenhost.id}`}
            type="text"
            inputMode="numeric"
            required
            value={screens}
            onChange={(e) => setScreens(e.target.value)}
            className={INPUT_CLASS}
            placeholder="3"
          />
        </div>
        <div>
          <label htmlFor={`declared-rooms-${screenhost.id}`} className={LABEL_CLASS}>
            Nombre de salles <span className="text-red-500">*</span>
          </label>
          <input
            id={`declared-rooms-${screenhost.id}`}
            type="text"
            inputMode="numeric"
            required
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
            className={INPUT_CLASS}
            placeholder="2"
          />
        </div>
      </div>

      {showError && 'error' in draft && <p className="text-sm text-red-600">{draft.error}</p>}

      <button
        type="submit"
        disabled={saving || 'error' in draft}
        className="px-5 py-2.5 rounded-xl bg-brand-primary text-sm font-semibold text-brand-deep hover:bg-brand-primary/90 disabled:opacity-50"
      >
        Enregistrer
      </button>
    </form>
  );
}
