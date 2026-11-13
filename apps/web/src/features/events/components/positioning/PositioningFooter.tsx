import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface PositioningFooterProps {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  /** The trailing glyph: the arrow by default, the cart on the Récapitulatif. */
  nextIcon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
}

/** Under each step: « Retour » on the left, the green pill (« Suivant », « Ajouter au panier »). */
export default function PositioningFooter({
  onBack,
  onNext,
  nextLabel,
  nextIcon,
  disabled = false,
  loading = false,
}: PositioningFooterProps) {
  const inactive = disabled || loading;
  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 rounded-lg border border-pitch-line bg-white px-4 py-2.5 text-sm font-medium text-pitch-ink transition-colors hover:bg-pitch-wash"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Retour
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={inactive}
        className={`flex items-center gap-2 rounded-full px-7 py-3 text-base font-semibold transition-all ${
          inactive
            ? 'cursor-not-allowed bg-pitch-track text-pitch-grey'
            : 'bg-stadium-cta text-pitch-ink shadow-lg shadow-brand-primary/45 hover:brightness-95 active:scale-[0.98]'
        }`}
      >
        {nextLabel}
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          (nextIcon ?? <ArrowRight className="h-4 w-4" aria-hidden="true" />)
        )}
      </button>
    </div>
  );
}
