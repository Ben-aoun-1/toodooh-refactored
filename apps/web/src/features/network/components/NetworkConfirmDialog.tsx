import { useEffect, useId, useRef } from 'react';

import { dialogDetail, type NetworkCopy } from '@/features/network/lib/network-copy';
import type { NetworkEntry, NetworkKind } from '@/features/network/lib/network-entries';

interface NetworkConfirmDialogProps {
  kind: NetworkKind;
  copy: NetworkCopy;
  open: boolean;
  picked: NetworkEntry[];
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** « Ne plus diffuser dans ces établissements ? » — the list, then Annuler / Confirmer. */
export default function NetworkConfirmDialog({
  kind,
  copy,
  open,
  picked,
  pending,
  onClose,
  onConfirm,
}: NetworkConfirmDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pending, onClose]);

  if (!open) return null;
  return (
    // The veil is the prototype's click-away surface; Escape and « Annuler » do the same.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="veil show"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{copy.dialogTitle}</h2>
        <p>{copy.dialogBody}</p>
        <ul>
          {picked.map((entry) => (
            <li key={entry.id}>
              <b>{entry.name}</b>
              <span>{dialogDetail(kind, entry)}</span>
            </li>
          ))}
        </ul>
        <p className="rsx-note">{copy.dialogNote}</p>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose} disabled={pending}>
            Annuler
          </button>
          <button
            type="button"
            className="btn dark"
            ref={confirmRef}
            onClick={onConfirm}
            disabled={pending}
          >
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}
