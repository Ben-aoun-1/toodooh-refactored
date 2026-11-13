import { Save, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import PositioningStepper, { type PositioningStep } from './PositioningStepper';

interface PositioningHeroProps {
  title: string;
  subtitle: string;
  steps: readonly PositioningStep[];
  currentStep: number;
  onStep: (stepId: number) => void;
  /** Absent on the multi-match page: its drafts are saved from the exit window. */
  onSave?: () => void;
  saving?: boolean;
  onCancel: () => void;
}

/**
 * The top of the Foot parcours as Mariem drew it (04/11): the page title on a lit pitch — the
 * crowd in the stands, two floodlights, the centre circle, the halfway line and both boxes —
 * with « Enregistrer » / « Annuler » and the stepper. The step content overlaps its bottom edge.
 * Each step opens at the top, on the stepper, as in the mockup.
 */
export default function PositioningHero({
  title,
  subtitle,
  steps,
  currentStep,
  onStep,
  onSave,
  saving = false,
  onCancel,
}: PositioningHeroProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);

  // The page scrolls inside the layout's <main>, not the window: the hero brings itself into view.
  useEffect(() => {
    heroRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [currentStep]);

  return (
    <div
      ref={heroRef}
      className="relative overflow-hidden bg-stadium-hero px-4 pb-20 pt-6 sm:px-6 lg:px-8"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-12 bg-stadium-crowd bg-crowd bg-crowd-offset opacity-55 [-webkit-mask-image:linear-gradient(180deg,black,transparent)] [mask-image:linear-gradient(180deg,black,transparent)]" />
        <div className="absolute -top-8 left-[12%] h-32 w-44 animate-flood rounded-full bg-stadium-flood" />
        <div className="absolute -top-8 right-[12%] h-32 w-44 animate-flood rounded-full bg-stadium-flood [animation-delay:2.5s]" />
        <div className="absolute -top-20 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full border-2 border-white/30" />
        <div className="absolute inset-y-0 left-1/2 border-l-2 border-white/20" />
        <div className="absolute -left-0.5 bottom-6 top-6 w-32 border-2 border-l-0 border-white/20" />
        <div className="absolute -right-0.5 bottom-6 top-6 w-32 border-2 border-r-0 border-white/20" />
      </div>

      <div className="relative z-[1]">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-white">{title}</h1>
            <p className="mt-1 text-sm text-white/85">{subtitle}</p>
          </div>
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg border border-white bg-white px-4 py-2 text-sm font-medium text-pitch-ink transition-colors hover:bg-pitch-wash disabled:opacity-60"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Enregistrer
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Annuler
          </button>
        </div>
        <PositioningStepper steps={steps} current={currentStep} onStep={onStep} />
      </div>
    </div>
  );
}
