import { Check } from 'lucide-react';

import { stepState } from '../../lib/positioning-display';

import FootballGlyph from './FootballGlyph';

export interface PositioningStep {
  id: number;
  title: string;
}

interface PositioningStepperProps {
  steps: readonly PositioningStep[];
  current: number;
  /** Back to a step already done; moving forward keeps each step's own gate (Suivant). */
  onStep: (stepId: number) => void;
}

/**
 * The stepper on the pitch: a dashed line through the dots, ✓ on the steps done (clickable to go
 * back), the spinning ball on the current one, the number on the ones ahead.
 */
export default function PositioningStepper({ steps, current, onStep }: PositioningStepperProps) {
  return (
    <ol className="relative mx-[4%] mt-6 grid grid-cols-3">
      <li
        aria-hidden="true"
        className="pointer-events-none absolute left-[16.6%] right-[16.6%] top-[calc(1.125rem-1px)] border-t-2 border-dashed border-white/55"
      />
      {steps.map((step) => {
        const state = stepState(step.id, current);
        return (
          <li key={step.id} className="relative flex justify-center">
            <button
              type="button"
              onClick={() => onStep(step.id)}
              disabled={state !== 'done'}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex flex-col items-center gap-1.5 text-xs text-white disabled:cursor-default"
            >
              <span
                className={`relative z-[1] flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] text-sm font-medium ${
                  state === 'done'
                    ? 'border-brand-primary bg-brand-primary text-pitch-ink'
                    : state === 'current'
                      ? 'border-white bg-white text-pitch-ink ring-[5px] ring-white/25'
                      : 'border-white/80 bg-pitch-field text-white'
                }`}
              >
                {state === 'done' ? (
                  <Check className="h-4 w-4" strokeWidth={3} />
                ) : state === 'current' ? (
                  <FootballGlyph className="h-7 w-7 animate-spin-slow" />
                ) : (
                  step.id
                )}
              </span>
              <span className={state === 'current' ? 'font-semibold text-white' : 'text-white/85'}>
                {step.title}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
