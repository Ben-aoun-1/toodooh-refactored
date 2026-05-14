import { useCallback, useState } from 'react';

interface UseWizardOptions {
  totalSteps: number;
  initialStep?: number;
  /** Predicate gating whether a given step can be navigated to. Defaults to allowing back-nav only. */
  canNavigateTo?: (stepId: number, currentStep: number) => boolean;
}

interface WizardApi {
  currentStep: number;
  isFirst: boolean;
  isLast: boolean;
  goToStep: (stepId: number) => boolean;
  nextStep: () => boolean;
  prevStep: () => boolean;
  setCurrentStep: (stepId: number) => void;
}

/**
 * Generic wizard navigation hook. Owns the current step index and provides
 * predicate-gated navigation primitives. Callers supply a `canNavigateTo`
 * predicate that encodes their per-step validity rules.
 *
 * Step IDs are 1-indexed by convention (matches the existing wizard UIs).
 */
export function useWizard({
  totalSteps,
  initialStep = 1,
  canNavigateTo,
}: UseWizardOptions): WizardApi {
  const [currentStep, setCurrentStep] = useState(initialStep);

  const defaultCanNavigate = useCallback(
    (stepId: number, current: number) => stepId <= current,
    [],
  );
  const predicate = canNavigateTo ?? defaultCanNavigate;

  const goToStep = useCallback(
    (stepId: number): boolean => {
      if (stepId < 1 || stepId > totalSteps) return false;
      if (!predicate(stepId, currentStep)) return false;
      setCurrentStep(stepId);
      return true;
    },
    [totalSteps, predicate, currentStep],
  );

  const nextStep = useCallback((): boolean => {
    if (currentStep >= totalSteps) return false;
    return goToStep(currentStep + 1);
  }, [currentStep, totalSteps, goToStep]);

  const prevStep = useCallback((): boolean => {
    if (currentStep <= 1) return false;
    return goToStep(currentStep - 1);
  }, [currentStep, goToStep]);

  return {
    currentStep,
    isFirst: currentStep === 1,
    isLast: currentStep === totalSteps,
    goToStep,
    nextStep,
    prevStep,
    setCurrentStep,
  };
}
