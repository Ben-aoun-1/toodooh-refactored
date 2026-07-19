import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface PillButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Swaps the leading icon for a spinner and locks the button. */
  loading?: boolean;
  /** Leading icon (the mockup pairs the label with a contextual glyph). */
  icon?: ReactNode;
  /** Trailing icon — the « Suivant → » arrow. */
  trailingIcon?: ReactNode;
  type?: 'button' | 'submit';
  className?: string;
}

/**
 * CF-U2 (operator ruling 2026-07-18) — the primary action pill is FLAT brand green (Mejri's
 * in-app screenshot; the CF-U1 green→black gradient is retired). Dark label on the light green
 * for contrast (the app's standing flat-green pairing). Same pill geometry and soft-shadow
 * discipline as before; shared by every wizard « Suivant » / « Soumettre la campagne » so the
 * style keeps ONE home. Secondary actions (Retour / Enregistrer) keep their bordered style.
 */
export const PILL_CTA_CLASSES =
  'bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/30 hover:shadow-xl hover:shadow-brand-primary/40 hover:brightness-95 active:scale-[0.98]';

export default function PillButton({
  children,
  onClick,
  disabled = false,
  loading = false,
  icon,
  trailingIcon,
  type = 'button',
  className = '',
}: PillButtonProps) {
  const inactive = disabled || loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={inactive}
      className={`inline-flex items-center justify-center gap-2.5 rounded-full px-8 py-3.5 font-semibold transition-all ${
        inactive ? 'cursor-not-allowed bg-gray-300 text-gray-500 shadow-none' : PILL_CTA_CLASSES
      } ${className}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      <span>{children}</span>
      {!loading && trailingIcon}
    </button>
  );
}
