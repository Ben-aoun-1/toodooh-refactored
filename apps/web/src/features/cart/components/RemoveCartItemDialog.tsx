import { Trash2, X } from 'lucide-react';

interface RemoveCartItemDialogProps {
  campaignName: string;
  busy: boolean;
  onCancel: () => void;
  /** « Conserver en brouillon » — the item leaves the cart, the campaign stays a draft. */
  onKeepDraft: () => void;
  /** « Supprimer définitivement » — the item leaves the cart AND the campaign is deleted. */
  onDeleteForever: () => void;
}

/**
 * CF-C1 (spec §1.11) — the 3-way Retirer confirm: Annuler / Conserver en brouillon /
 * Supprimer définitivement. z-50: the modal layer, ABOVE the cart widget (z-40).
 */
export default function RemoveCartItemDialog({
  campaignName,
  busy,
  onCancel,
  onKeepDraft,
  onDeleteForever,
}: RemoveCartItemDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-bold text-gray-900">Retirer du panier</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
            aria-label="Annuler"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-5 text-sm text-gray-600">
          Que faire de la campagne <span className="font-semibold">{campaignName}</span> ?
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onKeepDraft}
            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Conserver en brouillon
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDeleteForever}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Supprimer définitivement
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
