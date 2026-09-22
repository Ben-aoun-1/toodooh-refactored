import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';

import { useUpdateAdminScreenhostDeclaration } from '@/features/admin/hooks/useAdminScreens';
import type { AdminLocation } from '@/features/admin/services/admin-screens.service';
import {
  DECLARATION_ERROR_TOAST,
  DECLARATION_SAVED_TOAST,
} from '@/features/screenhost/lib/venue-declaration';
import { getErrorMessage } from '@/lib/errors';
import { declaredCountInput, partialDeclarationPatch } from '@/lib/screen-declaration';

const INPUT_CLASS =
  'w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent';

/**
 * SCR-DECL1 (Q1) — the admin edit of one venue's declared screens / rooms on « Localités et
 * écrans », shown in the expanded row above its screens. Same endpoint semantics as the owner's
 * card (one reconciliation server-side); a blank field is left unchanged, and the server's 409
 * (below the installed screens) is shown as the toast.
 */
export default function AdminVenueDeclarationForm({ location }: { location: AdminLocation }) {
  const update = useUpdateAdminScreenhostDeclaration();
  const [screens, setScreens] = useState(declaredCountInput(location.declared_screens_count));
  const [rooms, setRooms] = useState(declaredCountInput(location.room_count));

  // Re-sync when the list refetches after a save.
  useEffect(() => {
    setScreens(declaredCountInput(location.declared_screens_count));
    setRooms(declaredCountInput(location.room_count));
  }, [location.declared_screens_count, location.room_count]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const draft = partialDeclarationPatch(screens, rooms);
    if ('error' in draft) {
      toast.error(draft.error);
      return;
    }
    try {
      await update.mutateAsync({ screenhostId: location.id, patch: draft.patch });
      toast.success(DECLARATION_SAVED_TOAST);
    } catch (error) {
      toast.error(getErrorMessage(error) || DECLARATION_ERROR_TOAST);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSave(e)}
      className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4"
    >
      <div>
        <label
          htmlFor={`admin-declared-screens-${location.id}`}
          className="block text-xs font-medium uppercase text-gray-500 mb-1"
        >
          Écrans déclarés
        </label>
        <input
          id={`admin-declared-screens-${location.id}`}
          type="text"
          inputMode="numeric"
          value={screens}
          onChange={(e) => setScreens(e.target.value)}
          className={INPUT_CLASS}
          placeholder="—"
        />
      </div>
      <div>
        <label
          htmlFor={`admin-declared-rooms-${location.id}`}
          className="block text-xs font-medium uppercase text-gray-500 mb-1"
        >
          Salles
        </label>
        <input
          id={`admin-declared-rooms-${location.id}`}
          type="text"
          inputMode="numeric"
          value={rooms}
          onChange={(e) => setRooms(e.target.value)}
          className={INPUT_CLASS}
          placeholder="—"
        />
      </div>
      <button
        type="submit"
        disabled={update.isPending}
        className="px-4 py-2 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Enregistrer
      </button>
      <p className="w-full text-xs text-gray-500">
        Une fois le propriétaire validé, les écrans suivent ce nombre : en le baissant, seuls des
        écrans jamais installés sont retirés.
      </p>
    </form>
  );
}
