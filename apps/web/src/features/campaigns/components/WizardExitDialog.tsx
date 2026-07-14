import { AlertTriangle, Loader2 } from 'lucide-react';

import { WIZARD_EXIT_MESSAGE } from '@/features/campaigns/lib/exit-intercept';

interface WizardExitDialogProps {
  open: boolean;
  /** True while Quitter (draft delete) or Enregistrer is in flight — buttons lock. */
  busy: boolean;
  onQuit: () => void;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * CF-W1 (spec §1.9) — the 3-button exit popup: Quitter (leave, fresh drafts are deleted) /
 * Annuler (stay, nothing lost) / Enregistrer (save → toast → leave). Tab close/refresh uses the
 * NATIVE beforeunload prompt instead (custom buttons are a platform impossibility there).
 */
export default function WizardExitDialog({
  open,
  busy,
  onQuit,
  onCancel,
  onSave,
}: WizardExitDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden
        onClick={busy ? undefined : onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Quitter la création de campagne"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>
          <p className="text-sm leading-relaxed text-gray-800">{WIZARD_EXIT_MESSAGE}</p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onQuit}
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
          >
            Quitter
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
