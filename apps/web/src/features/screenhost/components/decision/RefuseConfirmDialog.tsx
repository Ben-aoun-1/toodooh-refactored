import CenteredOverlay from '@/features/screenhost/components/decision/CenteredOverlay';
import { refuseQuestion } from '@/features/screenhost/lib/decision-notifications';

/** Figma frame 590 — « Refuser définitivement » confirm, stacked above the details popup. */
export default function RefuseConfirmDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: 'campaign' | 'event';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <CenteredOverlay onDismiss={onCancel} z="z-[110]" labelledBy="refuse-confirm-title">
      <div className="w-full max-w-[340px] rounded-2xl bg-white shadow-xl">
        <p id="refuse-confirm-title" className="p-4 text-base font-medium text-[#171717]">
          {refuseQuestion(target)}
        </p>
        <div className="flex justify-end gap-3 border-t border-[#EBEBEB] p-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 rounded-lg border border-[#EBEBEB] bg-white px-6 text-sm text-[#5C5C5C] hover:bg-gray-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-9 rounded-lg bg-[#FB3748] px-3 text-sm font-medium text-white hover:bg-[#FB3748]/90 disabled:opacity-60"
          >
            Refuser définitivement
          </button>
        </div>
      </div>
    </CenteredOverlay>
  );
}
