import type { ReactNode } from 'react';

/** AGT-1b — one settings field: label, input (or a read-only value with its Support note). */
export const INPUT =
  'w-full rounded-lg border border-[#E1E4EA] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-[#171717]">{label}</span>
      {children}
    </label>
  );
}

export function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="text-sm">
      <span className="mb-1 block font-medium text-[#171717]">{label}</span>
      <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-[#5C5C5C]">{value ?? '—'}</p>
      <p className="mt-1 text-xs text-[#5C5C5C]">Modification sur demande via le Support.</p>
    </div>
  );
}

export function FormActions({
  dirty,
  valid,
  saving,
  onCancel,
}: {
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-end gap-3 border-t border-[#E1E4EA] pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={!dirty}
        className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
      >
        Annuler
      </button>
      <button
        type="submit"
        disabled={!dirty || !valid || saving}
        className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
      >
        Enregistrer
      </button>
    </div>
  );
}
