import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface GradientPillButtonProps {
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
 * CF-U1 — the mockup's primary action pill (Mejri items 1/5): a rounded-full gradient button on
 * the app's green ramp with a soft drop shadow, shared by every wizard « Suivant » and
 * « Soumettre la campagne » so the style has ONE home (no per-page one-offs). Secondary actions
 * (Retour / Enregistrer) keep their existing bordered style per the mockup pair.
 */
export default function GradientPillButton({
  children,
  onClick,
  disabled = false,
  loading = false,
  icon,
  trailingIcon,
  type = 'button',
  className = '',
}: GradientPillButtonProps) {
  const inactive = disabled || loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={inactive}
      className={`inline-flex items-center justify-center gap-2.5 rounded-full px-8 py-3.5 font-semibold text-white transition-all ${
        inactive
          ? 'cursor-not-allowed bg-gray-300 text-gray-500 shadow-none'
          : 'bg-gradient-to-r from-brand-primary via-brand-deep/90 to-brand-deep shadow-lg shadow-brand-deep/25 hover:shadow-xl hover:shadow-brand-deep/30 hover:brightness-105 active:scale-[0.98]'
      } ${className}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      <span>{children}</span>
      {!loading && trailingIcon}
    </button>
  );
}
