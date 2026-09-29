import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * NOTIF-D1 — a layer ALWAYS centered in the viewport (operator: « always in the center of the
 * screen », unlike the Figma frames' left-pinned placement). Stacked layers raise `z`. Portaled to
 * <body> so no transformed ancestor (the bell's header) can re-anchor the fixed layer.
 */
export default function CenteredOverlay({
  onDismiss,
  children,
  z = 'z-[100]',
  labelledBy,
}: {
  onDismiss: () => void;
  children: ReactNode;
  z?: 'z-[100]' | 'z-[110]';
  labelledBy?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return createPortal(
    <div
      className={`fixed inset-0 ${z} flex items-center justify-center bg-black/50 p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onDismiss}
      />
      <div className="relative flex max-h-full w-full justify-center">{children}</div>
    </div>,
    document.body,
  );
}
