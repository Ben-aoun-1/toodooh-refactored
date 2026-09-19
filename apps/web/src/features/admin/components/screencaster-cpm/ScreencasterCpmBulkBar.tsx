import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useUpdateScreencasterCpm } from '@/features/admin/hooks/useScreencasterCpm';
import { composeScreencasterCpmPatch } from '@/features/admin/lib/screencaster-cpm';
import { getErrorMessage } from '@/lib/errors';

// CPM-3 — appears once ≥ 1 screencaster is selected: two optional rates, then a confirmation that
// states the rule before anything is written (no browser dialog: an inline step).

interface Props {
  selectedIds: string[];
  draftCount: number;
  onDone: () => void;
}

const inputClass =
  'w-40 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent';

export function ScreencasterCpmBulkBar({ selectedIds, draftCount, onDone }: Props) {
  const mutation = useUpdateScreencasterCpm();
  const [standard, setStandard] = useState('');
  const [event, setEvent] = useState('');
  const [confirming, setConfirming] = useState(false);
  const n = selectedIds.length;

  const ask = () => {
    const composed = composeScreencasterCpmPatch(selectedIds, standard, event);
    if (!composed.ok) {
      toast.error(composed.error);
      return;
    }
    setConfirming(true);
  };

  const apply = async () => {
    const composed = composeScreencasterCpmPatch(selectedIds, standard, event);
    if (!composed.ok) return;
    try {
      const result = await mutation.mutateAsync(composed.body);
      toast.success(
        `CPM mis à jour pour ${result.updated} screencaster${result.updated > 1 ? 's' : ''} — ${result.drafts_repriced} brouillon${result.drafts_repriced > 1 ? 's' : ''} re-tarifé${result.drafts_repriced > 1 ? 's' : ''}`,
      );
      setStandard('');
      setEvent('');
      setConfirming(false);
      onDone();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || 'Mise à jour impossible');
    }
  };

  return (
    <div className="rounded-xl border border-brand-primary/40 bg-brand-primary/5 p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-sm font-medium text-gray-900 mr-2">
          {n} screencaster{n > 1 ? 's' : ''} sélectionné{n > 1 ? 's' : ''}
        </p>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Nouveau CPM standard (TND / 1000)</span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={standard}
            onChange={(e) => setStandard(e.target.value)}
            placeholder="inchangé"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Nouveau CPM événement (TND / 1000)</span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            placeholder="inchangé"
          />
        </label>
        {!confirming && (
          <button
            type="button"
            onClick={ask}
            className="px-4 py-2.5 rounded-xl bg-brand-primary text-brand-deep text-sm font-medium hover:opacity-90"
          >
            Appliquer à {n} screencaster{n > 1 ? 's' : ''}
          </button>
        )}
      </div>
      {confirming && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          <p>
            Les brouillons de ces screencasters ({draftCount}) passent au nouveau CPM, ainsi que
            leurs prochaines campagnes. Les campagnes en attente, refusées, programmées, actives et
            terminées gardent leur prix.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-deep text-white text-sm font-medium disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmer
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
